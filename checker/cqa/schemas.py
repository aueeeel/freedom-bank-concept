"""Strict JSON schemas used both by the API and local validation."""
from .io import ValidationError


def obj(**properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def array(items):
    return {"type": "array", "items": items}


STRING = {"type": "string"}
NULLABLE_STRING = {"type": ["string", "null"]}
EVIDENCE = obj(message_id=STRING, quote=STRING)
RANGE = {"anyOf": [obj(start_message_id=STRING, end_message_id=STRING), {"type": "null"}]}
KNOWLEDGE_EVIDENCE = obj(document_id=STRING, quote=STRING)
FACTS = obj(
    events=array(obj(kind={"type": "string", "enum": ["request", "answer", "identification", "protected_action", "dissatisfaction", "handoff", "closing", "violation_candidate"]},
                     description=STRING, evidence=array(EVIDENCE))),
    missing_context=array(STRING),
)


def assessment_schema(rubric):
    return obj(criteria=array(obj(
        criterion_id={"type": "string", "enum": [c["id"] for c in rubric["criteria"]]},
        answer={"type": "string", "enum": ["yes", "no", "score", "na"]},
        value={"type": ["number", "null"]},
        explanation=STRING,
        basis={"type": "string", "enum": ["observed", "omission", "not_applicable"]},
        evidence=array(EVIDENCE), checked_range=RANGE,
        na_code=NULLABLE_STRING, na_reason=NULLABLE_STRING,
        factual_support={"type": "string", "enum": ["not_needed", "transcript", "knowledge", "unverified"]},
        knowledge_evidence=array(KNOWLEDGE_EVIDENCE),
        uncertainties=array(STRING),
    )), summary=STRING)


def validate_shape(value, schema, path="response"):
    """Validate the deliberately small JSON Schema subset generated above."""
    if "anyOf" in schema:
        for branch in schema["anyOf"]:
            try:
                validate_shape(value, branch, path)
                return
            except ValidationError:
                pass
        raise ValidationError(f"{path}: не соответствует допустимым типам")
    kinds = schema.get("type")
    kinds = kinds if isinstance(kinds, list) else [kinds]
    fits = {"null": value is None, "string": isinstance(value, str), "boolean": isinstance(value, bool),
            "number": isinstance(value, (int, float)) and not isinstance(value, bool),
            "object": isinstance(value, dict), "array": isinstance(value, list)}
    if not any(fits.get(k, False) for k in kinds):
        raise ValidationError(f"{path}: неверный тип")
    if "enum" in schema and value not in schema["enum"]:
        raise ValidationError(f"{path}: значение вне enum")
    if isinstance(value,str) and len(value)>schema.get('maxLength',float('inf')):
        raise ValidationError(f"{path}: превышена допустимая длина текста")
    if isinstance(value, dict):
        properties = schema["properties"]
        if set(value) != set(properties):
            raise ValidationError(f"{path}: отсутствуют обязательные поля или есть лишние")
        for key, item in value.items():
            validate_shape(item, properties[key], f"{path}.{key}")
    elif isinstance(value, list):
        if len(value) < schema.get('minItems',0) or len(value) > schema.get('maxItems',float('inf')):
            raise ValidationError(f"{path}: неверное количество элементов")
        for index, item in enumerate(value):
            validate_shape(item, schema["items"], f"{path}[{index}]")
