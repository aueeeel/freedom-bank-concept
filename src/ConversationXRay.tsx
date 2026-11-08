import React,{useMemo,useState} from 'react';
import {finalValue,type Criterion,type Evaluation,type Speaker,type Turn} from './qa-model';
import {audioTime} from './qa-files';

// «Рентген разговора»: кто и когда говорил, паузы, перебивания, доля речи и места нарушений по чек-листу.
type Span={turn:Turn;start:number;end:number};
const ROLE_NAMES:Record<Speaker,string>={operator:'Оператор',client:'Клиент',bot:'Бот',system:'Система',unknown:'Не указана'};
const fmt=(s:number)=>{const t=Math.max(0,Math.round(s)),m=Math.floor(t/60),r=t%60;return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;};
const pct=(v:number,total:number)=>total>0?Math.max(0,Math.min(100,v/total*100)):0;

export function timeline(turns:Turn[]):Span[]{
 const starts=turns.map(t=>t.startSec??audioTime(t,turns));
 return turns.map((turn,i)=>{
  const start=starts[i];if(start===null||start===undefined)return null;
  const next=starts.slice(i+1).find(v=>v!==null&&v!==undefined&&v>=start);
  // Без точного конца реплики оцениваем длительность по числу слов (≈2,5 слова в секунду).
  const estimate=start+Math.max(1,turn.text.split(/\s+/).length/2.5);
  const end=turn.endSec??Math.min(estimate,next??estimate);
  return{turn,start,end:Math.max(end,start+0.5)};
 }).filter((s):s is Span=>!!s);
}

export function xrayStats(spans:Span[]){
 const total=spans.length?Math.max(...spans.map(s=>s.end))-Math.min(...spans.map(s=>s.start)):0;
 const talk:Record<string,number>={};for(const s of spans)talk[s.turn.speaker]=(talk[s.turn.speaker]??0)+(s.end-s.start);
 let longestPause={length:0,at:0},interruptions:Span[]=[],responses:number[]=[];
 const people=spans.filter(s=>s.turn.speaker!=='system');
 for(let i=1;i<people.length;i++){
  const prev=people[i-1],cur=people[i];
  const gap=cur.start-Math.max(...people.slice(0,i).map(s=>s.end));
  if(gap>longestPause.length)longestPause={length:gap,at:cur.start};
  if(cur.turn.speaker==='operator'&&prev.turn.speaker==='client'){
   if(cur.start<prev.end-0.3&&prev.turn.endSec!==undefined)interruptions.push(cur);
   else responses.push(Math.max(0,cur.start-prev.end));
  }
 }
 const spoken=(talk.operator??0)+(talk.client??0);
 return{total,talk,operatorShare:spoken?Math.round((talk.operator??0)/spoken*100):null,longestPause,interruptions,avgResponse:responses.length?responses.reduce((a,b)=>a+b,0)/responses.length:null,turns:{operator:spans.filter(s=>s.turn.speaker==='operator').length,client:spans.filter(s=>s.turn.speaker==='client').length}};
}

/** Места, где чек-лист нашёл проблему: критерий «Нет», шкала ниже максимума или грубая ошибка. */
export function issueMarks(checklist:Criterion[],evaluations:Record<string,Evaluation>){
 const marks:{turnId:string;criterion:string;severe:boolean}[]=[];
 for(const c of checklist){const e=evaluations[c.id];if(!e)continue;const v=finalValue(e);
  const bad=c.type==='flag'?v==='yes':c.type==='scale'?typeof v==='number'&&v<Math.max(...c.scale):v==='no';
  if(bad)for(const id of e.evidence??[])marks.push({turnId:id,criterion:c.name,severe:c.type==='flag'});}
 return marks;
}

export function ConversationXRay({turns,checklist,evaluations,onSeek,onRoles,focus}:{turns:Turn[];checklist:Criterion[];evaluations:Record<string,Evaluation>;onSeek:(turn:Turn)=>void;onRoles:(voice:string,role:Speaker)=>void;focus:string|null}){
 const [view,setView]=useState<'xray'|'split'>('xray');
 const spans=useMemo(()=>timeline(turns),[turns]);
 const stats=useMemo(()=>xrayStats(spans),[spans]);
 const marks=useMemo(()=>issueMarks(checklist,evaluations),[checklist,evaluations]);
 const voices=useMemo(()=>{const map=new Map<string,Speaker>();for(const t of turns)if(t.voice&&!map.has(t.voice))map.set(t.voice,t.speaker);return[...map];},[turns]);
 const from=spans.length?Math.min(...spans.map(s=>s.start)):0,span=stats.total||1;
 const lanes:Speaker[]=(['operator','client','bot','unknown'] as Speaker[]).filter(r=>r==='operator'||r==='client'||spans.some(s=>s.turn.speaker===r));
 const marked=new Map<string,string[]>();for(const m of marks)marked.set(m.turnId,[...(marked.get(m.turnId)??[]),m.criterion]);
 if(!spans.length)return <div className="xr"><p className="xr-empty">Для рентгена нужны метки времени у реплик.</p></div>;
 return <div className="xr" aria-label="Рентген разговора">
  <div className="xr-head"><span className="qa-card-caption">РЕНТГЕН РАЗГОВОРА</span><div className="xr-tabs" role="tablist">{([['xray','Лента'],['split','Оператор / клиент']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={view===id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div></div>
  {voices.length>0&&<div className="xr-voices"><span>Голоса в записи:</span>{voices.map(([voice,role])=><label key={voice}>{voice}<select aria-label={`Роль: ${voice}`} value={role} onChange={e=>onRoles(voice,e.target.value as Speaker)}>{(['operator','client','unknown'] as Speaker[]).map(r=><option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></label>)}{voices.length===2&&<button className="qa-quiet" onClick={()=>{const [[a,ra],[b,rb]]=voices;onRoles(a,rb);onRoles(b,ra);}}>Поменять местами</button>}</div>}
  {view==='xray'?<>
   <dl className="xr-stats">
    <div><dt>Длительность</dt><dd>{fmt(stats.total)}</dd></div>
    <div><dt>Говорит оператор</dt><dd>{stats.operatorShare===null?'—':`${stats.operatorShare}%`}</dd><div className="xr-share" aria-hidden="true"><i style={{width:`${stats.operatorShare??0}%`}}/></div></div>
    <div><dt>Реплик</dt><dd>{stats.turns.operator} / {stats.turns.client}</dd><small>оператор / клиент</small></div>
    <div><dt>Ответ оператора</dt><dd>{stats.avgResponse===null?'—':`${Math.round(stats.avgResponse)} с`}</dd><small>в среднем</small></div>
    <div><dt>Самая долгая пауза</dt><dd>{stats.longestPause.length>=1?`${Math.round(stats.longestPause.length)} с`:'—'}</dd>{stats.longestPause.length>=1&&<small>на {fmt(stats.longestPause.at-from)}</small>}</div>
    <div><dt>Перебивания</dt><dd>{stats.interruptions.length}</dd><small>оператор перебил клиента</small></div>
   </dl>
   <div className="xr-chart">
    {lanes.map(role=><div className="xr-lane" key={role}><span className="xr-lane-name">{ROLE_NAMES[role]}</span><div className="xr-track">{spans.filter(s=>s.turn.speaker===role).map(s=>{const issues=marked.get(s.turn.id);return <button key={s.turn.id} className={`xr-bar ${role}${issues?' issue':''}${focus===s.turn.id?' focused':''}`} style={{left:`${pct(s.start-from,span)}%`,width:`${Math.max(0.6,pct(s.end-s.start,span))}%`}} title={`${s.turn.timestamp} · ${s.turn.text.slice(0,140)}${issues?`\n⚠ ${issues.join(', ')}`:''}`} aria-label={`${ROLE_NAMES[role]}, ${s.turn.timestamp}${issues?`, замечание: ${issues.join(', ')}`:''}`} onClick={()=>onSeek(s.turn)}/>;})}</div></div>)}
    <div className="xr-axis" aria-hidden="true">{[0,0.25,0.5,0.75,1].map(f=><span key={f} style={{left:`${f*100}%`}}>{fmt(f*span)}</span>)}</div>
   </div>
   {marks.length>0&&<ul className="xr-issues">{marks.map((m,i)=>{const t=turns.find(t=>t.id===m.turnId);return t?<li key={i}><button className={m.severe?'severe':''} onClick={()=>onSeek(t)}><b>{t.timestamp||'—'}</b>{m.criterion}<span>«{t.text.slice(0,90)}»</span></button></li>:null;})}</ul>}
  </>:<div className="xr-split">{(['operator','client'] as Speaker[]).map(role=><section key={role}><h4>{ROLE_NAMES[role]}</h4>{spans.filter(s=>s.turn.speaker===role).map(s=><button key={s.turn.id} className={`xr-line${marked.has(s.turn.id)?' issue':''}${focus===s.turn.id?' focused':''}`} onClick={()=>onSeek(s.turn)}><time>{s.turn.timestamp}{s.turn.endSec!==undefined&&`–${fmt(s.turn.endSec)}`}</time><span>{s.turn.text}</span></button>)}{!spans.some(s=>s.turn.speaker===role)&&<p className="xr-empty">Реплик нет. Проверьте роли голосов выше.</p>}</section>)}</div>}
 </div>;
}
