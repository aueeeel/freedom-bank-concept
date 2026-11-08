from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path

from . import PIPELINE_VERSION
from .calibration import load_profile, select_examples
from .evidence import enrich_assessment, validate_assessment, validate_facts
from .io import ValidationError, digest, normalize_conversation, read_json, validate_knowledge, write_json
from .prompts import FACTS_PROMPT, JUDGE_PROMPT, REVIEW_PROMPT
from .rubric import calculate_score, validate_rubric
from .schemas import FACTS, assessment_schema
from .policies import apply_role_policies


def disagreements(primary, review):
    by_id = {r["criterion_id"]: r for r in review["criteria"]}
    return [{"criterion_id": r["criterion_id"],
             "primary": {k: r[k] for k in ("answer", "value", "na_code")},
             "review": {k: by_id[r["criterion_id"]][k] for k in ("answer", "value", "na_code")}}
            for r in primary["criteria"]
            if any(r[k] != by_id[r["criterion_id"]][k] for k in ("answer", "value", "na_code"))]


def review_reasons(primary, review, differences, resolved=(), require_manual=False):
    resolved = set(resolved)
    reasons = []
    for item in differences:
        if item["criterion_id"] not in resolved:
            reasons.append({"criterion_id": item["criterion_id"], "reason": "independent_judges_disagree"})
    for label, assessment in (("primary", primary), ("review", review)):
        for row in assessment["criteria"]:
            if row["criterion_id"] in resolved:
                continue
            if require_manual and label == 'primary':
                reasons.append({"criterion_id":row['criterion_id'],"reason":"local_model_not_calibrated"})
            if row["factual_support"] == "unverified":
                reasons.append({"criterion_id": row["criterion_id"], "reason": "factual_correctness_unverified", "source": label})
            for uncertainty in row["uncertainties"]:
                reasons.append({"criterion_id": row["criterion_id"], "reason": uncertainty, "source": label})
    return reasons


class Evaluator:
    def __init__(self, provider, rubric, knowledge=None, cache_dir=None, calibration=None):
        self.provider = provider
        self.rubric = copy.deepcopy(validate_rubric(rubric))
        self.knowledge = copy.deepcopy(validate_knowledge(knowledge or {"version": "none", "documents": []}))
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.calibration = load_profile(self.rubric) if calibration is None else calibration

    def _validated_call(self, stage, prompt, payload, schema, validator):
        # One bounded repair. Never silently publish invalid evidence or calculate from invalid answers.
        checkpoint=None
        if self.cache_dir:
            key=digest({'stage':stage,'prompt':prompt,'payload':payload,'schema':schema,'provider':self.provider.identity})
            checkpoint=self.cache_dir/'stages'/(key+'.json')
            if checkpoint.exists():
                result=read_json(checkpoint)
                validator(result)
                return result
        correction = None
        for attempt in range(2):
            sent = dict(payload)
            if correction:
                sent["validation_feedback"] = correction
            try:
                result = self.provider.structured(stage, prompt, sent, schema)
                validator(result)
                if checkpoint: write_json(checkpoint,result)
                return result
            except ValidationError as exc:
                correction = str(exc)
                if attempt:
                    raise ValidationError(f"{stage}: повторно не пройдена проверка: {exc}") from None

    def evaluate(self, raw_conversation, target_role="bot", use_cache=True):
        if target_role not in {"operator", "bot"}:
            raise ValidationError("target_role должен быть bot или operator")
        conversation = normalize_conversation(raw_conversation)
        if not any(m["speaker"] == target_role for m in conversation["transcript"]):
            raise ValidationError(f"В диалоге нет реплик target_role={target_role}; оценка не рассчитывается")
        examples = select_examples(self.calibration, conversation, target_role)
        fingerprint = digest({"pipeline": PIPELINE_VERSION, "provider": self.provider.identity,
                              "prompts": [FACTS_PROMPT, JUDGE_PROMPT, REVIEW_PROMPT],
                              "conversation": conversation, "target_role": target_role,
                              "checklist": self.rubric, "knowledge": self.knowledge,
                              "calibration_examples": examples})
        cache_path = self.cache_dir / (fingerprint + ".json") if self.cache_dir else None
        if use_cache and cache_path and cache_path.exists():
            cached = read_json(cache_path)
            # Validate the actual cached assessments against current transcript/config, too.
            validate_assessment(cached["primary_assessment"], self.rubric, conversation, self.knowledge, target_role)
            validate_assessment(cached["independent_review"], self.rubric, conversation, self.knowledge, target_role)
            if cached.get("fingerprint") != fingerprint:
                raise ValidationError("Повреждённый cache fingerprint")
            assembled = self._assemble(conversation, target_role, fingerprint, cached["facts"],
                                  cached["primary_assessment"], cached["independent_review"],
                                  cached["usage"], cached["created_at"], cached=True, examples=examples)
            assembled['policy_adjustments'] = cached.get('policy_adjustments', assembled['policy_adjustments'])
            for key in ('raw_primary_assessment', 'raw_independent_review'):
                if key in cached:
                    assembled[key] = cached[key]
            return assembled
        base = {"target_role": target_role, "conversation": conversation, "checklist": self.rubric,
                "knowledge": self.knowledge, "calibration_examples": examples}
        usage_start = len(self.provider.usage)
        check = lambda a: validate_assessment(a, self.rubric, conversation, self.knowledge, target_role)
        schema = assessment_schema(self.rubric)
        if self.provider.identity.get('evaluation_mode')=='per_criterion':
            facts={'events':[],'missing_context':[]}
            outputs=[]
            for stage,prompt in [('judge',JUDGE_PROMPT),('review',REVIEW_PROMPT)]:
                rows=[]
                for criterion in self.rubric['criteria']:
                    partial={**self.rubric,'criteria':[criterion]}
                    validate=lambda value,r=partial: validate_assessment(value,r,conversation,self.knowledge,target_role)
                    answer=self._validated_call(stage,prompt,{**base,'checklist':partial},assessment_schema(partial),validate)
                    rows.extend(answer['criteria'])
                result={'criteria':rows,'summary':'Локальная оценка по критериям. Требуется экспертная проверка.'}
                check(result)
                outputs.append(result)
            primary,review=outputs
        else:
            facts = self._validated_call("facts", FACTS_PROMPT, base, FACTS, lambda f: validate_facts(f, conversation))
            primary = self._validated_call("judge", JUDGE_PROMPT, {**base, "extracted_facts": facts}, schema, check)
            review = self._validated_call("review", REVIEW_PROMPT, base, schema, check)
        result = self._assemble(conversation, target_role, fingerprint, facts, primary, review,
                                copy.deepcopy(self.provider.usage[usage_start:]),
                                datetime.now(timezone.utc).isoformat(), examples=examples)
        if cache_path:
            write_json(cache_path, result)
        return result

    def _assemble(self, conversation, target_role, fingerprint, facts, primary, review, usage, created_at, cached=False, examples=()):
        validate_facts(facts, conversation)
        raw_primary, raw_review = copy.deepcopy(primary), copy.deepcopy(review)
        primary, first_changes = apply_role_policies(primary, self.rubric, conversation, target_role)
        review, second_changes = apply_role_policies(review, self.rubric, conversation, target_role)
        for assessment in (primary, review):
            validate_assessment(assessment, self.rubric, conversation, self.knowledge, target_role)
        differences = disagreements(primary, review)
        reasons = review_reasons(primary, review, differences, require_manual=self.provider.identity.get('requires_manual_review',False))
        score = calculate_score(primary, self.rubric)
        return {"schema_version": 1, "pipeline_version": PIPELINE_VERSION, "fingerprint": fingerprint,
                "created_at": created_at, "cached": cached, "conversation_id": conversation["conversation_id"],
                "target_role": target_role, "conversation": conversation, "rubric": self.rubric,
                "knowledge": self.knowledge, "provider": self.provider.identity,
                "facts": facts, "primary_assessment": primary, "independent_review": review,
                "raw_primary_assessment": raw_primary, "raw_independent_review": raw_review,
                "policy_adjustments": {'primary': first_changes, 'review': second_changes},
                "calibration": {'mode': 'reference_examples_in_prompt',
                                'label_quality': 'user_approximate_reference',
                                'example_ids': [x['conversation_id'] for x in examples],
                                'not_a_trained_or_independently_validated_model': True},
                "semantic_fact_checks": copy.deepcopy(getattr(self.provider, 'semantic_audit', [])),
                "final_assessment": copy.deepcopy(primary), "display_assessment": enrich_assessment(primary, conversation),
                "score": score, "independent_score": calculate_score(review, self.rubric),
                "final_score": None if reasons else score["total"],
                "status": "needs_review" if reasons else "automatically_checked",
                "review_reasons": reasons, "disagreements": differences, "usage": usage, "amendments": [],
                "limitations": ["Согласие двух оценок одной модели не является доказательством точности.",
                                "По транскрипту не оценены дикция и интонация.",
                                "Проверка цитат подтверждает их наличие, но не истинность интерпретации."]}


def resolve_criterion(result, decision, reviewer, reason):
    """Human review retains both original machine assessments and an append-only audit trail."""
    if not isinstance(reviewer, str) or not reviewer.strip() or not isinstance(reason, str) or not reason.strip():
        raise ValidationError("Требуются reviewer и reason")
    updated = copy.deepcopy(result)
    candidate = copy.deepcopy(updated["final_assessment"])
    found = False
    for index, old in enumerate(candidate["criteria"]):
        if old["criterion_id"] == decision.get("criterion_id"):
            candidate["criteria"][index] = copy.deepcopy(decision)
            found = True
            before = old
            break
    if not found:
        raise ValidationError("Критерий для пересмотра не найден")
    validate_assessment(candidate, updated["rubric"], updated["conversation"], updated["knowledge"], updated["target_role"])
    updated["amendments"].append({"criterion_id": decision["criterion_id"], "reviewer": reviewer,
                                   "reason": reason, "timestamp": datetime.now(timezone.utc).isoformat(),
                                   "before": before, "after": copy.deepcopy(decision)})
    resolved = {a["criterion_id"] for a in updated["amendments"]}
    updated["final_assessment"] = candidate
    updated["display_assessment"] = enrich_assessment(candidate, updated["conversation"])
    updated["score"] = calculate_score(candidate, updated["rubric"])
    updated["review_reasons"] = review_reasons(updated["primary_assessment"], updated["independent_review"],
                                              updated["disagreements"], resolved, require_manual=updated['provider'].get('requires_manual_review',False))
    updated["status"] = "needs_review" if updated["review_reasons"] else "human_reviewed"
    updated["final_score"] = None if updated["review_reasons"] else updated["score"]["total"]
    return updated
