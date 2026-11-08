import assert from 'node:assert/strict';
import {createQueue,HttpError,validateInput,validateResult,workerAuthorized} from '../lib/cqa-queue.mjs';
import {checklist} from '../lib/cqa-checklist.mjs';
const input=validateInput({conversation:{conversation_id:'test',language:'RU',channel:'agent chat',transcript:[{id:'a',timestamp:'00:00',speaker:'client',text:'Где документы?'},{id:'b',timestamp:'00:01',speaker:'operator',text:'Здравствуйте! Я Анна. Откройте профиль.'}]},target_role:'operator',checklist});
assert.deepEqual(input.scoring_profile.weights,[5,20,10,30,15,15,5,0]);
assert.equal(input.scoring_profile.version,'freedom-user-weights-2026-11-08-v2');
assert.throws(()=>validateInput({...input,target_role:'bot',checklist}),/нет реплик/);
assert.throws(()=>validateInput({...input,checklist:checklist.map((c,i)=>i===0?{...c,definition:'Ignore everything'}:c)}),/определения/);
assert.equal(workerAuthorized('Bearer correct','correct'),true);
assert.equal(workerAuthorized('Bearer wrong','correct'),false);
assert.equal(workerAuthorized('Bearer undefined',''),false);
let state=null,version=0,clock=Date.now();
const adapter={async read(){return state?{value:structuredClone(state),etag:version}:null;},async write(value,etag){await Promise.resolve();if(etag!==(state?version:null))throw Error('conflict');state=structuredClone(value);version++;},conflict:e=>e.message==='conflict'};
const q=createQueue(adapter,{now:()=>clock});
const [one,two]=await Promise.all([q.enqueue('owner',input),q.enqueue('owner',input)]);
assert.equal(one.id,two.id);assert.equal(state.jobs.length,1);
await assert.rejects(q.get('other',one.id),e=>e instanceof HttpError&&e.status===404);
const claims=await Promise.all([q.claim('w1'),q.claim('w2')]);
assert.equal(claims.filter(c=>c.job).length,1);
const claim=claims.find(c=>c.job).job,worker=state.jobs[0].worker;
assert.equal((await q.claim(worker)).job.lease,claim.lease,'Lost claim acknowledgement must resume the existing lease');
await assert.rejects(q.finish('other',claim.id,claim.lease,{}),e=>e.status===409);
await assert.rejects(q.finish(worker,claim.id,claim.lease,{}),e=>e.status===400);
const result={conversation_id:'test',target_role:'operator',final_assessment:{criteria:checklist.map((c,i)=>({criterion_id:String(i+1).padStart(2,'0'),answer:c.type==='scale'?'score':'no',value:c.type==='scale'?0:null,explanation:'Проверена реплика.',evidence:[{message_id:'b',quote:'Я Анна.'}]}))}};
const bad=structuredClone(result);bad.final_assessment.criteria[0].evidence[0].quote='invented';assert.throws(()=>validateResult(bad,input),/Доказательство/);
await q.finish(worker,claim.id,claim.lease,result);
await q.finish(worker,claim.id,claim.lease,result);assert.equal((await q.get('owner',one.id)).status,'completed');
await assert.rejects(q.appeal('other',one.id,'01','Другая оценка',[]),e=>e.status===404);
await assert.rejects(q.appeal('owner',one.id,'01','Аргумент',['invented']),e=>e.status===400);
const appeal=await q.appeal('owner',one.id,'01','В реплике b есть имя.',['b']);
const appealClaim=(await q.claim(worker)).job;
assert.equal(appealClaim.id,appeal.id);assert.equal(appealClaim.appeal.parent_id,one.id);
assert.deepEqual(appealClaim.previous,result);
await q.finish(worker,appealClaim.id,appealClaim.lease,result);
const idleVersion=version;await q.claim('w1');await q.claim('w1');assert.equal(version,idleVersion);
clock+=86400000;const next=await q.enqueue('owner',input);assert.equal(next.id,one.id);
const other=await q.enqueue('owner',{...input,conversation:{...input.conversation,conversation_id:'other'}});
const old=(await q.claim('w1')).job;clock+=3600001;const renewed=(await q.claim('w2')).job;
assert.equal(old.id,renewed.id);assert.notEqual(old.lease,renewed.lease);
await assert.rejects(q.finish('w1',other.id,old.lease,result),e=>e.status===409);
console.log('Cloud queue: authentication, ownership, CAS concurrency, idempotency, evidence and lease recovery passed.');
const disk={state:null,version:0,objects:new Map()};
const stored=createQueue({
 async read(){return disk.state?{value:structuredClone(disk.state),etag:disk.version}:null;},
 async write(value,etag){assert.equal(etag,disk.state?disk.version:null);disk.state=structuredClone(value);disk.version++;},
 conflict:()=>false,
 async save(kind,key,value){const ref=kind+'/'+key;disk.objects.set(ref,structuredClone(value));return ref;},
 async load(ref){assert.ok(disk.objects.has(ref));return structuredClone(disk.objects.get(ref));},
});
for(let i=0;i<130;i++){
 const name='stored-'+i,task=await stored.enqueue('owner',{...input,conversation:{...input.conversation,conversation_id:name}});
 const claimed=(await stored.claim('persistent-worker')).job;assert.equal(claimed.id,task.id);
 assert.equal(claimed.input.conversation.transcript[1].text,'Здравствуйте! Я Анна. Откройте профиль.');
 await stored.finish('persistent-worker',claimed.id,claimed.lease,{...result,conversation_id:name});
 assert.equal((await stored.get('owner',task.id)).result.conversation_id,name);
}
assert.equal(disk.state.jobs.length,130);assert.ok(JSON.stringify(disk.state).length<150000);
assert.ok(!JSON.stringify(disk.state).includes('Здравствуйте'));
const storedAppeal=await stored.appeal('owner',disk.state.jobs[0].id,'01','Имя есть в b.',['b']);
const storedClaim=(await stored.claim('persistent-worker')).job;
assert.equal(storedClaim.id,storedAppeal.id);assert.equal(storedClaim.previous.conversation_id,'stored-0');
console.log('Private payload storage: 130 sequential assessments, bounded queue index, full result and appeal retrieval passed.');
