"""A locally trained TF-IDF retriever; it retrieves examples, never assigns grades."""
import math
import gzip,json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from .io import read_json,digest

PATH=Path(__file__).resolve().parent.parent/'config/learned_examples.json'

def tokens(text):
    words=re.findall(r'[^\W\d_]{3,}',text.casefold(),flags=re.UNICODE)
    return words+['#'+word[i:i+4] for word in words for i in range(max(0,len(word)-3))]

def vector(text,idf):
    counts=Counter(tokens(text)); values={w:(1+math.log(n))*idf[w] for w,n in counts.items() if w in idf}
    norm=math.sqrt(sum(x*x for x in values.values())) or 1
    return {w:x/norm for w,x in values.items()}

def scene_text(conversation):
    return '\n'.join(m['speaker']+': '+m['text'] for m in conversation['transcript'])

@lru_cache(maxsize=3)
def _load(stamp):
    if PATH.exists():return read_json(PATH)
    with gzip.open(PATH.with_suffix('.json.gz'),'rt',encoding='utf-8') as stream:return json.load(stream)

def load_memory():
    source=PATH if PATH.exists() else PATH.with_suffix('.json.gz')
    return _load(source.stat().st_mtime_ns) if source.exists() else None

def memory_identity():
    data=load_memory()
    return data.get('content_digest','none') if data else 'none'

def retrieve(criterion_id,conversation,role,limit=3):
    memory=load_memory()
    if not memory:return []
    if memory.get('rubric_hash')!=digest(read_json(PATH.with_name('checklist.json'))):return []
    own_signature=digest([(m['speaker'],m['text']) for m in conversation['transcript']])
    own_family=memory['training_ids'].get(conversation['conversation_id'])
    query=vector(scene_text(conversation),memory['idf'])
    eligible=[]
    for example in memory['examples']:
        if example['criterion_id']!=criterion_id or example['signature']==own_signature or own_family and example['family']==own_family:continue
        if criterion_id in {'01','07'} and example['target_role']!=role:continue
        similarity=sum(value*example['vector'].get(word,0) for word,value in query.items())
        eligible.append((similarity,example))
    eligible.sort(key=lambda x:x[0],reverse=True)
    chosen=[]; outcomes=set()
    for _,example in eligible:
        outcome=(example['answer'],example['value'])
        if outcome in outcomes:continue
        chosen.append(example);outcomes.add(outcome)
        if len(chosen)==limit:break
    return [{'source':'assistant_authored_training_lesson','lesson':x.get('lesson',x['reason'])}
            for x in chosen]
