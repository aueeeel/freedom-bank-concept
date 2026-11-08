import {uid,type Conversation} from './qa-model';
export function actorCases(c:Conversation):Conversation[]{
 if(c.targetRole)return[c];
 const roles=(['bot','operator'] as const).filter(role=>c.transcript.some(t=>t.speaker===role));
 return roles.length?roles.map(role=>({...c,id:roles.length>1?uid():c.id,targetRole:role,
  sourceId:c.sourceId??c.id,name:c.name+' · '+(role==='bot'?'Бот':'Оператор'),evaluations:{},
  employeeId:role==='bot'?undefined:c.employeeId})): [c];
}
