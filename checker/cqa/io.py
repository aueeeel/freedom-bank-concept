from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path


class ValidationError(ValueError):
    pass


def read_json(path):
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".cqa-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False).encode("utf-8")).hexdigest()


def load_env(path):
    """Load plain KEY=value locally, without shell evaluation or logging."""
    if not Path(path).exists():
        return
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and value:
            os.environ.setdefault(key, value)


def normalize_conversation(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("conversation_id"), str) or not raw["conversation_id"].strip():
        raise ValidationError("conversation_id должен быть непустой строкой")
    transcript = raw.get("transcript")
    if not isinstance(transcript, list) or not transcript or len(transcript) > 10000:
        raise ValidationError("transcript должен содержать от 1 до 10000 реплик")
    messages, seen = [], set()
    total = 0
    for index, message in enumerate(transcript):
        if not isinstance(message, dict):
            raise ValidationError(f"Реплика {index}: ожидается объект")
        if message.get("speaker") not in {"client", "operator", "bot", "system"}:
            raise ValidationError(f"Реплика {index}: неизвестная роль speaker")
        if not isinstance(message.get("text"), str) or not isinstance(message.get("timestamp"), str):
            raise ValidationError(f"Реплика {index}: text и timestamp должны быть строками")
        message_id = message.get("message_id", f"m{index:05d}")
        if not isinstance(message_id, str) or not message_id or message_id in seen:
            raise ValidationError("message_id должны быть непустыми уникальными строками")
        seen.add(message_id)
        total += len(message["text"])
        messages.append({"message_id": message_id, "index": index,
                         "timestamp": message["timestamp"], "speaker": message["speaker"],
                         "text": message["text"]})
    if total > 200000:
        raise ValidationError("Транскрипт превышает 200000 символов; требуется явное разбиение")
    return {"conversation_id": raw["conversation_id"], "channel": raw.get("channel", "unknown"),
            "language": raw.get("language", "unknown"), "transcript": messages,
            "audio_url": raw.get("audio_url"), "conversation_url": raw.get("conversation_url")}


def records_from_payload(payload):
    if isinstance(payload, dict) and "isSuccess" in payload:
        if payload["isSuccess"] is not True:
            raise ValidationError("DEV API вернул isSuccess != true")
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("records"), list):
            raise ValidationError("Отсутствует data.records")
        records = data["records"]
        if data.get("total_records", len(records)) != len(records):
            raise ValidationError("total_records не совпадает с длиной records")
    elif isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict) and "conversation_id" in payload:
        records = [payload]
    else:
        raise ValidationError("Ожидается DEV envelope, массив диалогов или один диалог")
    normalized = [normalize_conversation(r) for r in records]
    ids = [r["conversation_id"] for r in normalized]
    if len(ids) != len(set(ids)):
        raise ValidationError("Повторяющиеся conversation_id")
    return normalized


def validate_knowledge(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("documents"), list):
        raise ValidationError("База знаний: ожидается documents[]")
    seen = set()
    for doc in raw["documents"]:
        if not isinstance(doc, dict) or any(not isinstance(doc.get(k), str) or not doc[k].strip()
                                           for k in ("id", "title", "text")):
            raise ValidationError("Документ базы знаний требует id, title, text")
        if doc["id"] in seen:
            raise ValidationError("Повторяющийся id документа базы знаний")
        seen.add(doc["id"])
    if len(json.dumps(raw, ensure_ascii=False)) > 200000:
        raise ValidationError("База знаний превышает 200000 символов")
    return raw
