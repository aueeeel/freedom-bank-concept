// Adapted from the supplied Holographic Business Card by Aakash Mehra.
// Uses the supplied foil texture, with Freedom branding and real profile fields.
import React,{useEffect,useRef,useState} from 'react';
import type {Employee,EmployeeRating} from './workforce-model';
import {Stars} from './workforce-ui';
import {EmployeeAvatar} from './EmployeeAvatar';

export function EmployeeIdentityCard({person,stat}:{person:Employee;stat?:EmployeeRating}){
 const [flipped,setFlipped]=useState(false),button=useRef<HTMLButtonElement>(null);
 const motion=useRef({x:0,y:0,tx:0,ty:0,frame:0,last:0,reduce:false});
 useEffect(()=>{
  const state=motion.current,media=matchMedia('(prefers-reduced-motion: reduce)');
  const change=()=>{state.reduce=media.matches;state.tx=state.ty=state.x=state.y=0;button.current?.style.setProperty('--id-rx','0deg');button.current?.style.setProperty('--id-ry','0deg');};
  change();media.addEventListener('change',change);
  return()=>{cancelAnimationFrame(state.frame);media.removeEventListener('change',change);};
 },[]);
 function animate(time:number){
  const state=motion.current,dt=state.last?Math.min(time-state.last,64):16;state.last=time;
  const k=1-Math.exp(-dt/100);state.x+=(state.tx-state.x)*k;state.y+=(state.ty-state.y)*k;
  button.current?.style.setProperty('--id-rx',`${state.x.toFixed(3)}deg`);button.current?.style.setProperty('--id-ry',`${state.y.toFixed(3)}deg`);
  if(!state.reduce&&Math.abs(state.tx-state.x)+Math.abs(state.ty-state.y)>.02)state.frame=requestAnimationFrame(animate);else{state.frame=0;state.last=0;}
 }
 function reset(){const state=motion.current;state.tx=state.ty=0;if(!state.frame)state.frame=requestAnimationFrame(animate);}
 return <div className="wf-id-wrap"><div className="wf-id-stage" onPointerMove={event=>{
   const rect=event.currentTarget.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
   button.current?.style.setProperty('--id-mx',`${(x*100).toFixed(2)}%`);button.current?.style.setProperty('--id-my',`${(y*100).toFixed(2)}%`);
   const state=motion.current;if(state.reduce)return;state.tx=(.5-y)*22;state.ty=(x-.5)*26;if(!state.frame)state.frame=requestAnimationFrame(animate);
  }} onPointerLeave={reset} onPointerCancel={reset}>
  <button ref={button} type="button" className="wf-id-card" data-flipped={flipped} aria-label={`${person.name}. ${flipped?'Показать лицевую сторону карточки сотрудника':'Перевернуть карточку сотрудника'}`} aria-pressed={flipped} onClick={()=>setFlipped(value=>!value)} onBlur={reset}>
   <span className="wf-id-turn">
    <span className="wf-id-face wf-id-front" aria-hidden={flipped}>
     <span className="wf-id-sky"><span className="wf-id-top"><span className="wf-id-brand"><img src="assets/freedom-logo.png" alt="Freedom Bank" draggable={false}/></span><span>WORKSPACE<br/>ЛИЧНАЯ КАРТА</span></span>
      <span className="wf-id-person"><span><span className="wf-id-greeting">Привет, я</span><strong>{person.name}</strong><span className="wf-id-role">Сотрудник поддержки</span></span><span className="wf-id-seal"><EmployeeAvatar person={person} className="wf-id-avatar"/></span></span>
     </span>
     <span className="wf-id-strip"><span>FREEDOM TEAM</span><span>Мой рабочий профиль</span></span>
     <span className="wf-id-foil" aria-hidden="true"/><span className="wf-id-glare" aria-hidden="true"/>
    </span>
    <span className="wf-id-face wf-id-back" aria-hidden={!flipped}>
     <span className="wf-id-back-top">FREEDOM / МОЙ ПРОФИЛЬ</span><strong className="wf-id-back-name">{person.name}</strong><span className="wf-id-email">{person.account_email||'Личный рабочий аккаунт'}</span>
     <span className="wf-id-back-stats"><span><small>МОЙ РЕЙТИНГ</small><Stars value={stat?.stars??null}/><b>{stat?.stars?.toLocaleString('ru-RU',{maximumFractionDigits:2})??'—'} <small>/ 5</small></b></span><span><small>ПРОВЕРЕНО</small><b>{stat?.rated_count??0}</b><span>разговоров с оценкой</span></span></span>
     <span className="wf-id-back-foot">Ваша работа. Ваш прогресс.</span><span className="wf-id-foil" aria-hidden="true"/><span className="wf-id-glare" aria-hidden="true"/>
    </span>
   </span>
  </button>
 </div><p className="wf-id-hint">Наведите, чтобы увидеть сияние. Нажмите, чтобы перевернуть.</p></div>;
}
