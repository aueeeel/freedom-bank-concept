import html
from urllib.parse import urlsplit


def render_report(result):
    escape = lambda s: html.escape(str(s), quote=True)
    messages = result["conversation"]["transcript"]
    anchors = {m["message_id"]: f"message-{i}" for i, m in enumerate(messages)}
    checklist = {c["id"]: c for c in result["rubric"]["criteria"]}
    points = {c["criterion_id"]: c for c in result["score"]["criteria"]}
    labels = {"yes": "Да", "no": "Нет", "na": "N/A", "score": "Шкала"}
    blocks = []
    for row in result["display_assessment"]["criteria"]:
        cid = row["criterion_id"]
        refs = "".join(f'<li><a href="#{anchors[e["message_id"]]}">{escape(e["timestamp"])} · {escape(e["speaker"])}</a>'
                       f'<blockquote>{escape(e["quote"])}</blockquote></li>' for e in row["evidence"])
        checked = row["checked_range"]
        if checked:
            refs += f'<li>Проверенный участок: <a href="#{anchors[checked["start_message_id"]]}">начало</a> — <a href="#{anchors[checked["end_message_id"]]}">конец</a></li>'
        if row["na_reason"]:
            refs += f'<li>N/A: {escape(row["na_reason"])}</li>'
        for ref in row["knowledge_evidence"]:
            refs += f'<li>Документ {escape(ref["document_id"])}: <q>{escape(ref["quote"])}</q></li>'
        answer = str(row["value"]) if row["answer"] == "score" else labels[row["answer"]]
        p = points[cid]
        blocks.append(f'<article><h3>{escape(cid)} · {escape(checklist[cid]["name"])} <span>{escape(answer)}</span></h3>'
                      f'<p>Вес {p["weight"]:g} → {p["effective_weight"]:g}; вклад {p["points"]:g}</p>'
                      f'<p>{escape(row["explanation"])}</p><ul>{refs}</ul></article>')
    transcript = "".join(f'<article id="message-{i}" class="message {escape(m["speaker"])}"><small>{escape(m["timestamp"])} · {escape(m["speaker"])} · {escape(m["message_id"])}</small><p>{escape(m["text"])}</p></article>'
                         for i, m in enumerate(messages))
    reasons = "".join(f'<li>{escape(r["criterion_id"])}: {escape(r["reason"])}</li>' for r in result["review_reasons"])
    differences = "".join(f'<li>{escape(d["criterion_id"])}: первый проход {escape(d["primary"])}; повторный {escape(d["review"])}</li>'
                          for d in result["disagreements"])
    links = []
    for key, label in (("audio_url", "Открыть аудиозапись"), ("conversation_url", "Открыть исходный диалог")):
        url = result["conversation"].get(key)
        if isinstance(url, str) and urlsplit(url).scheme in {"http", "https"}:
            links.append(f'<a href="{escape(url)}" target="_blank" rel="noopener noreferrer">{label}</a>')
    total = result["score"]["total"]
    score_label = "Не рассчитывается" if total is None else f"{total:.2f} / 100"
    banner = "Требуется ручная проверка. Балл предварительный." if result["status"] == "needs_review" else "Проверки пройдены. Точность модели требует проверки на экспертной разметке."
    return f'''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CQA · {escape(result["conversation_id"])}</title><style>
body{{font:16px/1.55 system-ui,sans-serif;background:#f3f5f8;color:#172439;margin:0}}header{{background:#14253b;color:white;padding:28px 5%}}header p{{margin:8px 0}}main{{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px 5%}}h1{{margin:0}}h2{{font-size:22px}}h3{{font-size:17px}}h3 span{{float:right}}article,.notice{{background:white;padding:18px;border-radius:12px;margin:12px 0;border:1px solid #dce3eb}}blockquote{{margin:8px 0;border-left:3px solid #488b75;padding-left:12px;white-space:pre-wrap}}a{{color:#176751}}header a{{color:#a6e2c8}}small{{color:#536477}}.message p{{white-space:pre-wrap}}.bot{{border-left:4px solid #26745e}}.operator{{border-left:4px solid #4c6dcc}}.system{{background:#e9edf3}}.notice{{color:#704800;background:#fff5da}}:target{{outline:3px solid #d18d00;scroll-margin-top:20px}}.transcript{{max-height:85vh;overflow:auto;padding:4px}}@media(max-width:850px){{main{{display:block}}.transcript{{max-height:none}}}}@media print{{main{{display:block}}.transcript{{max-height:none;overflow:visible}}}}
</style><header><h1>{escape(result["conversation_id"])} · {escape(score_label)}</h1><p>Проверяемая роль: {escape(result["target_role"])} · {escape(result["rubric"]["version"])} · {escape(result["status"])}</p><p>{" · ".join(links)}</p></header>
<main><section><div class="notice">{banner}<ul>{reasons}</ul></div><p>{escape(result["final_assessment"]["summary"])}</p>
<details><summary>Расхождения независимых проходов</summary><ul>{differences or "<li>Расхождений решений нет</li>"}</ul></details>
{"".join(blocks)}<p>Pipeline {escape(result["pipeline_version"])} · {escape(result["provider"]["model"])}</p></section><section><h2>Транскрипт</h2><div class="transcript">{transcript}</div></section></main></html>'''
