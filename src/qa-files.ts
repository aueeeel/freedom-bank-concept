import {newConversation,uid,type Conversation,type Speaker,type Turn} from './qa-model';
export const ACCEPT='.json,.txt,.csv,.srt,.vtt,.pdf,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac';
export const MAX_BYTES=20*1024*1024;
export type ImportMode='auto'|'single'|'batch';
export function isAudio(name:string){return /\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(name);}
export function role(value:unknown):Speaker{const s=String(value??'').trim().toLowerCase();if(/^(operator|agent|оператор|сотрудник|қызметкер|support)$/.test(s))return'operator';if(/^(client|customer|клиент|клиентка|user|пользователь)$/.test(s))return'client';if(/^(bot|бот|assistant)$/.test(s))return'bot';if(/^(system|система|системное сообщение)$/.test(s))return'system';return'unknown';}
function safeAudio(raw:unknown){if(typeof raw!=='string'||!raw.trim())return undefined;try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}
function turns(raw:unknown):Turn[]{
 if(!Array.isArray(raw))throw Error('Поле transcript должно быть массивом реплик.');
 if(raw.length>5000)throw Error('В одном диалоге поддерживается до 5000 реплик.');
 const seen=new Set<string>();
 return raw.map((item:any,index)=>{
  const text=typeof item==='string'?item:item?.text??item?.content;
  if(typeof text!=='string')throw Error('У каждой реплики должно быть текстовое поле text.');
  const original=item?.message_id??item?.id;
  const id=typeof original==='string'&&original.trim()&&original.length<=160?original:'m'+String(index).padStart(5,'0');
  if(seen.has(id))throw Error('В диалоге повторяется ID реплики: '+id);seen.add(id);
  return{id,timestamp:String(item?.timestamp??item?.time??item?.start??''),speaker:role(item?.speaker??item?.role),originalSpeaker:String(item?.speaker??item?.role??''),text};
 });
}
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
export function importedConversations(parts:Conversation[],name:string,mode:ImportMode='single'):Conversation[]{
 if(parts.some(part=>part.transcript.length>5000)||mode==='single'&&parts.reduce((n,part)=>n+part.transcript.length,0)>5000)throw Error('В одном диалоге поддерживается до 5000 реплик. Для независимых чатов выберите «Набор диалогов».');
 if(mode==='batch'||mode==='auto'||parts.length<=1)return parts;
 const audioURLs=[...new Set(parts.map(part=>part.audioUrl).filter(Boolean))];if(audioURLs.length>1)throw Error('В файле несколько аудиозаписей. Выберите «Набор диалогов».');
 const combined=mergeConversations(parts);combined.name=name.slice(0,160);
 const ids=[...new Set(parts.map(part=>part.sourceId).filter(Boolean))];combined.sourceId=ids.length===1?ids[0]:undefined;
 return[combined];
}
/** Склеивает несколько частей одного разговора в один диалог, сохраняя хронологию. */
export function mergeConversations(parts:Conversation[]):Conversation{
 if(parts.length===1)return parts[0];
 const all=parts.flatMap((p,part)=>p.transcript.map((t,i)=>({t,part,i,at:timestampSeconds(t.timestamp)})));
 const iso=all.map(x=>/^\d{4}-/.test(x.t.timestamp));
 const sortable=all.length>0&&all.every(x=>x.at!==null)&&(iso.every(Boolean)||!iso.some(Boolean));
 if(sortable)all.sort((a,b)=>a.at!-b.at!||a.part-b.part||a.i-b.i);
 const duplicateIds=new Set(all.map(x=>x.t.id)).size!==all.length;
 const transcript=all.map((x,i)=>duplicateIds?{...x.t,id:'m'+String(i).padStart(5,'0')}:x.t);
 const first=parts.find(p=>p.transcript.length)??parts[0];
 const audio=parts.find(p=>p.audioUrl);
 const c=newConversation(first.name,transcript,parts.find(p=>p.language&&p.language!=='Не указан')?.language??first.language);
 c.sourceId=parts.find(p=>p.sourceId)?.sourceId;
 c.channel=audio?.audioName||parts.some(p=>p.channel==='voice call')?'voice call':parts.some(p=>p.channel==='agent chat')?'agent chat':first.channel;
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
 return out.filter(t=>t.text.trim()).map((t,i)=>({...t,id:'m'+String(i).padStart(5,'0')}));
}
function csv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}if(quoted)throw Error('В CSV не закрыта кавычка.');row.push(cell);if(row.some(c=>c.trim()))rows.push(row);const headers=rows.shift()?.map(h=>h.trim().toLowerCase().replace(/^\uFEFF/,''))??[];if(!headers.includes('text')||!headers.includes('speaker'))throw Error('В CSV нужны колонки timestamp,speaker,text.');return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
export async function readConversationFile(file:File,mode:ImportMode='single'):Promise<Conversation[]>{
 if(file.size>MAX_BYTES)throw Error(`${file.name}: размер файла больше 20 МБ.`);
 if(isAudio(file.name)){const c=newConversation(file.name,[],'Не указан');c.channel='voice call';c.audioUrl=URL.createObjectURL(file);c.audioName=file.name;return[c];}
 const ext=file.name.split('.').pop()?.toLowerCase();if(!['txt','json','csv','srt','vtt','pdf'].includes(ext??''))throw Error(`${file.name}: этот формат не поддерживается.`);
 let text='';
 if(ext==='pdf'){
  const moduleURL=new URL('assets/pdf-reader.mjs',document.baseURI).href;
  const {readPdf}=await import(moduleURL);text=await readPdf(await file.arrayBuffer());
 }else text=await file.text();
 if(text.length>2_000_000)throw Error('В файле больше 2 миллионов символов. Разделите его на части.');
 if(ext==='json'){try{return importedConversations(normalizeRecords(JSON.parse(text.replace(/^\uFEFF/,'')),file.name),file.name,mode);}catch(e){if(e instanceof SyntaxError)throw Error('Не удалось прочитать JSON. Проверьте структуру файла.');throw e;}}
 if(ext==='txt'&&/^[\[{]/.test(text.trim())){let structured:unknown;try{structured=JSON.parse(text.replace(/^\uFEFF/,''));}catch{/* Plain timestamped text can also begin with a bracket. */}if(structured!==undefined)return importedConversations(normalizeRecords(structured,file.name),file.name,mode);}
 if(ext==='csv')return normalizeRecords({transcript:csv(text)},file.name);
 const sections=splitSections(text);
 // Файл с заголовками «=== id | канал | язык ===» содержит отдельные чаты: каждый заголовок — свой диалог.
 if(sections.length>1)return importedConversations(sections,file.name,'batch');
 if(sections.length===1)return sections;
 const transcript=parseText(text);if(!transcript.length)throw Error('В файле не найден текст диалога.');return[newConversation(file.name,transcript,'Не указан')];
}
/** Разбирает текст вида «=== syn-ru-151 | agent chat | RU [| audio_url] ===» + реплики на отдельные диалоги. */
export function splitSections(text:string):Conversation[]{
 const header=/^\s*===\s*(.+?)\s*===\s*$/;
 const lines=text.replace(/^﻿/,'').split(/\r?\n/);
 if(!lines.some(l=>header.test(l)))return[];
 const out:Conversation[]=[];let current:{fields:string[];body:string[]}|null=null;
 const flush=()=>{if(!current)return;const transcript=parseText(current.body.join('\n'));if(!transcript.length)return;const [id='',channel='',language='',audio='']=current.fields;
  const c=newConversation((id||`Диалог ${out.length+1}`).slice(0,160),transcript,language||'Не указан');c.sourceId=id?id.slice(0,160):undefined;c.channel=channel||'agent chat';
  if(/^https?:\/\//i.test(audio)){try{c.audioUrl=new URL(audio).href;}catch{/* неверная ссылка на аудио не мешает импорту */}}out.push(c);};
 for(const line of lines){const m=line.match(header);if(m){flush();current={fields:m[1].split('|').map(s=>s.trim()),body:[]};}else if(current)current.body.push(line);}
 flush();
 if(out.length>1000)throw Error('В файле должно быть не больше 1000 диалогов.');
 return out;
}
export function timestampSeconds(value:string){if(/^\d{4}-/.test(value)){const ms=Date.parse(value);return Number.isFinite(ms)?ms/1000:null;}const p=value.replace(',','.').split(':').map(Number);if(p.length<2||p.length>3||p.some(n=>!Number.isFinite(n)||n<0))return null;return p.length===2?p[0]*60+p[1]:p[0]*3600+p[1]*60+p[2];}
export function audioTime(turn:Turn,list:Turn[]){const t=timestampSeconds(turn.timestamp);if(t===null)return null;if(/^\d{4}-/.test(turn.timestamp)){const first=list.map(t=>timestampSeconds(t.timestamp)).find(v=>v!==null);return first===undefined?null:Math.max(0,t-first!);}return t;}
