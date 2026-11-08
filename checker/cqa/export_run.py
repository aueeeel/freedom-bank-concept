"""Organize a finished batch and export one row per dialogue plus per-subject details."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import shutil

from .io import read_json, records_from_payload, write_json


STATUSES = {"automatically_checked": "Автопроверка пройдена", "needs_review": "Нужна ручная проверка",
            "not_evaluated": "Ошибка оценки", "not_attempted": "Не запускалось", "not_evaluated_no_target": "Участник отсутствует"}


def timestamp_seconds(raw):
    if re.fullmatch(r"\d+:\d{2}", raw):
        minutes, seconds = map(int, raw.split(":"))
        return minutes * 60 + seconds if seconds < 60 else None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return value.timestamp() if value.tzinfo else None
    except ValueError:
        return None


def timing(record):
    previous, gaps, issues = None, [], []
    for message in record["transcript"]:
        value = timestamp_seconds(message["timestamp"])
        if value is None:
            issues.append("Нераспознанная метка времени")
        if value is not None and previous is not None:
            gap = value - previous
            if gap < 0:
                issues.append("Время идёт назад")
            else:
                gaps.append(gap)
        previous = value
    return max(gaps) if gaps else None, "; ".join(sorted(set(issues)))


def csv_write(path, headers, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(headers)
        # CSV formula injection protection for any source/model-authored text.
        for row in rows:
            writer.writerow(["'" + x if isinstance(x, str) and x.startswith(("=", "+", "-", "@")) else x for x in row])


def export(dataset, run_dir):
    records = records_from_payload(read_json(dataset))
    summary = read_json(run_dir / "evaluations/batch-summary.json")
    index = {(x["conversation_id"], x["target_role"]): x
             for name in ("results", "skipped", "not_attempted") for x in summary.get(name, [])}
    subject_headers = ["Диалог", "Язык", "Канал", "Участник", "Статус", "Баллы основного прохода / 100",
                       "Баллы независимого прохода / 100", "Итог / 100",
                       "01 Контакт", "02 Потребность", "03 Идентификация", "04 Консультация",
                       "05 Эмпатия", "06 Ведение", "07 Завершение", "08 Грубая ошибка",
                       "Причины проверки / ошибка", "Отчёт", "Модель"]
    main_headers = ["Диалог", "Язык", "Канал", "Реплик", "Макс. интервал, сек.",
                    "Бот: балл / 100", "Бот: итог / 100", "Бот: статус",
                    "Оператор: балл / 100", "Оператор: итог / 100", "Оператор: статус", "Проверка времени", "Модель бота", "Модель оператора"]
    main, subjects, links = [], [], []
    aggregate = Counter()
    for record in records:
        cid = record["conversation_id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", cid):
            raise ValueError("Небезопасный conversation_id для имени папки")
        gap, issues = timing(record)
        main_row = [cid, record["language"], record["channel"], len(record["transcript"]), gap]
        models = []
        for role in ("bot", "operator"):
            entry = index.get((cid, role), {"status": "not_attempted"})
            status = entry["status"]
            preliminary, final, secondary, criterion_cells, reason, report = None, None, None, [None]*8, entry.get("error", entry.get("reason", "")), ""
            model = ''
            if entry.get("file"):
                result = read_json(run_dir / "evaluations" / entry["file"])
                folder = run_dir / "dialogues" / cid / role
                folder.mkdir(parents=True, exist_ok=True)
                write_json(folder / "evaluation.json", result)
                shutil.copyfile(run_dir / "evaluations" / Path(entry["file"]).with_suffix(".html"), folder / "report.html")
                preliminary, final = result["score"]["total"], result["final_score"]
                secondary = result["independent_score"]["total"]
                model = result['provider']['model']
                decisions = {r["criterion_id"]: r for r in result["primary_assessment"]["criteria"]}
                points = {r["criterion_id"]: r for r in result["score"]["criteria"]}
                criterion_cells = ["N/A" if decisions[f"{i:02d}"]["answer"] == "na" else points[f"{i:02d}"]["points"] for i in range(1,8)]
                criterion_cells.append("Да" if decisions["08"]["answer"] == "yes" else "Нет")
                reason = "; ".join(dict.fromkeys(r["criterion_id"] + ": " + r["reason"] for r in result["review_reasons"]))
                report = (Path("dialogues") / cid / role / "report.html").as_posix()
                links.append((cid, role, preliminary, final, STATUSES.get(status, status), report))
            aggregate[status] += 1
            main_row.extend([preliminary, final, STATUSES.get(status, status)])
            models.append(model)
            subjects.append([cid, record["language"], record["channel"], role, STATUSES.get(status, status),
                             preliminary, secondary, final, *criterion_cells, reason, report, model])
        main_row.extend([issues,*models])
        main.append(main_row)
    output = {"dialogue_headers": main_headers, "dialogues": main, "subject_headers": subject_headers,
              "subjects": subjects, "counts": dict(aggregate), "batch_status": summary["status"],
              "source_dataset": Path(dataset).name,
              "notes": "Баллы основного прохода предварительные при статусе «Нужна ручная проверка». Пустой итог не равен нулю. Интервалы времени справочные и не дают автоматического штрафа."}
    write_json(run_dir / "tables.json", output)
    csv_write(run_dir / "dialogue_scores.csv", main_headers, main)
    csv_write(run_dir / "subject_scores.csv", subject_headers, subjects)
    h = lambda x: html.escape(str(x))
    rows = "".join(f'<tr><td>{h(cid)}</td><td>{h(role)}</td><td>{h(score)}</td><td>{"—" if final is None else h(final)}</td><td>{h(status)}</td><td><a href="{h(link)}">Открыть</a></td></tr>' for cid, role, score, final, status, link in links)
    run_status=f"Состояние: {summary['status']}. Получено оценок: {summary['successful_evaluations']} из {summary['selected_evaluations']}."
    (run_dir / "index.html").write_text('<!doctype html><html lang="ru"><meta charset="utf-8"><title>CQA DEV</title><style>body{font:16px system-ui;margin:30px;color:#172439}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}th{background:#18354a;color:white}a{color:#176751}</style><h1>CQA DEV — результаты оценки</h1><p>'+h(run_status)+'</p><p>' + h(output["notes"]) + '</p><table><thead><tr><th>Диалог</th><th>Участник</th><th>Балл</th><th>Итог</th><th>Статус</th><th>Отчёт</th></tr></thead><tbody>'+rows+'</tbody></table></html>', encoding="utf-8")
    (run_dir / "README.txt").write_text("CQA DEV — запуск 7 ноября 2026\n\n"
        + f"Состояние запуска: {summary['status']}. Получено оценок: {summary['successful_evaluations']} из {summary['selected_evaluations']}.\n"
        + f"Ошибка оценки: {summary['failed_evaluations']}. Не запускалось: {summary['not_attempted_evaluations']}.\n\n"
        "dialogue_scores.xlsx — Excel: 65 диалогов, отдельно оценки бота и оператора.\n"
        "dialogue_scores.csv — та же сводная таблица в CSV.\n"
        "subject_scores.csv — детализация по участникам и критериям.\n"
        "index.html — открыть в браузере для навигации по отчётам.\n"
        "dialogues/<ID>/<bot|operator>/ — отчёт report.html и результат evaluation.json.\n"
        "evaluations/ — исходные результаты движка и batch-summary.json.\n\n" + output["notes"] + "\n\n"
        "N/A в критерии означает неприменимость. Отсутствие участника не считается нулевой оценкой.\n"
        "Грубые ошибки отмечаются отдельно и не обнуляют итог. Временные интервалы не доказывают удаление сообщений.\n", encoding="utf-8")
    print(json.dumps({"dialogues": len(main), "subject_rows": len(subjects), "statuses": dict(aggregate)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args()
    export(Path(args.dataset), Path(args.run_dir))
