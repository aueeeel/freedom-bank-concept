import copy
import io
import json
from pathlib import Path
import tempfile
import urllib.error
import unittest
from unittest.mock import patch

from cqa.engine import Evaluator, resolve_criterion
from cqa.evidence import validate_assessment, validate_facts
from cqa.io import ValidationError, digest, normalize_conversation, read_json, records_from_payload, write_json
from cqa.metrics import benchmark
from cqa.provider import OpenAIProvider, ProviderError, QuotaError
from cqa.report import render_report
from cqa.rubric import calculate_score, validate_rubric
from cqa.schemas import assessment_schema


ROOT = Path(__file__).resolve().parent.parent


def conversation():
    return normalize_conversation({"conversation_id": "synthetic-test-only", "language": "RU", "channel": "agent chat",
        "transcript": [
            {"speaker": "client", "timestamp": "00:00", "text": "Здравствуйте. Где раздел помощи?"},
            {"speaker": "bot", "timestamp": "00:02", "text": "Здравствуйте! Я помощник. Раздел помощи — в меню. Хорошего дня!"},
            {"speaker": "operator", "timestamp": "00:10", "text": "Здравствуйте! Я оператор. Могу помочь. До свидания!"}]})


def assessment(rubric, conv=None, role="bot"):
    conv = conv or conversation()
    target = next(m for m in conv["transcript"] if m["speaker"] == role)
    rows = []
    for c in rubric["criteria"]:
        flag = c["type"] == "flag"
        rows.append({"criterion_id": c["id"], "answer": "no" if flag else "score" if c["type"] == "scale" else "yes",
                     "value": max(l["value"] for l in c["levels"]) if c["type"] == "scale" else None,
                     "explanation": "Синтетическая тестовая заглушка. Модель не вызывалась.",
                     "basis": "omission" if flag else "observed",
                     "evidence": [] if flag else [{"message_id": target["message_id"], "quote": target["text"]}],
                     "checked_range": {"start_message_id": conv["transcript"][0]["message_id"], "end_message_id": conv["transcript"][-1]["message_id"]} if flag else None,
                     "na_code": None, "na_reason": None, "factual_support": "not_needed",
                     "knowledge_evidence": [], "uncertainties": []})
    return {"criteria": rows, "summary": "СИНТЕТИЧЕСКИЙ ТЕСТ. НЕ РЕЗУЛЬТАТ РАБОТЫ МОДЕЛИ."}


class ScriptedProvider:
    identity = {"model": "scripted-test-no-model", "review_model": "scripted-test-no-model", "reasoning_effort": "none"}

    def __init__(self, rubric, change_review=None, invalid_quote=False, change_primary=None):
        self.rubric = rubric
        self.change_review = change_review
        self.change_primary = change_primary
        self.invalid_quote = invalid_quote
        self.calls = []
        self.usage = []

    def structured(self, stage, prompt, payload, schema):
        self.calls.append((stage, copy.deepcopy(payload)))
        self.usage.append({"stage": stage, "input_tokens": 0, "output_tokens": 0, "model": "scripted-test-no-model"})
        if stage == "facts":
            return {"events": [], "missing_context": []}
        result = assessment(self.rubric, payload["conversation"], payload["target_role"])
        if self.invalid_quote:
            result["criteria"][0]["evidence"][0]["quote"] = "Выдуманная цитата"
        if stage == "review" and self.change_review:
            self.change_review(result)
        if stage == "judge" and self.change_primary:
            self.change_primary(result)
        return result


class CheckerTests(unittest.TestCase):
    def setUp(self):
        self.rubric = read_json(ROOT / "config/checklist.json")
        self.conv = conversation()
        self.a = assessment(self.rubric)
        self.knowledge = {"version": "none", "documents": []}

    def validate(self, value):
        validate_assessment(value, self.rubric, self.conv, self.knowledge, "bot")

    def test_full_score(self):
        self.assertEqual(calculate_score(self.a, self.rubric)["total"], 100)

    def test_scale_is_normalized_by_its_own_maximum(self):
        self.a["criteria"][5]["value"] = 7
        self.assertEqual(calculate_score(self.a, self.rubric)["total"], 95.5)

    def test_na_redistribution(self):
        self.a["criteria"][2].update(answer="na", value=None, na_code="identification_not_required", na_reason="Общий вопрос")
        self.a["criteria"][5]["value"] = 7
        score = calculate_score(self.a, self.rubric)
        self.assertEqual(score["total"], 95.0)
        self.assertEqual(score["applicable_weight"], 90)

    def test_gross_flag_does_not_zero_score(self):
        self.a["criteria"][7]["answer"] = "yes"
        self.assertEqual(calculate_score(self.a, self.rubric)["total"], 100)
        self.assertTrue(calculate_score(self.a, self.rubric)["flags"][0]["detected"])

    def test_invalid_na_rejected(self):
        self.a["criteria"][0].update(answer="na", na_code="invented", na_reason="test")
        with self.assertRaises(ValidationError):
            calculate_score(self.a, self.rubric)

    def test_nonexistent_scale_step_rejected(self):
        self.a["criteria"][5]["value"] = 9
        with self.assertRaises(ValidationError):
            calculate_score(self.a, self.rubric)

    def test_boolean_is_not_a_numeric_score(self):
        self.a["criteria"][5]["value"] = True
        with self.assertRaises(ValidationError):
            calculate_score(self.a, self.rubric)

    def test_no_applicable_weight_returns_none(self):
        custom = {"version": "test", "criteria": [{"id": "x", "name": "x", "type": "binary", "weight": 100,
                    "description": "x", "levels": [], "na_conditions": [{"code": "none", "description": "none"}]}]}
        a = {"criteria": [{"criterion_id": "x", "answer": "na", "value": None, "na_code": "none", "na_reason": "none"}]}
        self.assertIsNone(calculate_score(a, custom)["total"])

    def test_duplicate_and_missing_criteria_rejected(self):
        self.a["criteria"][-1] = self.a["criteria"][0]
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_invalid_weights_rejected(self):
        self.rubric["criteria"][0]["weight"] = 11
        with self.assertRaises(ValidationError):
            validate_rubric(self.rubric)

    def test_invented_quote_rejected(self):
        self.a["criteria"][0]["evidence"][0]["quote"] = "invented"
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_wrong_message_rejected(self):
        self.a["criteria"][0]["evidence"][0]["message_id"] = "missing"
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_operator_answer_cannot_be_credited_to_bot(self):
        operator = self.conv["transcript"][2]
        self.a["criteria"][0]["evidence"] = [{"message_id": operator["message_id"], "quote": operator["text"]}]
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_no_evidence_for_positive_action_rejected(self):
        self.a["criteria"][0]["basis"] = "omission"
        self.a["criteria"][0]["checked_range"] = {"start_message_id": "m00000", "end_message_id": "m00002"}
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_omission_requires_range(self):
        self.a["criteria"][7]["checked_range"] = None
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_wrong_range_order_rejected(self):
        self.a["criteria"][7]["checked_range"] = {"start_message_id": "m00002", "end_message_id": "m00000"}
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_fabricated_knowledge_reference_rejected(self):
        self.a["criteria"][3].update(factual_support="knowledge", knowledge_evidence=[{"document_id": "fake", "quote": "fake"}])
        with self.assertRaises(ValidationError):
            self.validate(self.a)

    def test_facts_require_exact_quotes(self):
        with self.assertRaises(ValidationError):
            validate_facts({"events": [{"kind": "request", "description": "x", "evidence": [{"message_id": "m00000", "quote": "fake"}]}], "missing_context": []}, self.conv)

    def test_independent_review_does_not_receive_first_assessment(self):
        provider = ScriptedProvider(self.rubric)
        result = Evaluator(provider, self.rubric).evaluate(self.conv)
        self.assertEqual(result["final_score"], 100)
        review_payload = provider.calls[-1][1]
        self.assertNotIn("extracted_facts", review_payload)
        self.assertNotIn("primary_assessment", review_payload)
        self.assertEqual([x[0] for x in provider.calls], ["facts", "judge", "review"])

    def test_disagreement_holds_final_score(self):
        provider = ScriptedProvider(self.rubric, change_review=lambda a: a["criteria"][5].update(value=7))
        result = Evaluator(provider, self.rubric).evaluate(self.conv)
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["final_score"])
        self.assertEqual(result["disagreements"][0]["criterion_id"], "06")

    def test_unverified_knowledge_holds_score_even_when_judges_agree(self):
        change = lambda a: a["criteria"][3].update(factual_support="unverified", uncertainties=["Нет проверенного источника"])
        result = Evaluator(ScriptedProvider(self.rubric, change_review=change, change_primary=change), self.rubric).evaluate(self.conv)
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["final_score"])

    def test_invalid_quotes_fail_after_one_repair(self):
        provider = ScriptedProvider(self.rubric, invalid_quote=True)
        with self.assertRaises(ValidationError):
            Evaluator(provider, self.rubric).evaluate(self.conv)
        self.assertEqual([c[0] for c in provider.calls], ["facts", "judge", "judge"])

    def test_validated_facts_are_reused_after_failed_judge(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            bad = ScriptedProvider(self.rubric, invalid_quote=True)
            with self.assertRaises(ValidationError):
                Evaluator(bad,self.rubric,cache_dir=folder).evaluate(self.conv)
            good = ScriptedProvider(self.rubric)
            result = Evaluator(good,self.rubric,cache_dir=folder).evaluate(self.conv)
            self.assertEqual(result['score']['total'],100)
            self.assertEqual([c[0] for c in good.calls],['judge','review'])

    def test_both_roles_get_distinct_cached_results(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            p = ScriptedProvider(self.rubric)
            e = Evaluator(p, self.rubric, cache_dir=folder)
            bot, operator = e.evaluate(self.conv, "bot"), e.evaluate(self.conv, "operator")
            self.assertNotEqual(bot["fingerprint"], operator["fingerprint"])
            self.assertEqual(len(p.calls), 6)
            self.assertTrue(e.evaluate(self.conv, "bot")["cached"])
            self.assertEqual(len(p.calls), 6)

    def test_rubric_change_invalidates_cache(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            p = ScriptedProvider(self.rubric)
            old = Evaluator(p, self.rubric, cache_dir=folder).evaluate(self.conv)
            changed = copy.deepcopy(self.rubric)
            changed["criteria"][0]["description"] += " Новое правило."
            new = Evaluator(p, changed, cache_dir=folder).evaluate(self.conv)
            self.assertNotEqual(old["fingerprint"], new["fingerprint"])

    def test_absent_target_not_scored(self):
        conv = copy.deepcopy(self.conv)
        conv["transcript"] = [m for m in conv["transcript"] if m["speaker"] != "operator"]
        with self.assertRaises(ValidationError):
            Evaluator(ScriptedProvider(self.rubric), self.rubric).evaluate(conv, "operator")

    def test_human_review_retains_original(self):
        result = Evaluator(ScriptedProvider(self.rubric, change_review=lambda a: a["criteria"][5].update(value=7)), self.rubric).evaluate(self.conv)
        decision = copy.deepcopy(result["primary_assessment"]["criteria"][5])
        decision["value"] = 7
        resolved = resolve_criterion(result, decision, "expert", "Проверены формулировки")
        self.assertEqual(resolved["status"], "human_reviewed")
        self.assertEqual(resolved["final_score"], 95.5)
        self.assertEqual(resolved["primary_assessment"]["criteria"][5]["value"], 10)
        self.assertEqual(result["amendments"], [])

    def test_api_envelope_checks_declared_count(self):
        with self.assertRaises(ValidationError):
            records_from_payload({"isSuccess": True, "data": {"total_records": 2, "records": [self.conv]}})

    def test_multilingual_quotes_and_timestamps_unchanged(self):
        for text, timestamp in [("Сәлеметсіз бе! Мен көмекшімін.", "00:02"), ("Hello! I am a helper.", "2026-01-01T01:23:45+05:00")]:
            c = copy.deepcopy(self.conv)
            c["transcript"][1].update(text=text, timestamp=timestamp)
            result = Evaluator(ScriptedProvider(self.rubric), self.rubric).evaluate(c)
            ev = result["display_assessment"]["criteria"][0]["evidence"][0]
            self.assertEqual(ev["quote"], text)
            self.assertEqual(ev["timestamp"], timestamp)

    def test_html_escapes_transcript_and_unsafe_links(self):
        c = copy.deepcopy(self.conv)
        c["transcript"][0]["text"] = "<script>alert(1)</script>"
        c["audio_url"] = "javascript:alert(1)"
        result = Evaluator(ScriptedProvider(self.rubric), self.rubric).evaluate(c)
        html = render_report(result)
        self.assertNotIn("<script>", html)
        self.assertNotIn("javascript:", html)
        self.assertIn("&lt;script&gt;", html)

    def test_benchmark_uses_original_machine_score(self):
        result = Evaluator(ScriptedProvider(self.rubric), self.rubric).evaluate(self.conv)
        decision = copy.deepcopy(result["primary_assessment"]["criteria"][5])
        decision["value"] = 7
        result = resolve_criterion(result, decision, "human", "test")
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            write_json(Path(folder) / "result.json", result)
            labels = {"target_role": "bot", "rubric_hash": digest(self.rubric), "records": [{"conversation_id": self.conv["conversation_id"], "criteria": self.a["criteria"]}]}
            metrics = benchmark(labels, Path(folder))
        self.assertEqual(metrics["total_score_mae"], 0)
        self.assertTrue(all(v["accuracy"] == 1 for v in metrics["criterion_accuracy"].values()))

    def test_custom_criterion_works_without_code_changes(self):
        r = {"version": "new", "criteria": [{"id": "custom", "name": "Перефразирование", "type": "scale", "weight": 100,
                 "description": "Проверяемый перефразировал запрос", "levels": [{"value": 0, "description": "нет"}, {"value": 2, "description": "да"}], "na_conditions": []}]}
        result = Evaluator(ScriptedProvider(r), r).evaluate(self.conv)
        self.assertEqual(result["score"]["total"], 100)
        self.assertEqual(result["primary_assessment"]["criteria"][0]["criterion_id"], "custom")


class ProviderTests(unittest.TestCase):
    def test_exhausted_credit_is_not_retried(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            raise urllib.error.HTTPError(request.full_url, 429, "quota", {},
                io.BytesIO(b'{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}'))
        with self.assertRaisesRegex(ProviderError, "credit_balance_exhausted"):
            OpenAIProvider(api_key="test", opener=opener).structured("facts", "x", {}, {})
        self.assertEqual(len(calls), 1)

    def test_batch_stops_after_first_quota_failure(self):
        from cqa.cli import main
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            folder = Path(folder)
            records = []
            for i in range(3):
                record = conversation()
                record["conversation_id"] = f"test-{i}"
                records.append(record)
            write_json(folder / "input.json", records)
            with patch("cqa.cli.OpenAIProvider") as provider, patch("cqa.cli.Evaluator") as evaluator:
                evaluator.return_value.evaluate.side_effect = QuotaError("Нет средств", "credit_balance_exhausted")
                code = main(["evaluate", str(folder / "input.json"), "--role", "both", "--limit", "0",
                             "--output-dir", str(folder / "results")])
            summary = read_json(folder / "results/batch-summary.json")
            self.assertEqual(code, 1)
            self.assertEqual(evaluator.return_value.evaluate.call_count, 1)
            self.assertEqual(summary["status"], "blocked_quota")
            self.assertEqual(summary["successful_evaluations"], 0)
            self.assertEqual(summary["attempted_evaluations"], 1)
            self.assertEqual(summary["not_attempted_evaluations"], 5)
            self.assertNotIn("completed", summary)

    def test_request_contract_and_output(self):
        rubric = read_json(ROOT / "config/checklist.json")
        expected = assessment(rubric)
        captured = []
        def opener(request, timeout):
            captured.append(json.loads(request.data))
            return io.BytesIO(json.dumps({"id": "r", "status": "completed", "model": "test", "usage": {"input_tokens": 10, "output_tokens": 20},
                              "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(expected)}]}]}).encode())
        provider = OpenAIProvider(api_key="test-only-not-real", opener=opener)
        got = provider.structured("judge", "instructions", {"data": "test"}, assessment_schema(rubric))
        self.assertEqual(got, expected)
        self.assertFalse(captured[0]["store"])
        self.assertTrue(captured[0]["text"]["format"]["strict"])
        self.assertEqual(provider.usage[0]["input_tokens"], 10)

    def test_incomplete_response_not_published(self):
        def opener(request, timeout):
            return io.BytesIO(b'{"status":"incomplete", "output":[]}')
        with self.assertRaises(ProviderError):
            OpenAIProvider(api_key="test", opener=opener).structured("facts", "x", {}, {"type": "object", "properties": {}, "required": [], "additionalProperties": False})

    def test_refusal_not_parsed_as_score(self):
        def opener(request, timeout):
            return io.BytesIO(b'{"status":"completed", "output":[{"content":[{"type":"refusal","refusal":"no"}]}]}')
        with self.assertRaises(ProviderError):
            OpenAIProvider(api_key="test", opener=opener).structured("facts", "x", {}, {"type": "object", "properties": {}, "required": [], "additionalProperties": False})


if __name__ == "__main__":
    unittest.main()
