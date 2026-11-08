import {validRating,type Conversation,type Criterion,type Evaluation,type Turn} from './qa-model';
import {normalizeRecords} from './qa-files';
declare global {interface Window {FREEDOM_QA_CONFIG?:{analysisEndpoint?:string;transcriptionEndpoint?:string;transcriptionUpload?:'blob'|'direct'}}}
export const available=()=>({analysis:!!window.FREEDOM_QA_CONFIG?.analysisEndpoint,transcription:!!window.FREEDOM_QA_CONFIG?.transcriptionEndpoint});
function endpoint(value:string|undefined){if(!value)throw Error('Сервис пока не подключён. Можно выполнить ручную проверку.');const url=new URL(value,location.origin);if(url.origin!==location.origin)throw Error('Настройте серверный маршрут на домене сайта.');return url.href;}
export async function requestAnalysis(conversation:Conversation,checklist:Criterion[],signal:AbortSignal):Promise<Record<string,Evaluation>>{
 const response=await fetch(endpoint(window.FREEDOM_QA_CONFIG?.analysisEndpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation:{conversation_id:conversation.sourceId??conversation.id,language:conversation.language,channel:conversation.channel,transcript:conversation.transcript},checklist}),signal});
 if(!response.ok){let reason='';try{const body=await response.json();if(typeof body?.error==='string')reason=body.error.slice(0,300);}catch{/* ответ без JSON */}throw Error(reason?`Автооценка не выполнена: ${reason}`:`Сервис анализа недоступен (${response.status}). Попробуйте позже.`);}const data=await response.json();if(!data.evaluations||typeof data.evaluations!=='object')throw Error('Сервис вернул результат без оценок.');
 const clean:Record<string,Evaluation>={};const ids=new Set(conversation.transcript.map(t=>t.id));for(const c of checklist){const e=data.evaluations[c.id];if(!e||e.value===null||!validRating(c,e.value)||typeof e.reason!=='string'||!e.reason.trim()||!Array.isArray(e.evidence)||e.evidence.some((id:unknown)=>typeof id!=='string'||!ids.has(id)))throw Error('Сервис вернул неполную оценку или ссылку на несуществующую реплику.');clean[c.id]={value:e.value,reason:e.reason,evidence:e.evidence,appeals:[]};}return clean;
}
export type TranscriptionResult={transcript:Turn[];speakers:{id:string;role:string}[];confident:boolean;duration:number|null};
async function bearer():Promise<Record<string,string>>{try{const client=(window as any).FreedomAuth?.getClient?.();const token=client?(await client.auth.getSession())?.data?.session?.access_token:null;return token?{Authorization:'Bearer '+token}:{};}catch{return{};}}
async function failure(response:Response){let reason='';try{const body=await response.json();if(typeof body?.error==='string')reason=body.error.slice(0,300);}catch{/* ответ без JSON */}return Error(reason||`Не удалось расшифровать аудио (${response.status}).`);}
// На сайте файл сначала загружается в закрытое хранилище (у функций Vercel лимит 4,5 МБ на запрос),
// локально — отправляется напрямую.
export async function requestTranscription(file:File,signal:AbortSignal,onStage?:(stage:string)=>void):Promise<TranscriptionResult>{
 if(file.size>25*1024*1024)throw Error('Аудиофайл больше 25 МБ. Сожмите его в MP3 (моно, 32–64 кбит/с) или разделите на части.');
 const url=endpoint(window.FREEDOM_QA_CONFIG?.transcriptionEndpoint),auth=await bearer();let response:Response;
 if(window.FREEDOM_QA_CONFIG?.transcriptionUpload==='blob'){
  if(!auth.Authorization)throw Error('Войдите в аккаунт проверяющего, чтобы распознать аудио.');
  onStage?.('Загружаем запись в закрытое хранилище…');
  const {upload}=await import('@vercel/blob/client');
  const safe=file.name.replace(/[^\w.-]+/g,'_').slice(-80)||'call.mp3';
  const blob=await upload('cqa-audio/'+safe,file,{access:'private',handleUploadUrl:url+'?action=upload',headers:auth,abortSignal:signal,contentType:file.type||'application/octet-stream'});
  onStage?.('Распознаём речь и разделяем голоса… Обычно до минуты на 5 минут записи.');
  response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...auth},body:JSON.stringify({pathname:blob.pathname,filename:file.name}),signal});
 }else{
  onStage?.('Распознаём речь и разделяем голоса… Обычно до минуты на 5 минут записи.');
  const form=new FormData();form.set('audio',file);response=await fetch(url,{method:'POST',headers:auth,body:form,signal});
 }
 if(!response.ok)throw await failure(response);
 const data=await response.json();if(!Array.isArray(data.transcript)||!data.transcript.length)throw Error('В ответе отсутствует транскрипт.');
 return{transcript:normalizeRecords({transcript:data.transcript})[0].transcript,speakers:Array.isArray(data.speakers)?data.speakers:[],confident:!!data.confident,duration:typeof data.duration==='number'?data.duration:null};
}
