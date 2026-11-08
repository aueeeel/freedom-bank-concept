"""Outbound-only authenticated worker. Never exposes the local CQA server to the internet."""
import argparse,copy,json,os,socket,threading,time,urllib.request,urllib.error,uuid
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlsplit
from .io import load_env,read_json,write_json,digest
from .local_provider import OllamaProvider
from .engine import Evaluator,disagreements,review_reasons
from .appeals import reconsider
from .rubric import calculate_score

ROOT=Path(__file__).resolve().parent.parent
@contextmanager
def stay_awake():
    previous=None;api=None
    if os.name=='nt':
        import ctypes
        api=ctypes.windll.kernel32.SetThreadExecutionState
        api.argtypes=[ctypes.c_uint];api.restype=ctypes.c_uint
        previous=api(0x80000001)
    try:yield
    finally:
        if api and previous:api(previous)

def main():
    p=argparse.ArgumentParser();p.add_argument('--once',action='store_true');args=p.parse_args()
    load_env(ROOT/'.env.worker.local')
    url=os.environ.get('CQA_CLOUD_URL','').rstrip('/')
    if urlsplit(url).scheme!='https' or urlsplit(url).hostname!='freedom-bank-concept.vercel.app':
        raise ValueError('Worker requires the configured production HTTPS endpoint')
    token=os.environ.get('CQA_WORKER_TOKEN','')
    if len(token)<40:raise ValueError('Missing worker credential')
    worker_file=ROOT/'data/cloud/worker-id.json'
    worker_id=read_json(worker_file)['id'] if worker_file.exists() else str(uuid.uuid4())
    write_json(worker_file,{'id':worker_id})
    wake_file=ROOT/'data/cloud/wake.signal'
    wake_stamp=wake_file.stat().st_mtime_ns if wake_file.exists() else 0
    def idle_wait(seconds):
        nonlocal wake_stamp
        for _ in range(seconds):
            time.sleep(1)
            stamp=wake_file.stat().st_mtime_ns if wake_file.exists() else 0
            if stamp!=wake_stamp:wake_stamp=stamp;return
    def call(action,data):
        req=urllib.request.Request(url+'?action='+action,data=json.dumps(data,ensure_ascii=False).encode(),
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
    @stay_awake()
    def complete(claim):
        job=claim['job'];data=job['input'];cache=ROOT/'data/cloud/cache'
        print(json.dumps({'job':job['id'],'role':data['target_role'],'status':'started'},ensure_ascii=False),flush=True)
        checkpoint=ROOT/'data/cloud/checkpoints'/(job['id']+'.json')
        payload={'worker_id':worker_id,'id':job['id'],'lease':job['lease']}
        stop=threading.Event()
        def heartbeat():
            while not stop.wait(600):
                try:call('heartbeat',payload)
                except Exception:print('Heartbeat unavailable; result retained locally.',flush=True)
        thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
        try:
            if checkpoint.exists():result=read_json(checkpoint)
            else:
                provider=OllamaProvider(timeout=1200)
                rubric=read_json(ROOT/'config/checklist.json')
                profile=data.get('scoring_profile',{'version':'legacy-original-weights','weights':[10,15,20,20,15,15,5,0]})
                expected=[5,20,10,30,15,15,5,0]
                if profile['weights'] not in [expected,[10,15,20,20,15,15,5,0]]:raise ValueError('Unknown scoring weights')
                for criterion,weight in zip(rubric['criteria'],profile['weights']):criterion['weight']=weight
                if profile['weights']!=expected:rubric['version']='freedom-user-calibrated-2';rubric['name']='Freedom Broker — чек-лист с согласованным завершением бота'
                evaluator=Evaluator(provider,rubric,read_json(ROOT/'config/knowledge.example.json'),cache)
                if job.get('appeal'):
                    appeal=job['appeal'];previous=job['previous']
                    checked=reconsider(provider,evaluator.rubric,evaluator.knowledge,data['conversation'],data['target_role'],previous,
                        appeal['criterion_id'],appeal['argument'],appeal['selected_ids'])
                    result=copy.deepcopy(previous)
                    result['final_assessment']['criteria']=[checked['decision'] if r['criterion_id']==appeal['criterion_id'] else r for r in result['final_assessment']['criteria']]
                    result['primary_assessment']['criteria']=[checked['decision'] if r['criterion_id']==appeal['criterion_id'] else r for r in result['primary_assessment']['criteria']]
                    result['independent_review']['criteria']=[checked['review_decision'] if r['criterion_id']==appeal['criterion_id'] else r for r in result['independent_review']['criteria']]
                    result.pop('display_assessment',None)
                    result['score']=calculate_score(result['final_assessment'],evaluator.rubric)
                    result['independent_score']=calculate_score(result['independent_review'],evaluator.rubric)
                    result['disagreements']=disagreements(result['primary_assessment'],result['independent_review'])
                    result['review_reasons']=review_reasons(result['primary_assessment'],result['independent_review'],result['disagreements'],require_manual=True)
                    result['parent_fingerprint']=previous['fingerprint']
                    result['created_at']=datetime.now(timezone.utc).isoformat()
                    result['cached']=False
                    result['usage']=[*result.get('usage',[]),*checked.get('usage',[])]
                    result.update(status='needs_review',final_score=None,appeal_review=checked,
                        fingerprint=digest({'previous':previous['fingerprint'],'appeal':appeal,'provider':provider.identity}),
                        provider=provider.identity)
                    result['amendments']=[*result.get('amendments',[]),{'source':'ai_appeal_provisional','criterion_id':appeal['criterion_id'],'argument':appeal['argument'],'training_approved':False}]
                else:result=evaluator.evaluate(data['conversation'],data['target_role'])
                result['scoring_profile']=profile
                write_json(checkpoint,result)
            # Network failures never turn a completed model result into a failed evaluation.
            for attempt in range(6):
                try:call('finish',{**payload,'result':result});break
                except Exception:
                    if attempt==5:raise
                    stop.wait(min(60,5*2**attempt))
            print(json.dumps({'job':job['id'],'role':data['target_role'],'status':'completed','score':result['score']['total']},ensure_ascii=False),flush=True)
        except Exception as exc:
            if not checkpoint.exists():
                try:call('finish',{**payload,'error':'Локальная проверка не завершилась: '+str(exc)[:300]})
                except Exception:pass
            print(json.dumps({'job':job['id'],'status':'error','error_type':type(exc).__name__},ensure_ascii=False),flush=True)
        finally:stop.set();thread.join(timeout=1)
    while True:
        try:
            claim=call('claim',{'worker_id':worker_id})
            if claim.get('job'):complete(claim)
            elif args.once:break
            else:idle_wait(600)
        except Exception as exc:
            print(json.dumps({'status':'connection_error','error_type':type(exc).__name__,'http_status':getattr(exc,'code',None)}),flush=True)
            if args.once:raise
            idle_wait(60)
        if args.once:break

if __name__=='__main__':main()
