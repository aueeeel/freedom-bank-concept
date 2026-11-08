from .io import ValidationError
from .rubric import validate_answers
from .schemas import FACTS, assessment_schema, validate_shape


def check_quotes(evidence, messages):
    for item in evidence:
        message = messages.get(item["message_id"])
        if not message or not item["quote"].strip() or item["quote"] not in message["text"]:
            raise ValidationError("Доказательство не найдено дословно в указанной реплике")


def validate_facts(facts, conversation):
    validate_shape(facts, FACTS)
    messages = {m["message_id"]: m for m in conversation["transcript"]}
    for event in facts["events"]:
        if not event["description"].strip() or not event["evidence"]:
            raise ValidationError("Каждый факт требует описание и цитату")
        check_quotes(event["evidence"], messages)


def validate_assessment(assessment, rubric, conversation, knowledge, target_role=None):
    validate_shape(assessment, assessment_schema(rubric))
    validate_answers(assessment, rubric)
    messages = {m["message_id"]: m for m in conversation["transcript"]}
    documents = {d["id"]: d for d in knowledge["documents"]}
    definitions = {c["id"]: c for c in rubric["criteria"]}
    for row in assessment["criteria"]:
        if not row["explanation"].strip():
            raise ValidationError("Оценка требует объяснение")
        check_quotes(row["evidence"], messages)
        checked = row["checked_range"]
        if checked is not None:
            start, end = messages.get(checked["start_message_id"]), messages.get(checked["end_message_id"])
            if not start or not end or start["index"] > end["index"]:
                raise ValidationError("Неверный проверенный диапазон")
        if row["basis"] == "observed" and not row["evidence"]:
            raise ValidationError("Наблюдаемое действие требует цитату")
        positive = row["answer"] == "yes" or (row["answer"] == "score" and row["value"] > 0)
        if positive and row["basis"] != "observed":
            raise ValidationError("Положительная оценка требует наблюдаемое действие, а не отсутствие")
        if target_role and row["basis"] == "observed" and row["answer"] != "na":
            allowed_roles = {target_role}
            if definitions[row["criterion_id"]].get("allow_system_confirmation") is True:
                allowed_roles.add("system")
            if not any(messages[e["message_id"]]["speaker"] in allowed_roles for e in row["evidence"]):
                raise ValidationError("Нельзя засчитать действие другого участника проверяемому")
        if row["basis"] == "omission" and checked is None:
            raise ValidationError("Пропущенное действие требует проверенный диапазон")
        if target_role and row["basis"] == "omission" and checked:
            start_index, end_index = messages[checked["start_message_id"]]["index"], messages[checked["end_message_id"]]["index"]
            if not any(m["speaker"] == target_role and start_index <= m["index"] <= end_index for m in messages.values()):
                raise ValidationError("Проверенный диапазон не охватывает проверяемого участника")
        if row["answer"] == "na":
            if row["basis"] != "not_applicable" or not (checked or row["evidence"]):
                raise ValidationError("N/A требует основание not_applicable и цитату либо диапазон")
        elif row["basis"] == "not_applicable":
            raise ValidationError("Основание not_applicable допустимо только для N/A")
        for ref in row["knowledge_evidence"]:
            doc = documents.get(ref["document_id"])
            if not doc or not ref["quote"].strip() or ref["quote"] not in doc["text"]:
                raise ValidationError("Цитата базы знаний не найдена в исходном документе")
        if row["factual_support"] == "knowledge" and not row["knowledge_evidence"]:
            raise ValidationError("Подтверждение базой знаний требует ссылку и цитату")
        if row["factual_support"] == "transcript" and not row["evidence"]:
            raise ValidationError("Подтверждение транскриптом требует цитату")
        if any(not s.strip() for s in row["uncertainties"]):
            raise ValidationError("Пустое описание неопределённости")


def enrich_assessment(assessment, conversation):
    """Attach authoritative timestamps/speakers; never trust model-supplied metadata."""
    import copy
    result = copy.deepcopy(assessment)
    messages = {m["message_id"]: m for m in conversation["transcript"]}
    for row in result["criteria"]:
        for item in row["evidence"]:
            original = messages[item["message_id"]]
            item.update({"timestamp": original["timestamp"], "speaker": original["speaker"], "index": original["index"]})
        if row["checked_range"]:
            r = row["checked_range"]
            r["start_timestamp"] = messages[r["start_message_id"]]["timestamp"]
            r["end_timestamp"] = messages[r["end_message_id"]]["timestamp"]
    return result
