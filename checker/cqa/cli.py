from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .engine import Evaluator, resolve_criterion
from .io import ValidationError, digest, load_env, read_json, records_from_payload, validate_knowledge, write_json
from .provider import OpenAIProvider, ProviderError, QuotaError
from .local_provider import make_provider
from .report import render_report
from .rubric import calculate_score, validate_rubric


ROOT = Path(__file__).resolve().parent.parent


def build_parser():
    parser = argparse.ArgumentParser(description="CQA — проверка ответов bot/operator, RU/KZ/EN")
    parser.add_argument("--env", default=str(ROOT / ".env.local"))
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect", help="Проверить формат и состав датасета, без вызова модели")
    inspect.add_argument("input")
    fetch = sub.add_parser("fetch", help="GET DEV_DATASET_URL из локального окружения")
    fetch.add_argument("--output", default=str(ROOT / "data/dev.json"))
    run = sub.add_parser("evaluate", help="Оценить один диалог или набор")
    run.add_argument("input")
    run.add_argument("--role", choices=["bot", "operator", "both"], default="both")
    run.add_argument("--conversation-id")
    run.add_argument("--limit", type=int, default=1, help="По умолчанию только 1 диалог; 0 — весь набор")
    run.add_argument("--rubric", default=str(ROOT / "config/checklist.json"))
    run.add_argument("--knowledge", default=str(ROOT / "config/knowledge.example.json"))
    run.add_argument("--output-dir", default=str(ROOT / "results"))
    run.add_argument("--cache-dir", default=str(ROOT / "cache"))
    run.add_argument("--no-cache", action="store_true")
    run.add_argument("--model")
    run.add_argument("--review-model")
    run.add_argument("--provider", choices=["openai", "ollama"])
    report = sub.add_parser("report", help="Сформировать HTML-отчёт из JSON результата")
    report.add_argument("result")
    report.add_argument("--output", required=True)
    score = sub.add_parser("score", help="Пересчитать баллы без вызова модели")
    score.add_argument("assessment")
    score.add_argument("--rubric", default=str(ROOT / "config/checklist.json"))
    resolve = sub.add_parser("resolve", help="Сохранить решение проверяющего с аудитом")
    resolve.add_argument("result")
    resolve.add_argument("--decision", required=True, help="JSON одной строки criteria из assessment")
    resolve.add_argument("--reviewer", required=True)
    resolve.add_argument("--reason", required=True)
    resolve.add_argument("--output", required=True)
    serve = sub.add_parser("serve", help="Запустить локальный HTTP API")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--allow-origin", help="Один точный Origin вашего фронтенда")
    serve.add_argument("--rubric", default=str(ROOT / "config/checklist.json"))
    serve.add_argument("--knowledge", default=str(ROOT / "config/knowledge.example.json"))
    benchmark = sub.add_parser("benchmark", help="Сравнить результаты с разметкой; тип и независимость разметки указываются отдельно")
    benchmark.add_argument("--labels", required=True)
    benchmark.add_argument("--results-dir", default=str(ROOT / "results"))
    benchmark.add_argument("--output", required=True)
    web = sub.add_parser('web', help='Сайт: загрузка, оценки, апелляции и подтверждённые примеры')
    web.add_argument('--port', type=int, default=8088)
    web.add_argument('--static-dir')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    load_env(args.env)
    try:
        return execute(args)
    except (ValidationError, ProviderError, OSError, ValueError) as exc:
        # Do not include network exception strings: those may contain signed URLs.
        message = str(exc) if isinstance(exc, (ValidationError, ProviderError)) else "Ошибка файла или формата JSON"
        print(message, file=sys.stderr)
        return 1


def execute(args):
    if args.command == 'web':
        from .webapp import serve_web
        if not 1 <= args.port <= 65535:
            raise ValidationError('Неверный порт')
        serve_web(ROOT, args.port, args.static_dir)
        return 0
    if args.command == "inspect":
        records = records_from_payload(read_json(args.input))
        print(json.dumps({"records": len(records), "languages": dict(Counter(r["language"] for r in records)),
                          "channels": dict(Counter(r["channel"] for r in records)),
                          "roles": dict(Counter(m["speaker"] for r in records for m in r["transcript"])),
                          "with_bot": sum(any(m["speaker"] == "bot" for m in r["transcript"]) for r in records),
                          "with_operator": sum(any(m["speaker"] == "operator" for m in r["transcript"]) for r in records)},
                         ensure_ascii=False, indent=2))
        return 0
    if args.command == "fetch":
        url = os.environ.get("DEV_DATASET_URL", "")
        if urlsplit(url).scheme != "https":
            raise ValidationError("Задайте HTTPS DEV_DATASET_URL в локальном окружении")
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                body = response.read(20000001)
            if len(body) > 20000000:
                raise ValidationError("DEV API ответ превышает 20 MB")
            payload = json.loads(body.decode("utf-8-sig"))
        except (urllib.error.URLError, TimeoutError):
            raise ProviderError("DEV API недоступен; можно импортировать сохранённый JSON") from None
        records = records_from_payload(payload)
        write_json(args.output, payload)
        print(f"Сохранено диалогов: {len(records)}")
        return 0
    if args.command == "score":
        print(json.dumps(calculate_score(read_json(args.assessment), read_json(args.rubric)), ensure_ascii=False, indent=2))
        return 0
    if args.command == "report":
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(render_report(read_json(args.result)), encoding="utf-8")
        print("HTML-отчёт сохранён")
        return 0
    if args.command == "resolve":
        write_json(args.output, resolve_criterion(read_json(args.result), read_json(args.decision), args.reviewer, args.reason))
        print("Решение сохранено; итог пересчитан; исходные оценки сохранены")
        return 0
    if args.command == "benchmark":
        from .metrics import benchmark
        output = benchmark(read_json(args.labels), Path(args.results_dir))
        write_json(args.output, output)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    rubric = validate_rubric(read_json(args.rubric))
    knowledge = validate_knowledge(read_json(args.knowledge))
    if args.command == "serve":
        from .server import serve
        if not 1 <= args.port <= 65535:
            raise ValidationError("Неверный порт")
        serve(rubric, knowledge, ROOT / "cache", args.port, args.allow_origin)
        return 0
    records = records_from_payload(read_json(args.input))
    if args.limit < 0:
        raise ValidationError("limit должен быть >= 0")
    if args.conversation_id:
        records = [r for r in records if r["conversation_id"] == args.conversation_id]
        if not records:
            raise ValidationError("conversation_id не найден")
    roles = ("bot", "operator") if args.role == "both" else (args.role,)
    eligible = [r for r in records if any(m["speaker"] in roles for m in r["transcript"])]
    skipped = [{"conversation_id": r["conversation_id"], "target_role": role, "status": "not_evaluated_no_target"}
               for r in records for role in roles if not any(m["speaker"] == role for m in r["transcript"])]
    if args.limit:
        eligible = eligible[:args.limit]
    if not eligible:
        raise ValidationError("В выбранных диалогах нет реплик проверяемой роли")
    provider = make_provider(provider=args.provider, model=args.model, review_model=args.review_model) if args.provider or os.environ.get('CQA_PROVIDER') else OpenAIProvider(model=args.model, review_model=args.review_model)
    evaluator = Evaluator(provider, rubric, knowledge, args.cache_dir)
    output_dir = Path(args.output_dir)
    summary, failed, fatal_error = [], False, None
    jobs = [(r, role) for r in eligible for role in roles if any(m["speaker"] == role for m in r["transcript"])]
    for index, (conversation, role) in enumerate(jobs):
        try:
            result = evaluator.evaluate(conversation, role, use_cache=not args.no_cache)
            name = result["fingerprint"][:20]
            write_json(output_dir / (name + ".json"), result)
            (output_dir / (name + ".html")).write_text(render_report(result), encoding="utf-8")
            summary.append({"conversation_id": conversation["conversation_id"], "target_role": role, "file": name + ".json",
                            "status": result["status"], "provisional_total": result["score"]["total"],
                            "final_score": result["final_score"], "cached": result["cached"]})
        except (ValidationError, ProviderError) as exc:
            failed = True
            summary.append({"conversation_id": conversation["conversation_id"], "target_role": role, "status": "not_evaluated", "error": str(exc)})
            if isinstance(exc, QuotaError):
                fatal_error = {"code": exc.code, "error": str(exc)}
        not_attempted = [{"conversation_id": r["conversation_id"], "target_role": target,
                          "status": "not_attempted", "reason": "batch_stopped_quota"}
                         for r, target in jobs[index + 1:]] if fatal_error else []
        successful = sum(item["status"] != "not_evaluated" for item in summary)
        write_json(output_dir / "batch-summary.json", {"results": summary, "skipped": skipped,
                   "not_attempted": not_attempted, "fatal_error": fatal_error,
                   "status": "blocked_quota" if fatal_error else "running" if index + 1 < len(jobs) else "completed_with_errors" if failed else "completed",
                   "selected_conversations": len(eligible), "selected_evaluations": len(jobs),
                   "attempted_evaluations": len(summary), "successful_evaluations": successful,
                   "failed_evaluations": len(summary) - successful,
                   "not_attempted_evaluations": len(not_attempted)})
        print(f"[{index + 1}/{len(jobs)}] {role}: {summary[-1]['status']}", flush=True)
        if fatal_error:
            print(f"Остановка: {fatal_error['code']}. Успешно оценено: {successful}. Не запускалось: {len(not_attempted)}.", flush=True)
            break
    return 1 if failed else 0
