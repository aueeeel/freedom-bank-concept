import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {checklist as canonicalChecklist} from './cqa-checklist.mjs';

export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(code,text)=>{throw new HttpError(code,text);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const criterionIds=['contact','needs','identity','consultation','empathy','management','closing','gross'];
export function workerAuthorized(header,key){
 if(!key||typeof header!=='string')return false;
 return timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+key).digest());
}
export function validateInput(body){
 const c=body.conversation,role=body.target_role;
 if(!c||typeof c.conversation_id!=='string'||c.conversation_id.length>200)fail(400,'Нужен conversation_id.');
 if(!['bot','operator'].includes(role))fail(400,'Выберите отдельно бота или оператора.');
 if(!Array.isArray(c.transcript)||!c.transcript.length||c.transcript.length>1000)fail(400,'Допустимо от 1 до 1000 реплик на одну проверку.');
 const seen=new Set();let size=0;
 const transcript=c.transcript.map((m,i)=>{
  const id=m.message_id??m.id??'m'+i;
  if(typeof id!=='string'||!id||id.length>160||seen.has(id)||!['client','bot','operator','system'].includes(m.speaker)||typeof m.text!=='string'||typeof m.timestamp!=='string')fail(400,'Проверьте уникальные ID, роли и текст реплик.');
  seen.add(id);size+=m.text.length;
  return{message_id:id,index:i,timestamp:m.timestamp,speaker:m.speaker,text:m.text};
 });
 if(size>60000)fail(413,'Онлайн-проверка принимает до 60000 символов в одном диалоге.');
 if(!transcript.some(m=>m.speaker===role))fail(400,'В диалоге нет реплик выбранного участника.');
 const expectedWeights=[10,15,20,20,15,15,5,0],list=body.checklist;
 if(!Array.isArray(list)||list.length!==8||list.some((c,i)=>c.id!==criterionIds[i]||c.weight!==expectedWeights[i]||c.type!==(['consultation','management'].includes(c.id)?'scale':c.id==='gross'?'flag':'binary')||JSON.stringify(c.scale)!==JSON.stringify(c.id==='consultation'?[0,5,10,15,20]:c.id==='management'?[0,4,7,10]:[])))fail(400,'Автооценка использует исходные восемь критериев Freedom Broker и их веса. Для изменённого чек-листа доступна ручная проверка.');
 if(list.some((c,i)=>c.definition!==canonicalChecklist[i].definition||c.allowNA!==canonicalChecklist[i].allowNA))fail(400,'Изменённые определения критериев требуют отдельной настройки модели. Для этого чек-листа доступна ручная проверка.');
 return{conversation:{conversation_id:c.conversation_id,language:String(c.language??'unknown').slice(0,10),channel:String(c.channel??'agent chat').slice(0,60),transcript},target_role:role};
}
export function validateResult(result,input){
 const rows=result?.final_assessment?.criteria,ids=new Map(input.conversation.transcript.map(m=>[m.message_id,m]));
 if(result?.target_role!==input.target_role||result?.conversation_id!==input.conversation.conversation_id||!Array.isArray(rows)||rows.length!==8)fail(400,'Результат не соответствует задаче.');
 const seen=new Set();
 rows.forEach(r=>{
  if(!/^0[1-8]$/.test(r.criterion_id)||seen.has(r.criterion_id)||typeof r.explanation!=='string'||!r.explanation.trim()||!Array.isArray(r.evidence))fail(400,'Некорректный критерий результата.');
  seen.add(r.criterion_id);
  const scale=r.criterion_id==='04'?[0,5,10,15,20]:[0,4,7,10];
  if(['04','06'].includes(r.criterion_id)?!(r.answer==='score'&&scale.includes(r.value)||r.criterion_id==='04'&&r.answer==='na'):!['yes','no','na'].includes(r.answer))fail(400,'Недопустимая оценка.');
  if(r.answer==='na'&&!['02','03','04','07'].includes(r.criterion_id))fail(400,'Недопустимый N/A.');
  for(const e of r.evidence)if(!ids.has(e.message_id)||typeof e.quote!=='string'||!e.quote||!ids.get(e.message_id).text.includes(e.quote))fail(400,'Доказательство отсутствует в диалоге.');
 });
 return result;
}
export function createQueue(adapter,{now=()=>Date.now()}={}){
 const fresh=()=>({version:1,jobs:[],worker:null,budget:{month:new Date(now()).toISOString().slice(0,7),writes:0}});
 async function read(mode='query'){return await adapter.read(mode)??{value:fresh(),etag:null};}
 async function mutate(fn){
  for(let attempt=0;attempt<4;attempt++){
   const {value:state,etag}=await read('write');
   const month=new Date(now()).toISOString().slice(0,7);
   if(state.budget.month!==month)state.budget={month,writes:0};
   const retained=state.jobs.filter(j=>now()-j.created_at<7*86400000||['queued','running'].includes(j.status));
   const parents=new Set(retained.map(j=>j.appeal?.parent_id).filter(Boolean));
   state.jobs=state.jobs.filter(j=>retained.includes(j)||parents.has(j.id));
   if(state.budget.writes>=1600)fail(429,'Месячный лимит записи очереди исчерпан. Новые платные ресурсы автоматически не подключаются.');
   const result=await fn(state);
   if(result?.noWrite)return result.value;
   state.budget.writes++;
   if(state.budget.writes>1600)fail(429,'Месячный лимит операций очереди исчерпан.');
   if(Buffer.byteLength(JSON.stringify(state))>3500000)fail(503,'Очередь заполнена. Дождитесь завершения текущих проверок.');
   try{await adapter.write(state,etag);return result;}catch(e){if(!adapter.conflict(e)||attempt===3)throw e;}
  }
 }
 const inputOf=async j=>j.input_ref?await adapter.load(j.input_ref):j.input;
 const resultOf=async j=>j.result_ref?await adapter.load(j.result_ref):j.result;
 const publicJob=async j=>({id:j.id,status:j.status,created_at:j.created_at,updated_at:j.updated_at,
  target_role:j.input.target_role,conversation_id:j.input.conversation.conversation_id,
  ...(j.status==='completed'?{result:await resultOf(j)}:{}),...(j.status==='failed'?{error:j.error}:{})});
 return{
  async status(){const {value:s}=await read();return{worker_last_seen:s.worker?.at??null,worker_busy:!!s.worker?.busy,model:s.worker?.model??null};},
  async enqueue(owner,input,appeal=null){return mutate(async s=>{
   const key=hash({owner,input,appeal});
   const prior=s.jobs.find(j=>j.key===key&&j.status!=='failed');
   if(prior)return{noWrite:true,value:await publicJob(prior)};
   if(s.jobs.filter(j=>['queued','running'].includes(j.status)).length>=50)fail(429,'В очереди уже 50 задач. Попробуйте позже.');
   if(s.jobs.filter(j=>j.owner===owner&&now()-j.created_at<86400000).length>=200)fail(429,'Достигнут суточный лимит: 200 проверок участников на пользователя.');
   const job={id:randomUUID(),key,owner,input,appeal,status:'queued',created_at:now(),updated_at:now(),attempts:0};
   if(adapter.save){
    job.input_ref=await adapter.save('inputs',hash({owner,input}),input);s.budget.writes++;
    job.input={target_role:input.target_role,conversation:{conversation_id:input.conversation.conversation_id}};
   }
   s.jobs.push(job);return publicJob(job);
  });},
  async get(owner,id){const {value:s}=await read();const j=s.jobs.find(j=>j.id===id&&j.owner===owner);if(!j)fail(404,'Задача не найдена.');return publicJob(j);},
  async appeal(owner,parentId,criterionId,argument,selectedIds){
   const {value:s}=await read();const parent=s.jobs.find(j=>j.id===parentId&&j.owner===owner&&j.status==='completed');
   if(!parent)fail(404,'Исходная оценка не найдена. Повторите проверку диалога.');
   if(!/^0[1-8]$/.test(criterionId)||typeof argument!=='string'||!argument.trim()||argument.length>3000)fail(400,'Укажите критерий и аргумент апелляции до 3000 символов.');
   const fullInput=await inputOf(parent),ids=new Set(fullInput.conversation.transcript.map(m=>m.message_id));
   if(!Array.isArray(selectedIds)||selectedIds.length>20||selectedIds.some(id=>!ids.has(id)))fail(400,'Апелляция ссылается на отсутствующую реплику.');
   return this.enqueue(owner,fullInput,{parent_id:parent.id,criterion_id:criterionId,argument:argument.trim(),selected_ids:selectedIds});
  },
  async claim(worker){
   const {value:peek}=await read();
   const available=peek.jobs.some(j=>j.status==='queued'||j.status==='running'&&(j.worker===worker||j.lease_until<now()));
   if(!available&&peek.worker&&now()-peek.worker.at<3600000)return{job:null};
   return mutate(async s=>{
   const pack=async j=>({id:j.id,input:await inputOf(j),appeal:j.appeal,lease:j.lease,
     ...(j.appeal?{previous:await resultOf(s.jobs.find(p=>p.id===j.appeal.parent_id))}:{})});
   // A successful claim response may be lost after its write commits. Resume the
   // same lease before claiming anything else, including after a worker restart.
   const resume=s.jobs.find(j=>j.status==='running'&&j.worker===worker&&j.lease_until>=now());
   if(resume)return{noWrite:true,value:{job:await pack(resume)}};
   const job=s.jobs.find(j=>j.status==='queued'||j.status==='running'&&j.lease_until<now());
   // Idle polling is read-only after the initial heartbeat, conserving free Blob operations.
   if(!job&&s.worker&&now()-s.worker.at<3600000)return{noWrite:true,value:{job:null}};
   s.worker={id:worker,at:now(),busy:!!job,model:'qwen3.5:4b'};
   if(!job)return{job:null};
   if(job.attempts>=3){job.status='failed';job.error='Обработчик трижды потерял соединение. Повторите проверку.';return{job:null};}
   job.status='running';job.attempts++;job.worker=worker;job.lease=randomUUID();job.lease_until=now()+3600000;job.updated_at=now();
   return{job:await pack(job)};
  });},
  async heartbeat(worker,id,lease){return mutate(s=>{const j=s.jobs.find(j=>j.id===id&&j.status==='running'&&j.worker===worker&&j.lease===lease);if(!j)fail(409,'Аренда задачи истекла.');j.lease_until=now()+3600000;s.worker={...s.worker,at:now(),busy:true};return{ok:true};});},
  async finish(worker,id,lease,result,error=null){return mutate(async s=>{
   const j=s.jobs.find(j=>j.id===id&&j.worker===worker&&j.lease===lease);
   if(!j)fail(409,'Задача принадлежит другому обработчику.');
   if(['completed','failed'].includes(j.status))return{noWrite:true,value:{ok:true}};
   if(j.lease_until<now())fail(409,'Аренда задачи истекла.');
   if(error){j.status='failed';j.error=String(error).slice(0,500);}else{
    validateResult(result,await inputOf(j));j.status='completed';
    if(adapter.save){j.result_ref=await adapter.save('results',hash({id:j.id,result}),result);s.budget.writes++;}else j.result=result;
   }
   j.updated_at=now();s.worker={...s.worker,at:now(),busy:false};return{ok:true};
  });},
 };
}
