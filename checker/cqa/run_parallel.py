"""Bounded batch execution. Independent providers isolate per-dialogue usage accounting."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import argparse
from pathlib import Path
import json
import re
import os

from .engine import Evaluator
from .io import load_env, read_json, records_from_payload, write_json, ValidationError, digest, normalize_conversation
from .provider import OpenAIProvider, ProviderError, QuotaError
from .local_provider import make_provider
from .evidence import validate_assessment
from .rubric import calculate_score
from .report import render_report


ROOT = Path(__file__).resolve().parent.parent


def run(dataset, output, workers=8, provider_name=None, resume_from=None):
    load_env(ROOT / '.env.local')
    provider_name = provider_name or os.environ.get('CQA_PROVIDER','openai')
    output = Path(output)
    records = records_from_payload(read_json(dataset))
    rubric = read_json(ROOT / 'config/checklist.json')
    knowledge = read_json(ROOT / 'config/knowledge.example.json')
    if provider_name == 'ollama':
        workers = 1
    resumed = {}
    if resume_from:
        source = Path(resume_from)
        previous = read_json(source/'batch-summary.json')
        for item in previous['results']:
            if item.get('file'):
                resumed[(item['conversation_id'],item['target_role'])] = read_json(source/item['file'])
    jobs = [(r, role) for r in records for role in ('bot','operator') if any(m['speaker']==role for m in r['transcript'])]
    skipped = [{'conversation_id':r['conversation_id'],'target_role':role,'status':'not_evaluated_no_target'}
               for r in records for role in ('bot','operator') if not any(m['speaker']==role for m in r['transcript'])]
    rows, fatal, next_index = {}, None, 0

    def evaluate(job):
        conversation, role = job
        base = {'conversation_id':conversation['conversation_id'],'target_role':role}
        try:
            result = resumed.get((conversation['conversation_id'],role))
            if result:
                if digest(result['conversation']) != digest(normalize_conversation(conversation)) or digest(result['rubric']) != digest(rubric) or digest(result['knowledge']) != digest(knowledge):
                    raise ValidationError('Исходные данные или конфигурация сохранённой оценки отличаются')
                for assessment in (result['primary_assessment'],result['independent_review']):
                    validate_assessment(assessment,rubric,result['conversation'],knowledge,role)
                if result['score']['total']!=calculate_score(result['primary_assessment'],rubric)['total']:
                    raise ValidationError('Неверный расчёт сохранённой оценки')
            else:
                result = Evaluator(make_provider(provider_name),rubric,knowledge,ROOT/'cache').evaluate(conversation,role)
            name = result['fingerprint'][:20]
            write_json(output/(name+'.json'),result)
            (output/(name+'.html')).write_text(render_report(result),encoding='utf-8')
            return {**base,'status':result['status'],'file':name+'.json','provisional_total':result['score']['total'],
                    'final_score':result['final_score'],'cached':result['cached'],
                    'model':result['provider']['model'],'provider':result['provider'].get('provider','openai'),
                    'resumed':(conversation['conversation_id'],role) in resumed}, None
        except (ValidationError,ProviderError) as error:
            return {**base,'status':'not_evaluated','error':str(error)}, error if isinstance(error,QuotaError) else None
        except Exception as error:
            return {**base,'status':'not_evaluated','error':'Internal '+type(error).__name__}, None

    def save(pending_count):
        pending = [{'conversation_id':r['conversation_id'],'target_role':role,'status':'not_attempted',
                    'reason':'batch_stopped_quota' if fatal else 'pending'}
                   for i,(r,role) in enumerate(jobs) if i not in rows]
        successful = sum(r['status']!='not_evaluated' for r in rows.values())
        write_json(output/'batch-summary.json', {'results':[rows[i] for i in sorted(rows)],'skipped':skipped,
                   'not_attempted':pending,'fatal_error':{'code':fatal.code,'error':str(fatal)} if fatal else None,
                   'status':'blocked_quota' if fatal else 'running' if pending_count else 'completed_with_errors' if successful<len(rows) else 'completed',
                   'selected_conversations':len(records),'selected_evaluations':len(jobs),
                   'attempted_evaluations':len(rows),'successful_evaluations':successful,
                   'failed_evaluations':len(rows)-successful,'not_attempted_evaluations':len(pending),
                   'workers':workers})

    output.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        active = {}
        while next_index < min(workers,len(jobs)):
            active[pool.submit(evaluate,jobs[next_index])] = next_index
            next_index += 1
        while active:
            done,_ = wait(active,return_when=FIRST_COMPLETED)
            for future in done:
                index = active.pop(future)
                row, quota = future.result()
                rows[index]=row
                fatal = fatal or quota
                print(f"[{len(rows)}/{len(jobs)}] {row['conversation_id']} {row['target_role']}: {row['status']}",flush=True)
            while not fatal and next_index<len(jobs) and len(active)<workers:
                active[pool.submit(evaluate,jobs[next_index])]=next_index
                next_index+=1
            save(len(active))
    return 1 if fatal or any(r['status']=='not_evaluated' for r in rows.values()) else 0


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--workers',type=int,default=8,choices=range(1,17))
    parser.add_argument('--provider',choices=['openai','ollama'])
    parser.add_argument('--resume-from',help='Папка evaluations предыдущего запуска; удачные результаты сохраняются')
    args=parser.parse_args()
    raise SystemExit(run(args.dataset,args.output,args.workers,args.provider,args.resume_from))
