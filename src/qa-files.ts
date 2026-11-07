import {newConversation,uid,type Conversation,type Speaker,type Turn} from './qa-model';
export const ACCEPT='.json,.txt,.csv,.srt,.vtt,.pdf,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac';
export const MAX_BYTES=20*1024*1024;
export function isAudio(name:string){return /\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(name);}
export function role(value:unknown):Speaker{const s=String(value??'').trim().toLowerCase();if(/^(operator|agent|оператор|сотрудник|қызметкер|support)$/.test(s))return'operator';if(/^(client|customer|клиент|клиентка|user|пользователь)$/.test(s))return'client';if(/^(bot|бот|assistant)$/.test(s))return'bot';if(/^(system|система|системное сообщение)$/.test(s))return'system';return'unknown';}
function safeAudio(raw:unknown){if(typeof raw!=='string'||!raw.trim())return undefined;try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}
function turns(raw:unknown):Turn[]{if(!Array.isArray(raw))throw Error('Поле transcript должно быть массивом реплик.');if(raw.length>5000)throw Error('В одном диалоге поддерживается до 5000 реплик.');return raw.map((item:any)=>{const text=typeof item==='string'?item:item?.text??item?.content;if(typeof text!=='string')throw Error('У каждой реплики должно быть текстовое поле text.');return{id:uid(),timestamp:String(item?.timestamp??item?.time??item?.start??''),speaker:role(item?.speaker??item?.role),originalSpeaker:String(item?.speaker??item?.role??''),text};});}
export function normalizeRecords(raw:any,name='Загруженный диалог'):Conversation[]{
 if(raw?.isSuccess===false)throw Error(String(raw.error||'Набор данных содержит ошибку.'));
 const data=raw?.data?.records??raw?.records??raw?.conversation??raw;
 const list=Array.isArray(data)?(data.length&&((data[0]?.speaker!==undefined)||(data[0]?.role!==undefined)||typeof data[0]==='string')?[{transcript:data}]:data):[data];
 if(!list.length||list.length>1000)throw Error('В файле должно быть от 1 до 1000 диалогов.');
 const parsed=list.map((r:any,i:number)=>{if(!r||!Array.isArray(r.transcript??r.messages))throw Error('Не найден transcript. Загрузите запись или объект data.records в формате датасета.');const c=newConversation(String(r.name??r.conversation_id??`${name}${list.length>1?' · '+(i+1):''}`).slice(0,160),turns(r.transcript??r.messages),String(r.language??'Не указан'));c.sourceId=r.conversation_id?String(r.conversation_id).slice(0,160):undefined;c.channel=String(r.channel??'agent chat');c.audioUrl=safeAudio(r.audio_url);return c;});
 // Части одного чата (например, бот и оператор) с общим conversation_id собираются в один диалог.
 const groups=new Map<string,Conversation[]>(),out:Conversation[]=[];
 for(const c of parsed){if(!c.sourceId){out.push(c);continue;}const g=groups.get(c.sourceId);if(g)g.push(c);else{const fresh=[c];groups.set(c.sourceId,fresh);out.push(c);}}
 return out.map(c=>{const g=c.sourceId?groups.get(c.sourceId)!:[c];return g.length>1?mergeConversations(g):c;});
}
/** Склеивает несколько частей одного разговора в один диалог, сохраняя хронологию. */
export function mergeConversations(parts:Conversation[]):Conversation{
 if(parts.length===1)return parts[0];
 const all=parts.flatMap((p,part)=>p.transcript.map((t,i)=>({t,part,i,at:timestampSeconds(t.timestamp)})));
 const iso=all.map(x=>/^\d{4}-/.test(x.t.timestamp));
 const sortable=all.length>0&&all.every(x=>x.at!==null)&&(iso.every(Boolean)||!iso.some(Boolean));
 if(sortable)all.sort((a,b)=>a.at!-b.at!||a.part-b.part||a.i-b.i);
 const transcript=all.map(x=>x.t);
 const first=parts.find(p=>p.transcript.length)??parts[0];
 const audio=parts.find(p=>p.audioUrl);
 const c=newConversation(first.name,transcript,parts.find(p=>p.language&&p.language!=='Не указан')?.language??first.language);
 c.sourceId=parts.find(p=>p.sourceId)?.sourceId;
 c.channel=audio?.audioName?'voice call':first.channel;
 if(audio){c.audioUrl=audio.audioUrl;c.audioName=audio.audioName;}
 return c;
}
export function parseText(text:string):Turn[]{
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),out:Turn[]=[];
 for(let line of lines){line=line.trim();if(!line||line==='WEBVTT'||/^\d+$/.test(line))continue;
  const subtitle=line.match(/^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->/);if(subtitle){out.push({id:uid(),timestamp:subtitle[1].replace(',','.'),speaker:'unknown',text:''});continue;}
  const m=line.match(/^(?:\[?((?:\d{4}-\d{2}-\d{2}T\S+)|(?:\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?))\]?\s*[-–—|]?\s*)?(?:\[)?(оператор|сотрудник|клиент|client|customer|operator|agent|user|bot|бот|system|система|қызметкер)(?:\])?\s*[:：\-–—]\s*(.*)$/i);
  if(m){const pending=out[out.length-1];if(pending&&pending.text===''&&!m[1]){pending.speaker=role(m[2]);pending.originalSpeaker=m[2];pending.text=m[3];}else out.push({id:uid(),timestamp:m[1]??'',speaker:role(m[2]),originalSpeaker:m[2],text:m[3]});}
  else if(out.length)out[out.length-1].text+=(out[out.length-1].text?'\n':'')+line;
  else out.push({id:uid(),timestamp:'',speaker:'unknown',text:line});
 }
 return out.filter(t=>t.text.trim());
}
function csv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}if(quoted)throw Error('В CSV не закрыта кавычка.');row.push(cell);if(row.some(c=>c.trim()))rows.push(row);const headers=rows.shift()?.map(h=>h.trim().toLowerCase().replace(/^\uFEFF/,''))??[];if(!headers.includes('text')||!headers.includes('speaker'))throw Error('В CSV нужны колонки timestamp,speaker,text.');return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
export async function readConversationFile(file:File):Promise<Conversation[]>{
 if(file.size>MAX_BYTES)throw Error(`${file.name}: размер файла больше 20 МБ.`);
 if(isAudio(file.name)){const c=newConversation(file.name,[],'Не указан');c.channel='voice call';c.audioUrl=URL.createObjectURL(file);c.audioName=file.name;return[c];}
 const ext=file.name.split('.').pop()?.toLowerCase();if(!['txt','json','csv','srt','vtt','pdf'].includes(ext??''))throw Error(`${file.name}: этот формат не поддерживается.`);
 let text='';
 if(ext==='pdf'){
  const moduleURL=new URL('assets/pdf-reader.mjs',document.baseURI).href;
  const {readPdf}=await import(moduleURL);text=await readPdf(await file.arrayBuffer());
 }else text=await file.text();
 if(text.length>2_000_000)throw Error('В файле больше 2 миллионов символов. Разделите его на части.');
 if(ext==='json'){try{return normalizeRecords(JSON.parse(text.replace(/^\uFEFF/,'')),file.name);}catch(e){if(e instanceof SyntaxError)throw Error('Не удалось прочитать JSON. Проверьте структуру файла.');throw e;}}
 if(ext==='csv')return normalizeRecords({transcript:csv(text)},file.name);
 const transcript=parseText(text);if(!transcript.length)throw Error('В файле не найден текст диалога.');return[newConversation(file.name,transcript,'Не указан')];
}
export function timestampSeconds(value:string){if(/^\d{4}-/.test(value)){const ms=Date.parse(value);return Number.isFinite(ms)?ms/1000:null;}const p=value.replace(',','.').split(':').map(Number);if(p.length<2||p.length>3||p.some(n=>!Number.isFinite(n)||n<0))return null;return p.length===2?p[0]*60+p[1]:p[0]*3600+p[1]*60+p[2];}
export function audioTime(turn:Turn,list:Turn[]){const t=timestampSeconds(turn.timestamp);if(t===null)return null;if(/^\d{4}-/.test(turn.timestamp)){const first=list.map(t=>timestampSeconds(t.timestamp)).find(v=>v!==null);return first===undefined?null:Math.max(0,t-first!);}return t;}
