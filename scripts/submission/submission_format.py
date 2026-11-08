"""Official appendix format. Scores are recomputed from values, never copied."""
from decimal import Decimal,ROUND_HALF_UP
IDS=['contact','discovery','identification','consultation','empathy','dialogue','closure','critical']
WEIGHTS=[10,15,20,20,15,15,5,0]
ALLOWED={'contact':[True,False],'discovery':[True,False,None],'identification':[True,False,None],'consultation':[0,5,10,15,20,None],'empathy':[True,False],'dialogue':[0,4,7,10],'closure':[True,False,None],'critical':[True,False]}
def allowed(code,value):return any(type(value) is type(v) and value==v for v in ALLOWED[code])
def score(criteria):
 rows={r['criterion_id']:r['value'] for r in criteria};earned=Decimal(0);available=Decimal(0)
 for code,weight in zip(IDS,WEIGHTS):
  value=rows[code]
  if value is None or not weight:continue
  available+=weight
  ratio=Decimal(value)/Decimal(20 if code=='consultation' else 10) if type(value) is int else Decimal(1 if value else 0)
  earned+=ratio*weight
 return {'final_score':float((earned/available*100).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)) if available else None,'critical_flag':rows['critical']}
def package(rows,name,mode):return {'schema_version':'1.0','team_name':'жи-ши пишется через','model':{'mode':mode,'name':name},'results':rows}
def validate(data,conversations):
 assert set(data)=={'schema_version','team_name','model','results'}
 assert data['schema_version']=='1.0' and data['team_name'].strip()
 assert set(data['model'])=={'mode','name'} and data['model']['mode'] in ['local','external_api','hybrid'] and data['model']['name'].strip()
 expected={c['conversation_id']:c for c in conversations};rows=data['results'];assert len(rows)==len(expected)
 assert len({r['conversation_id'] for r in rows})==len(rows) and {r['conversation_id'] for r in rows}==set(expected)
 for r in rows:
  assert set(r)==({'conversation_id','status','criteria','score'} if r['status']=='ok' else {'conversation_id','status','criteria','score','error'})
  if r['status']=='error':assert r['criteria']==[] and r['score'] is None and isinstance(r['error'],str) and r['error'].strip();continue
  assert r['status']=='ok' and len(r['criteria'])==8 and {e['criterion_id'] for e in r['criteria']}==set(IDS)
  for e in r['criteria']:
   assert set(e)=={'criterion_id','value','rationale','evidence_turns'} and allowed(e['criterion_id'],e['value'])
   assert isinstance(e['rationale'],str) and e['rationale'].strip()
   assert isinstance(e['evidence_turns'],list) and e['evidence_turns'] and len(set(e['evidence_turns']))==len(e['evidence_turns'])
   assert all(type(n) is int and 1<=n<=len(expected[r['conversation_id']]['transcript']) for n in e['evidence_turns'])
  assert r['score']==score(r['criteria']),r['conversation_id']
 return {'records':len(rows),'ok':sum(r['status']=='ok' for r in rows),'errors':sum(r['status']=='error' for r in rows),'unique_ids':True,'all_evidence_indices_valid':True,'scores_recomputed':True}
def convert(result,conversation):
 assert result['conversation_id']==conversation['conversation_id'] and result['target_role']=='operator'
 raw=result.get('conversation',conversation)
 assert [(m['speaker'],m['text']) for m in raw['transcript']]==[(m['speaker'],m['text']) for m in conversation['transcript']]
 positions={m['message_id']:i+1 for i,m in enumerate(raw['transcript'])}
 operator=[i+1 for i,m in enumerate(conversation['transcript']) if m['speaker']=='operator']
 first_client=next((i+1 for i,m in enumerate(conversation['transcript']) if m['speaker']=='client'),1)
 criteria=[]
 for i,code in enumerate(IDS):
  row=next(r for r in result['final_assessment']['criteria'] if r['criterion_id']==f'{i+1:02d}')
  value=row['value'] if row['answer']=='score' else None if row['answer']=='na' else row['answer']=='yes'
  evidence=[]
  for e in row.get('evidence',[]):
   assert e['message_id'] in positions
   n=positions[e['message_id']];assert e['quote'] in conversation['transcript'][n-1]['text']
   evidence.append(n)
  if not evidence and row.get('checked_range'):
   evidence += [positions[row['checked_range'][key]] for key in ['start_message_id','end_message_id']]
  if not evidence:evidence=[first_client]+operator[:1] if value is None else operator
  rationale=(row.get('explanation') or row.get('na_reason') or '').strip()
  if not rationale:raise ValueError('No rationale for '+code)
  criteria.append({'criterion_id':code,'value':value,'rationale':rationale,'evidence_turns':sorted(set(evidence))})
 return {'conversation_id':conversation['conversation_id'],'status':'ok','criteria':criteria,'score':score(criteria)}
