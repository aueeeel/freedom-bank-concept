from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import BoundedSemaphore

from .engine import Evaluator, resolve_criterion
from .io import ValidationError
from .provider import OpenAIProvider, ProviderError, QuotaError
from .local_provider import make_provider
from .rubric import calculate_score


def serve(rubric, knowledge, cache_dir, port=8080, allow_origin=None):
    slots = BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            # Avoid transcript content, signed URLs, request bodies or credentials in logs.
            pass

        def allowed(self):
            host = self.headers.get("Host", "")
            if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                return False
            origin = self.headers.get("Origin")
            return not origin or origin in {f"http://127.0.0.1:{port}", f"http://localhost:{port}", allow_origin}

        def send_json(self, status, data):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if allow_origin and self.headers.get("Origin") == allow_origin:
                self.send_header("Access-Control-Allow-Origin", allow_origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Origin/Host запрещён"})
            self.send_response(204)
            if allow_origin and self.headers.get("Origin") == allow_origin:
                self.send_header("Access-Control-Allow-Origin", allow_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Origin/Host запрещён"})
            if self.path == "/health":
                return self.send_json(200, {"ok": True, "live_model_tested": False})
            if self.path == "/rubric":
                return self.send_json(200, rubric)
            return self.send_json(404, {"error": "Неизвестный endpoint"})

        def do_POST(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Origin/Host запрещён"})
            if self.path not in {"/evaluate", "/score", "/resolve"}:
                return self.send_json(404, {"error": "Неизвестный endpoint"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8000000:
                    return self.send_json(413, {"error": "Допустимо 1–8000000 байт"})
                if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                    return self.send_json(415, {"error": "Требуется application/json"})
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValidationError("Тело запроса должно быть объектом")
                if self.path == "/score":
                    return self.send_json(200, calculate_score(payload["assessment"], payload.get("rubric", rubric)))
                if self.path == "/resolve":
                    return self.send_json(200, resolve_criterion(payload["result"], payload["decision"], payload["reviewer"], payload["reason"]))
                if not slots.acquire(blocking=False):
                    return self.send_json(429, {"error": "Предыдущая оценка ещё выполняется"})
                try:
                    evaluator = Evaluator(make_provider(), payload.get("rubric", rubric),
                                          payload.get("knowledge", knowledge), cache_dir)
                    target_role = payload.get("target_role", "both")
                    if target_role == "both":
                        from .io import normalize_conversation
                        conversation = normalize_conversation(payload["conversation"])
                        present = {m["speaker"] for m in conversation["transcript"]}
                        result = {"conversation_id": conversation["conversation_id"], "evaluations": {}, "skipped": [], "errors": {}}
                        quota_failure = None
                        for role in ("bot", "operator"):
                            if role in present:
                                if quota_failure:
                                    result["errors"][role] = {"status": "not_attempted", "reason": "batch_stopped_quota"}
                                    continue
                                try:
                                    result["evaluations"][role] = evaluator.evaluate(conversation, role, use_cache=payload.get("use_cache", True) is True)
                                except (ValidationError, ProviderError) as exc:
                                    result["errors"][role] = {"status": "not_evaluated", "error": str(exc)}
                                    if isinstance(exc, QuotaError):
                                        quota_failure = exc
                            else:
                                result["skipped"].append({"target_role": role, "status": "not_evaluated_no_target"})
                        if not result["evaluations"] and not result["errors"]:
                            raise ValidationError("Нет реплик ни bot, ни operator")
                        result["status"] = "blocked_quota" if quota_failure else "partial_failure" if result["errors"] else "completed"
                    else:
                        result = evaluator.evaluate(payload["conversation"], target_role,
                                                    use_cache=payload.get("use_cache", True) is True)
                finally:
                    slots.release()
                return self.send_json(200, result)
            except (ValidationError, ValueError, TypeError, KeyError) as exc:
                return self.send_json(400, {"error": str(exc) if isinstance(exc, ValidationError) else "Некорректный формат запроса"})
            except ProviderError as exc:
                return self.send_json(502, {"error": str(exc), "status": "not_evaluated"})
            except Exception:
                return self.send_json(500, {"error": "Внутренняя ошибка", "status": "not_evaluated"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"CQA API: http://127.0.0.1:{port} · Ctrl+C для остановки", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
