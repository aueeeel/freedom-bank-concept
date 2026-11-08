import {serverChecklistFrom,compatibleStandard} from './cqa-checklist-sync';
import type {Conversation,Criterion,Evaluation,Rating,Turn,Appeal} from './qa-model';

export const criterionCodes:Record<string,string>={contact:'01',needs:'02',identity:'03',consultation:'04',empathy:'05',management:'06',closing:'07',gross:'08'};
const slugs=Object.fromEntries(Object.entries(criterionCodes).map(([k,v])=>[v,k]));
export type Actor='bot'|'operator';
export type BackendResult={evaluations:Record<string,Evaluation>;backendKey:string;backendVersion:number;backendOrigin:string;backendScore:number|null;targetRole:Actor};
export async function api(path:string,body?:unknown,signal?:AbortSignal):Promise<any>{
 const response=await fetch('/api/cqa'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CQA-Client':'web'},body:body===undefined?undefined:JSON.stringify(body),signal});
 let data:any;try{data=await response.json();}catch{throw Error('Сервер CQA не отвечает. Запустите локальный проект и повторите.');}
 if(!response.ok)throw Error(data.error??`Ошибка CQA (${response.status})`);return data;
}
function pause(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('Обработка остановлена','AbortError'));return;}
  const cancel=()=>{clearTimeout(timer);reject(new DOMException('Обработка остановлена','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});
}
const rating=(row:any):Rating=>!row?null:row.answer==='score'?row.value:row.answer;
export function mapEvaluations(result:any,appeals:any[]=[],role:Actor):Record<string,Evaluation>{
 if(!result)return{};
 const rows=result.final_assessment.criteria;
 return Object.fromEntries(rows.map((row:any)=>{
  const code=row.criterion_id,id=slugs[code]??code;
  const history:Appeal[]=appeals.filter(a=>a.role===role&&a.criterion_id===code).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(a=>({
   id:a.id,comment:a.argument,createdAt:a.created_at,status:a.status,outcome:a.outcome,
   feedbackApproved:!!a.feedback_approved,beforeValue:rating(a.before),
   decision:a.status==='completed'&&['changed','upheld'].includes(a.outcome)?{value:rating(a.decision),reason:a.decision.explanation,at:a.completed_at}:undefined,
   reviewNote:a.outcome==='needs_review'?a.message:a.error,
  }));
  return[id,{value:rating(row),reason:row.explanation,evidence:row.evidence.map((e:any)=>e.message_id),appeals:history,serverAuthoritative:true,checkedRange:row.checked_range?[row.checked_range.start_message_id,row.checked_range.end_message_id]:undefined,reviewNotes:[...(row.uncertainties??[]),...(row.factual_support==='unverified'?['Фактическая правильность совета не подтверждена базой знаний.']:[]),...(result.disagreements?.some((x:any)=>x.criterion_id===code)?['Два прохода дали разные оценки: нужна проверка.']:[])]}];
 }));
}
export function fromDetail(detail:any):Conversation[]{
 const source=detail.conversation;
 const turns:Turn[]=source.transcript.map((m:any)=>({id:m.message_id,timestamp:m.timestamp,speaker:m.speaker,text:m.text}));
 const roles:Actor[]=['bot','operator'].filter(role=>turns.some(t=>t.speaker===role)) as Actor[];
 return roles.filter(role=>source.channel==='agent chat'||role!=='bot').map(role=>{
  const result=detail.results[role];
  return{id:detail.key+'__'+role,sourceId:source.conversation_id,datasetSource:detail.source,name:source.conversation_id+' · '+(role==='bot'?'Бот':'Оператор'),
   language:source.language,channel:source.channel,transcript:turns,conversationUrl:/^https?:\/\//i.test(source.conversation_url??'')?source.conversation_url:undefined,audioUrl:source.audio_url??undefined,
   evaluations:mapEvaluations(result,detail.appeals,role),events:[],backendKey:detail.key,targetRole:role,
   backendVersion:result?.version??0,backendOrigin:result?.origin??'not_evaluated',backendScore:result?.score?.total??null,
  };
 });
}
export async function readWorkspace():Promise<{cases:Conversation[];stats:any;health:any;checklist:Criterion[]}>{
 const [data,health]=await Promise.all([api('/workspace'),api('/health')]);
 return{cases:data.items.flatMap(fromDetail),stats:data.state.stats,health,
  checklist:serverChecklistFrom(data.state.rubric)};
}
export async function refreshCase(c:Conversation,signal?:AbortSignal):Promise<Conversation>{
 if(!c.backendKey)return c;
 const detail=await api('/conversations/'+c.backendKey,undefined,signal);
 const next=fromDetail(detail).find(x=>x.targetRole===c.targetRole);
 if(!next)throw Error('Участник не найден в диалоге');
 return{...next,events:c.events,audioUrl:c.audioUrl?.startsWith('blob:')?c.audioUrl:next.audioUrl,audioName:c.audioName};
}
export async function syncImports(records:Conversation[],signal?:AbortSignal):Promise<Conversation[]>{
 const synced:Conversation[]=[];
 for(const c of records){
  if(!c.transcript.length||c.transcript.some(t=>t.speaker==='unknown')){synced.push(c);continue;}
  const payload={conversation_id:c.sourceId??c.id,language:c.language,channel:c.channel,audio_url:c.audioUrl?.startsWith('blob:')?null:c.audioUrl??null,conversation_url:c.conversationUrl??null,
   transcript:c.transcript.map(t=>({timestamp:t.timestamp,speaker:t.speaker,text:t.text}))};
  const upload=await api('/uploads',{name:c.name,payload},signal);
  const detail=await api('/conversations/'+upload.keys[0],undefined,signal);
  synced.push(...fromDetail(detail).map(x=>({...x,events:c.events,audioUrl:c.audioUrl??x.audioUrl,audioName:c.audioName})));
 }
 return synced;
}
export async function analyse(c:Conversation,checklist:Criterion[],signal:AbortSignal,onProgress?:(text:string)=>void):Promise<BackendResult>{
 if(checklist.length!==8||checklist.some(x=>!criterionCodes[x.id]))throw Error('Автооценка подключена к восьми серверным критериям. Дополнительные критерии можно оценить вручную.');
 const state=await api('/state',undefined,signal);
 if(!compatibleStandard(checklist,serverChecklistFrom(state.rubric)))throw Error('Чек-лист изменён вручную. Откройте «Чек-лист» → «Вернуть серверные 8» → «Сохранить чек-лист». Диалоги сохранятся.');
 let current=c;
 if(!c.backendKey){const imported=await syncImports([c],signal);current=imported.find(x=>x.targetRole===(c.targetRole??'operator'))??imported[0];}
 if(!current.backendKey)throw Error('Сначала уточните роли реплик и прикрепите транскрипт.');
 const role=current.targetRole??'operator';
 const job=await api('/evaluate',{keys:[current.backendKey],roles:[role]},signal);
 const cancel=()=>{api('/jobs/'+job.id+'/cancel',{}).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   await pause(1800,signal);
   const state=await api('/state',undefined,signal),running=state.jobs.find((x:any)=>x.id===job.id);
   if(!running)throw Error('Очередь проверки не найдена');
   onProgress?.(running.message+(running.criterion_steps_done!=null?` · ${running.criterion_steps_done}/${running.criterion_steps_total}`:''));
   if(['queued','running'].includes(running.status))continue;
   if(running.failed||running.status!=='completed')throw Error(running.errors?.[0]?.error??running.message);
   const detail=await api('/conversations/'+current.backendKey,undefined,signal),result=detail.results[role];
   if(!result)throw Error('Модель не вернула оценку выбранного участника');
   return{evaluations:mapEvaluations(result,detail.appeals,role),backendKey:current.backendKey,backendVersion:result.version,backendOrigin:result.origin,backendScore:result.score.total,targetRole:role};
  }
 }finally{signal.removeEventListener('abort',cancel);}
}
export async function appealCriterion(c:Conversation,criterion:Criterion,argument:string,onProgress?:(message:string)=>void):Promise<Conversation>{
 if(!c.backendKey||!c.backendVersion)throw Error('Сначала выполните автооценку выбранного участника.');
 const code=criterionCodes[criterion.id];if(!code)throw Error('Для этого ручного критерия серверная апелляция не подключена.');
 const item=await api('/appeals',{key:c.backendKey,role:c.targetRole??'operator',criterion_id:code,argument,
  selected_message_ids:c.evaluations[criterion.id]?.evidence??[],expected_version:c.backendVersion});
 while(true){
  await new Promise(resolve=>setTimeout(resolve,1600));
  const list=await api('/appeals'),status=list.find((x:any)=>x.id===item.id);if(!status)throw Error('Апелляция не найдена');
  onProgress?.(status.message);
  if(['queued','running'].includes(status.status))continue;
  if(status.status==='failed')throw Error(status.error??status.message);
  return refreshCase(c);
 }
}
export async function approveExample(id:string){return api('/appeals/'+id+'/approve',{});}
