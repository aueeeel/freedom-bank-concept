from collections import defaultdict

from .io import ValidationError, digest, read_json
from .rubric import calculate_score, validate_answers


def fraction(numerator, denominator):
    return numerator / denominator if denominator else None


def benchmark(labels, results_dir):
    """Use original machine decisions, never the human-overridden final answers (no label leakage)."""
    if not isinstance(labels, dict) or not isinstance(labels.get("records"), list):
        raise ValidationError("Разметка требует records[]")
    if labels.get("target_role") not in {"bot", "operator"} or not labels.get("rubric_hash"):
        raise ValidationError("Разметка требует target_role и rubric_hash")
    predictions = {}
    for file in sorted(results_dir.glob("*.json")):
        result = read_json(file)
        if not isinstance(result, dict) or "primary_assessment" not in result:
            continue
        if result["target_role"] != labels["target_role"] or digest(result["rubric"]) != labels["rubric_hash"]:
            continue
        cid = result["conversation_id"]
        if cid in predictions:
            raise ValidationError("Несколько результатов для одного диалога: используйте отдельную папку эксперимента")
        predictions[cid] = result
    per_criterion = defaultdict(lambda: {"correct": 0, "total": 0})
    na = {"tp": 0, "fp": 0, "fn": 0}
    flags = {"tp": 0, "fp": 0, "fn": 0}
    errors, missing, seen, checked_count = [], [], set(), 0
    for gold in labels["records"]:
        cid = gold.get("conversation_id")
        if not isinstance(cid, str) or cid in seen:
            raise ValidationError("Неверный или повторяющийся conversation_id разметки")
        seen.add(cid)
        if cid not in predictions:
            missing.append(cid)
            continue
        result = predictions[cid]
        expected = {"criteria": gold["criteria"]}
        validate_answers(expected, result["rubric"])
        predicted = result["primary_assessment"]
        by_id = {c["criterion_id"]: c for c in predicted["criteria"]}
        criterion_types = {c["id"]: c["type"] for c in result["rubric"]["criteria"]}
        for truth in gold["criteria"]:
            cid2, guess = truth["criterion_id"], by_id[truth["criterion_id"]]
            correct = all(truth.get(k) == guess.get(k) for k in ("answer", "value", "na_code"))
            per_criterion[cid2]["total"] += 1
            per_criterion[cid2]["correct"] += int(correct)
            actual_na, predicted_na = truth["answer"] == "na", guess["answer"] == "na"
            na["tp"] += int(actual_na and predicted_na)
            na["fp"] += int(not actual_na and predicted_na)
            na["fn"] += int(actual_na and not predicted_na)
            if criterion_types[cid2] == "flag":
                positive, predicted_positive = truth["answer"] == "yes", guess["answer"] == "yes"
                flags["tp"] += int(positive and predicted_positive)
                flags["fp"] += int(not positive and predicted_positive)
                flags["fn"] += int(positive and not predicted_positive)
        truth_score, predicted_score = calculate_score(expected, result["rubric"])["total"], calculate_score(predicted, result["rubric"])["total"]
        if truth_score is not None and predicted_score is not None:
            errors.append(abs(truth_score - predicted_score))
        checked_count += int(result["status"] == "automatically_checked")
    matched = len(seen) - len(missing)
    return {"matched_dialogues": matched, "missing_dialogues": missing, "target_role": labels["target_role"],
            "label_quality": labels.get('label_quality', 'unspecified'),
            "reference_set": labels.get('reference_set'),
            "independent_expert_ground_truth": labels.get('independent_expert_ground_truth', False),
            "rubric_hash": labels["rubric_hash"], "predictions": "primary_assessment_before_human_review",
            "criterion_accuracy": {k: {**v, "accuracy": fraction(v["correct"], v["total"])} for k, v in per_criterion.items()},
            "na": {**na, "precision": fraction(na["tp"], na["tp"] + na["fp"]), "recall": fraction(na["tp"], na["tp"] + na["fn"])},
            "gross_flags": {**flags, "precision": fraction(flags["tp"], flags["tp"] + flags["fp"]), "recall": fraction(flags["tp"], flags["tp"] + flags["fn"])},
            "total_score_mae": sum(errors) / len(errors) if errors else None,
            "automatically_checked_fraction": fraction(checked_count, matched),
            "warning": "Приблизительные примеры измеряют согласование с пользовательской разметкой, а не экспертную точность. "
                       "На примерах, использованных в подсказках, проверка не независима. "
                       "Синтетический отложенный набор может повторять сценарии примеров. null = недостаточно наблюдений."}
