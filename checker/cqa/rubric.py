from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .io import ValidationError


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError("Ожидается число")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValidationError("Недопустимое число") from exc
    if not result.is_finite():
        raise ValidationError("Число должно быть конечным")
    return result


def validate_rubric(rubric):
    if not isinstance(rubric, dict) or not isinstance(rubric.get("version"), str) or not rubric["version"].strip():
        raise ValidationError("Чек-лист требует version")
    criteria = rubric.get("criteria")
    if not isinstance(criteria, list) or not criteria or len(criteria) > 40:
        raise ValidationError("Чек-лист должен содержать 1–40 критериев")
    ids, total = set(), Decimal(0)
    for c in criteria:
        if not isinstance(c, dict) or any(not isinstance(c.get(k), str) or not c[k].strip()
                                         for k in ("id", "name", "description")):
            raise ValidationError("Критерий требует id, name, description")
        if c["id"] in ids or c.get("type") not in {"binary", "scale", "flag"}:
            raise ValidationError("Повторяющийся id или неизвестный type критерия")
        ids.add(c["id"])
        weight = number(c.get("weight"))
        if weight < 0 or (c["type"] == "flag" and weight != 0):
            raise ValidationError("Вес должен быть >= 0; flag всегда имеет вес 0")
        total += weight
        levels, na = c.get("levels"), c.get("na_conditions")
        if not isinstance(levels, list) or not isinstance(na, list):
            raise ValidationError("levels и na_conditions должны быть массивами")
        codes = []
        for condition in na:
            if not isinstance(condition, dict) or any(not isinstance(condition.get(k), str) or not condition[k].strip()
                                                     for k in ("code", "description")):
                raise ValidationError("Условие N/A требует code и description")
            codes.append(condition["code"])
        if len(codes) != len(set(codes)):
            raise ValidationError("Повторяющийся код N/A")
        if c["type"] == "scale":
            if len(levels) < 2:
                raise ValidationError("Шкала требует минимум две ступени")
            values = []
            for level in levels:
                if not isinstance(level, dict) or not isinstance(level.get("description"), str) or not level["description"].strip():
                    raise ValidationError("Ступень требует description")
                values.append(number(level.get("value")))
            if min(values) != 0 or max(values) <= 0 or len(set(values)) != len(values):
                raise ValidationError("Шкала должна начинаться с 0, иметь положительный максимум и уникальные ступени")
        elif levels:
            raise ValidationError("Для binary и flag levels должен быть пустым")
    if total != 100:
        raise ValidationError(f"Сумма весов должна быть 100, получено {total}")
    return rubric


def validate_answers(assessment, rubric):
    rows = assessment.get("criteria") if isinstance(assessment, dict) else None
    if not isinstance(rows, list):
        raise ValidationError("Ожидается criteria[]")
    expected = {c["id"]: c for c in rubric["criteria"]}
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("criterion_id") not in expected or row["criterion_id"] in seen:
            raise ValidationError("Неверный, лишний или повторяющийся criterion_id")
        c = expected[row["criterion_id"]]
        seen.add(c["id"])
        answer, value = row.get("answer"), row.get("value")
        if answer == "na":
            allowed = {n["code"] for n in c["na_conditions"]}
            if row.get("na_code") not in allowed or not isinstance(row.get("na_reason"), str) or not row["na_reason"].strip():
                raise ValidationError(f'{c["id"]}: N/A не разрешён или не обоснован')
        elif row.get("na_code") is not None or row.get("na_reason") is not None:
            raise ValidationError(f'{c["id"]}: na_code/na_reason допустимы только для N/A')
        elif c["type"] == "scale":
            if answer != "score" or number(value) not in {number(l["value"]) for l in c["levels"]}:
                raise ValidationError(f'{c["id"]}: оценка вне шкалы')
        elif answer not in {"yes", "no"}:
            raise ValidationError(f'{c["id"]}: ожидается yes/no')
        if answer != "score" and value is not None:
            raise ValidationError(f'{c["id"]}: value должен быть null')
    if seen != set(expected):
        raise ValidationError("Не все критерии оценены")


def calculate_score(assessment, rubric):
    """The LLM never supplies totals. Round only displayed values, not intermediates."""
    validate_rubric(rubric)
    validate_answers(assessment, rubric)
    rows = {r["criterion_id"]: r for r in assessment["criteria"]}
    applicable = [c for c in rubric["criteria"] if rows[c["id"]]["answer"] != "na" and c["weight"] > 0]
    denominator = sum((number(c["weight"]) for c in applicable), Decimal(0))
    numerator = Decimal(0)
    result, sections, flags = [], {}, []
    rounded = lambda x: float(x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    for c in rubric["criteria"]:
        row, weight = rows[c["id"]], number(c["weight"])
        answer = row["answer"]
        if c["type"] == "flag":
            flags.append({"criterion_id": c["id"], "detected": answer == "yes", "applicable": answer != "na"})
            ratio = Decimal(0)
        elif answer == "score":
            ratio = number(row["value"]) / max(number(l["value"]) for l in c["levels"])
        else:
            ratio = Decimal(1) if answer == "yes" else Decimal(0)
        earned = weight * ratio if answer != "na" else Decimal(0)
        effective = Decimal(100) * weight / denominator if denominator and answer != "na" and c["type"] != "flag" else Decimal(0)
        numerator += earned
        result.append({"criterion_id": c["id"], "weight": float(weight),
                       "effective_weight": rounded(effective), "base_points": rounded(earned),
                       "points": rounded(effective * ratio), "excluded": answer == "na"})
        if weight > 0:
            section = c.get("section", "Общее")
            item = sections.setdefault(section, {"earned": Decimal(0), "possible": Decimal(0)})
            if answer != "na":
                item["earned"] += earned
                item["possible"] += weight
    return {"total": rounded(Decimal(100) * numerator / denominator) if denominator else None,
            "applicable_weight": float(denominator), "criteria": result, "flags": flags,
            "sections": {name: {"earned": rounded(v["earned"]), "possible": float(v["possible"]),
                                "percent": rounded(100 * v["earned"] / v["possible"]) if v["possible"] else None}
                         for name, v in sections.items()},
            "rounding": "ROUND_HALF_UP; final total to 2 decimals; unrounded intermediates"}
