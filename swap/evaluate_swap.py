"""Only run after receiving the organizers' additional instruction."""
import argparse,json,os,sys
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--checker-root',required=True);parser.add_argument('--rubric',required=True);parser.add_argument('--confirm-evaluation',action='store_true');args=parser.parse_args()
if not args.confirm_evaluation:parser.error('SWAP is intentionally unevaluated. Pass --confirm-evaluation only after the additional instruction.')
checker=Path(args.checker_root).resolve();sys.path[:0]=[str(checker),str(Path(__file__).resolve().parents[1]/'scripts/submission')]
os.environ['CQA_LOCAL_SEMANTIC_FACTS']='0' # Interpret the supplied rubric, not hardcoded criterion meanings.
from cqa.io import read_json,write_json
from cqa.rubric import validate_rubric
from cqa.engine import Evaluator
from cqa.local_provider import OllamaProvider
from submission_format import package,convert,validate
folder=Path(__file__).resolve().parent;rubric=validate_rubric(read_json(Path(args.rubric).resolve()));records=read_json(folder/'swap_dialogues.json');rows=[]
for conv in records:
 try:
  result=Evaluator(OllamaProvider(timeout=600),rubric,{'version':'none','documents':[]},folder/'cache',calibration={'examples':[]}).evaluate(conv,'operator')
  write_json(folder/'evaluations'/(conv['conversation_id']+'.json'),result);row=convert(result,conv)
  # This generic demo supports the official eight-criterion JSON structure only.
  if [c['weight'] for c in rubric['criteria']]!=[10,15,20,20,15,15,5,0]:
   row['score']={'final_score':result['score']['total'],'critical_flag':next(r['answer']=='yes' for r in result['final_assessment']['criteria'] if r['criterion_id']=='08')}
  rows.append(row)
 except Exception as e:rows.append({'conversation_id':conv['conversation_id'],'status':'error','criteria':[],'score':None,'error':str(e)[:400]})
output=package(rows,'qwen3.5:4b','local');write_json(folder/'results.swap.json',output)
print('Saved SWAP results separately. Check the additional instruction before submitting this file.')
