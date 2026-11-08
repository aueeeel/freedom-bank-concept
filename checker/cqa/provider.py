from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from .io import ValidationError
from .schemas import validate_shape


class ProviderError(RuntimeError):
    pass


class QuotaError(ProviderError):
    """Global billing failure: further subjects in this run must not call the API."""
    def __init__(self, message, code="insufficient_quota"):
        super().__init__(message)
        self.code = code


class OpenAIProvider:
    """Minimal Responses API client. No third-party dependency, raw secrets or API bodies in errors."""
    def __init__(self, api_key=None, model=None, review_model=None, effort=None, timeout=180, opener=None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model or os.environ.get("OPENAI_MODEL", "gpt-6-astra")
        self.review_model = review_model or os.environ.get("OPENAI_REVIEW_MODEL", self.model)
        self.effort = effort or os.environ.get("OPENAI_REASONING_EFFORT", "high")
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen
        self.usage = []
        if not self.api_key.strip():
            raise ProviderError("OPENAI_API_KEY не настроен: живая оценка недоступна")

    @property
    def identity(self):
        return {"model": self.model, "review_model": self.review_model, "reasoning_effort": self.effort}

    def structured(self, stage, instructions, payload, schema):
        model = self.review_model if stage == "review" else self.model
        body = {"model": model, "instructions": instructions,
                "input": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                "store": False, "max_output_tokens": 20000,
                "reasoning": {"effort": self.effort},
                "text": {"format": {"type": "json_schema", "name": "cqa_" + stage,
                                    "schema": schema, "strict": True}}}
        request = urllib.request.Request("https://api.openai.com/v1/responses",
                                         data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                         headers={"Authorization": "Bearer " + self.api_key,
                                                  "Content-Type": "application/json"}, method="POST")
        for attempt in range(3):
            try:
                with self.opener(request, timeout=self.timeout) as response:
                    raw = json.load(response)
                break
            except urllib.error.HTTPError as exc:
                status = exc.code
                try:
                    error = json.load(exc).get("error", {})
                except (ValueError, OSError, AttributeError):
                    error = {}
                exc.close()
                code, error_type = error.get("code"), error.get("type")
                # A zero balance is permanent until billing changes, even though the status is 429.
                if error_type == "insufficient_quota" or code in {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"}:
                    safe_code = code if code in {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"} else "billing_limit"
                    raise QuotaError("OpenAI HTTP 429: insufficient_quota / " + safe_code +
                                     "; требуется пополнение баланса или изменение лимита в Platform; повтор не выполняется",
                                     code=safe_code) from None
                if status in {429, 500, 502, 503, 504} and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                label = {401: "неверный или истёкший API-ключ", 403: "нет доступа к модели/проекту",
                         429: "лимит запросов либо недостаточно средств"}.get(status, "ошибка API")
                raise ProviderError(f"OpenAI HTTP {status}: {label}") from None
            except (OSError, ValueError) as exc:
                raise ProviderError("Сеть недоступна или API вернул некорректный ответ") from None
        usage = raw.get("usage") or {}
        self.usage.append({"stage": stage, "response_id": raw.get("id"), "model": raw.get("model", model),
                           "input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)})
        if raw.get("status") != "completed":
            raise ProviderError("Ответ модели не завершён; оценка не публикуется")
        chunks = []
        for item in raw.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "refusal":
                    raise ProviderError("Модель отказалась от оценки; требуется ручная проверка")
                if content.get("type") == "output_text":
                    chunks.append(content["text"])
        try:
            parsed = json.loads("".join(chunks))
            validate_shape(parsed, schema)
        except (ValueError, KeyError, TypeError) as exc:
            raise ValidationError("Ответ модели не соответствует JSON-схеме") from None
        return parsed
