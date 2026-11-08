import assert from 'node:assert/strict';
import {actorCases} from '../src/qa-roles';
import {newConversation,initialChecklist} from '../src/qa-model';
import {analyseFile,fileRows} from '../src/qa-file-batch';
import {requestAnalysis,requestAppeal} from '../src/qa-cloud-service';
const turns=[{id:'client-1',timestamp:'00:00',speaker:'client' as const,text:'Нужен оператор.'},
 {id:'bot-1',timestamp:'00:01',speaker:'bot' as const,text:'Подключаю оператора.'},
 {id:'operator-1',timestamp:'00:02',speaker:'operator' as const,text:'Здравствуйте! Я Анна.'}];
const cards=Array.from({length:10},(_,i)=>({...newConversation('Диалог '+i,turns),sourceId:'file-'+i})).flatMap(actorCases);
assert.equal(cards.length,20);assert.equal(new Set(cards.map(c=>c.id)).size,20);
assert.equal(cards.filter(c=>c.targetRole==='bot').length,10);assert.equal(cards.filter(c=>c.targetRole==='operator').length,10);
assert.ok(fileRows(cards,initialChecklist).every(r=>/Бот|Оператор/.test(r.name)));
let requests:any[]=[];
(globalThis as any).location={origin:'https://example.test'};
(globalThis as any).window={FREEDOM_QA_CONFIG:{analysisEndpoint:'/api/cqa'},FreedomAuth:{getClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic-test-token'}}})}})}};
(globalThis as any).fetch=async(url:string,options:any)=>{
 const body=JSON.parse(options.body);requests.push({url,body});
 const rows=initialChecklist.map((c,i)=>({criterion_id:String(i+1).padStart(2,'0'),answer:c.type==='scale'?'score':'yes',value:c.type==='scale'?Math.max(...c.scale):null,explanation:'Действие подтверждено.',evidence:[{message_id:'operator-1',quote:'Я Анна.'}],uncertainties:[]}));
 return Response.json({id:'cloud-job-'+requests.length,status:'completed',result:{final_assessment:{criteria:rows}}});
};
const completed:any[]=[];const controller=new AbortController();
const batch=await analyseFile(cards,controller.signal,c=>requestAnalysis(c,initialChecklist,controller.signal),(c,e)=>completed.push({...c,evaluations:e}),()=>{});
assert.equal(batch.completed,20);assert.equal(batch.errors.length,0);
assert.equal(requests.filter(r=>r.body.target_role==='bot').length,10);
assert.equal(requests.filter(r=>r.body.target_role==='operator').length,10);
assert.ok(completed.every(c=>Object.values(c.evaluations).length===8));
assert.equal(completed[0].evaluations.contact.sourceJobId,'cloud-job-1');
const decision=await requestAppeal(completed[0],initialChecklist[0],0,'Имя есть в первой реплике.',controller.signal);
assert.equal(requests.at(-1).body.parent_id,'cloud-job-1');assert.equal(requests.at(-1).body.criterion_id,'01');assert.equal(decision.requiresReview,true);
console.log('Cloud client: 10 dialogues -> 20 actor assessments, independent results, proof IDs, appeal provenance passed.');
