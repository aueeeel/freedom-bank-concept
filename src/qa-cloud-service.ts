import {validRating,type Conversation,type Criterion,type Evaluation,type Turn} from './qa-model';
import {normalizeRecords} from './qa-files';
import {requestAnalysis as requestLegacyAnalysis} from './qa-service';
declare global {interface Window {FREEDOM_QA_CONFIG?:{analysisEndpoint?:string;transcriptionEndpoint?:string;transcriptionUpload?:'blob'|'direct'}}}
const legacyMode=()=>!!window.FREEDOM_QA_CONFIG?.analysisEndpoint?.split('?')[0].endsWith('/api/cqa/analyze');
export const available=()=>({analysis:!!window.FREEDOM_QA_CONFIG?.analysisEndpoint,transcription:!!window.FREEDOM_QA_CONFIG?.transcriptionEndpoint,queuedAnalysis:!!window.FREEDOM_QA_CONFIG?.analysisEndpoint&&!legacyMode()});
function endpoint(value:string|undefined){if(!value)throw Error('Сервис пока не подключён. Можно выполнить ручную проверку.');const url=new URL(value,location.origin);if(url.origin!==location.origin)throw Error('Настройте серверный маршрут на домене сайта.');return url.href;}
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(new DOMException('Остановлено','AbortError'));return;}
 const stop=()=>{clearTimeout(timer);reject(new DOMException('Остановлено','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});
});
async function authHeaders(){const client=window.FreedomAuth?.getClient?.();const session=client?await client.auth.getSession():null;const token=session?.data.session?.access_token;if(!token)throw Error('Войдите в аккаунт менеджера для автоматической проверки.');return{'Content-Type':'application/json',Authorization:'Bearer '+token};}
export async function analysisId(c:Conversation){
 if(c.sourceId)return c.sourceId;
 const bytes=new TextEncoder().encode(JSON.stringify([c.language,c.channel,c.transcript.map(t=>[t.timestamp,t.speaker,t.text])]));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return 'upload-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
}
export async function requestAnalysis(conversation:Conversation,checklist:Criterion[],signal:AbortSignal):Promise<Record<string,Evaluation>>{
 const role=conversation.targetRole??(conversation.transcript.some(t=>t.speaker==='operator')?'operator':'bot');
 if(legacyMode()){
  if(role!=='operator')throw Error('Этот локальный адаптер обучен оценке оператора. Отдельная оценка бота доступна через основной проверяющий.');
  return requestLegacyAnalysis(conversation,checklist,signal);
 }
 const headers=await authHeaders(),url=endpoint(window.FREEDOM_QA_CONFIG?.analysisEndpoint);
 const response=await fetch(url+'?action=enqueue',{method:'POST',headers,body:JSON.stringify({conversation:{conversation_id:await analysisId(conversation),language:conversation.language,channel:conversation.channel,transcript:conversation.transcript},target_role:role,checklist}),signal});
 let job=await response.json();if(!response.ok)throw Error(job.error??`Ошибка очереди (${response.status}).`);
 const started=Date.now();
 while(!['completed','failed'].includes(job.status)){
  if(Date.now()-started>4*3600000)throw Error('Задача сохранена в очереди. Повторный запуск для этого диалога получит сохранённый результат.');
  await pause(60000,signal);
  const status=await fetch(url+'?action=job&id='+encodeURIComponent(job.id),{headers:await authHeaders(),signal,cache:'no-store'});
  const data=await status.json();if(!status.ok)throw Error(data.error??'Не удалось получить состояние очереди.');job=data;
 }
 if(job.status==='failed')throw Error(job.error??'Проверка не завершилась.');
 const rows=job.result?.final_assessment?.criteria;if(!Array.isArray(rows)||rows.length!==8)throw Error('Проверяющий вернул неполный результат.');
 const clean:Record<string,Evaluation>={},ids=new Set(conversation.transcript.map(t=>t.id));
 for(let i=0;i<checklist.length;i++){
  const c=checklist[i],e=rows.find((r:any)=>r.criterion_id===String(i+1).padStart(2,'0'));
  const value=e?.answer==='score'?e.value:e?.answer;
  const evidence=e?.evidence?.map((r:any)=>r.message_id);
  if(!e||!validRating(c,value)||typeof e.explanation!=='string'||!e.explanation.trim()||!Array.isArray(evidence)||evidence.some((id:unknown)=>typeof id!=='string'||!ids.has(id)))throw Error('Сервис вернул некорректную оценку или ссылку на отсутствующую реплику.');
  clean[c.id]={value,reason:e.explanation+(e.uncertainties?.length?'\nТребует проверки: '+e.uncertainties.join(' '):''),evidence,appeals:[],sourceJobId:job.id};
 }
 return clean;
}
export async function requestAppeal(conversation:Conversation,criterion:Criterion,index:number,argument:string,signal:AbortSignal){
 const original=conversation.evaluations[criterion.id];if(!original?.sourceJobId)throw Error('Для автоматической апелляции сначала выполните оценку ИИ. Ручную оценку пересматривает проверяющий.');
 const url=endpoint(window.FREEDOM_QA_CONFIG?.analysisEndpoint),headers=await authHeaders();
 const response=await fetch(url+'?action=appeal',{method:'POST',headers,body:JSON.stringify({parent_id:original.sourceJobId,criterion_id:String(index+1).padStart(2,'0'),argument,selected_ids:original.evidence}),signal});
 let job=await response.json();if(!response.ok)throw Error(job.error??'Не удалось подать апелляцию.');
 const started=Date.now();
 while(!['completed','failed'].includes(job.status)){
  if(Date.now()-started>4*3600000)throw Error('Апелляция сохранена в очереди. Повторная отправка того же аргумента получит её результат.');
  await pause(60000,signal);const r=await fetch(url+'?action=job&id='+encodeURIComponent(job.id),{headers:await authHeaders(),signal,cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error??'Не удалось получить решение.');job=data;
 }
 if(job.status==='failed')throw Error(job.error??'Пересмотр не завершился.');
 const row=job.result?.final_assessment?.criteria?.find((r:any)=>r.criterion_id===String(index+1).padStart(2,'0'));
 const value=row?.answer==='score'?row.value:row?.answer,ids=new Set(conversation.transcript.map(m=>m.id));
 if(!row||!validRating(criterion,value)||typeof row.explanation!=='string'||!Array.isArray(row.evidence)||row.evidence.some((e:any)=>!ids.has(e.message_id)))throw Error('Пересмотр вернул некорректное решение.');
 return{value,reason:row.explanation+'\nРешение ИИ предварительное; аргумент апелляции не становится обучающим эталоном автоматически.',evidence:row.evidence.map((e:any)=>e.message_id) as string[],sourceJobId:job.id,requiresReview:true};
}
// Распознавание аудио с разделением на оператора и клиента — см. qa-service.ts.
export {requestTranscription,type TranscriptionResult} from './qa-service';
