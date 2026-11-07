import React,{useState} from 'react';
import type {Employee} from './workforce-model';

// Stable across browsers, profile renames, and changes in directory order.
export function employeeAvatarSlot(id:string){let value=2166136261;for(const char of id)value=Math.imul(value^char.charCodeAt(0),16777619);return(value>>>0)%6;}

export function EmployeeAvatar({person,className=''}:{person:Pick<Employee,'id'|'name'>;className?:string}){
 const [failed,setFailed]=useState(false),slot=employeeAvatarSlot(person.id);
 const initials=person.name.trim().split(/\s+/).map(word=>word[0]).slice(0,2).join('');
 return <span className={`wf-avatar wf-avatar-portrait ${className}`} role="img" aria-label={`Иллюстрированный аватар: ${person.name}`}>
  <span className="wf-avatar-initials" aria-hidden="true">{initials}</span>
  {!failed&&<img src="assets/employee-avatars.png" alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} style={{left:`-${slot%3*100}%`,top:`-${Math.floor(slot/3)*100}%`}} onError={()=>setFailed(true)}/>}
 </span>;
}
