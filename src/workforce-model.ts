import {score,initialChecklist,demoConversation,uid,type Conversation,type Criterion,type Evaluation} from './qa-model';

export type Employee={id:string;name:string;aliases:string[];user_id:string|null;account_email?:string|null;created_at?:string;invitation_status?:'not_sent'|'sending'|'sent'|'error';invited_at?:string|null;invitation_error?:string|null};
export type Identity={name:string|null;employeeId:string|null;status:'matched'|'new'|'ambiguous'|'unknown';evidence:string[];candidates:string[]};
export type ReviewSummary={id:string;employee_id:string|null;name:string;language:string;channel:string;score:number|null;review_source:'ai'|'manual'|'demo';created_at:string;version:number;source_id?:string};
export type SavedReview=ReviewSummary&{transcript:Conversation['transcript'];checklist:Criterion[];evaluations:Record<string,Evaluation>;assignment_evidence:string[]};
export type EmployeeRating={id:string;name:string;user_id:string|null;review_count:number;rated_count:number;average_score:number|null;stars:number|null;open_appeals:number};
export type EmployeeAppeal={id:string;conversation_id:string;criterion_id:string;comment:string;author_id:string;status:'pending'|'accepted'|'rejected';decision_reason:string|null;created_at:string;decided_at:string|null;cqa_conversations?:{name:string;employee_id:string}|null};

export function canonicalName(value:string){return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\s'-]/gu,' ').replace(/\s+/g,' ').trim();}
function cleanName(raw:string){const words=raw.trim().replace(/[.!?,:;].*$/s,'').split(/\s+/).slice(0,3);const result:string[]=[];for(const word of words){if(/^(?:я|и|из|оператор|оператором|ваш|ваша|буду|готов|готова|помогу|сегодня|сотрудник|службы|поддержки|support|from|and|your|how|at)$/i.test(word))break;if(result.length&&word[0]!==word[0].toLocaleUpperCase())break;if(!/^[\p{L}][\p{L}'-]{1,30}$/u.test(word))break;result.push(word);}return result.join(' ');}
export function identifyEmployee(conversation:Conversation,employees:Employee[]):Identity{
 const found=new Map<string,{name:string;ids:string[]}>();
 for(const turn of conversation.transcript){if(turn.speaker!=='operator')continue;
  const patterns=[/(?:меня\s+зовут|мо[её]\s+имя|менің\s+атым|my\s+name\s+is)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*){0,2})/giu,/(?:здравствуйте|добрый\s+(?:день|вечер)|доброе\s+утро|сәлеметсіз\s+бе|hello|hi)[.!\s,;:—-]*(?:я|i\s+am|i['’]m)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*){0,2})/giu,/(?:с\s+вами\s+(?:на\s+связи\s+)?|вам\s+поможет\s+)([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*){0,2})/gu];
  for(const pattern of patterns)for(const match of turn.text.matchAll(pattern)){const prefix=turn.text.slice(0,match.index).trim();if(prefix.length>120||prefix&&!/^(?:здравствуйте|добрый|доброе|сәлеметсіз|hello|hi)[\p{L}\s!.,—-]*$/iu.test(prefix))continue;const name=cleanName(match[1]);if(!name)continue;const key=canonicalName(name);const previous=found.get(key);if(previous)previous.ids.push(turn.id);else found.set(key,{name,ids:[turn.id]});}
 }
 if(!found.size)return{name:null,employeeId:null,status:'unknown',evidence:[],candidates:[]};
 const entries=[...found.values()],evidence=[...new Set(entries.flatMap(e=>e.ids))];
 if(entries.length!==1)return{name:entries.map(e=>e.name).join(' / '),employeeId:null,status:'ambiguous',evidence,candidates:entries.map(e=>e.name)};
 const name=entries[0].name,key=canonicalName(name);const matches=employees.filter(e=>[e.name,...e.aliases].some(alias=>canonicalName(alias)===key));
 if(matches.length>1)return{name,employeeId:null,status:'ambiguous',evidence,candidates:matches.map(e=>e.name)};
 return{name,employeeId:matches[0]?.id??null,status:matches.length?'matched':'new',evidence,candidates:matches.map(e=>e.name)};
}
export function starsFromScore(value:number|null){return value===null||!Number.isFinite(value)?null:Math.round(Math.min(100,Math.max(0,value))/20*100)/100;}
export function employeeStats(reviews:ReviewSummary[],employeeId:string){const own=reviews.filter(r=>r.employee_id===employeeId),rated=own.filter(r=>r.score!==null);const average=rated.length?rated.reduce((sum,r)=>sum+r.score!,0)/rated.length:null;return{count:own.length,rated:rated.length,average,stars:starsFromScore(average)};}
export async function conversationFingerprint(c:Conversation){const text=JSON.stringify([c.sourceId??null,c.channel,c.transcript.map(t=>[t.timestamp,t.speaker,t.text])]);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}

export function workforceDemo(){
 const people:Employee[]=[{id:'demo-lera',name:'Лера',aliases:['Валерия'],user_id:null},{id:'demo-aliya',name:'Алия',aliases:[],user_id:null},{id:'demo-timur',name:'Тимур',aliases:[],user_id:null}];
 const seed=demoConversation();const reviews:SavedReview[]=[];
 for(const [person,index] of people.map((p,i)=>[p,i] as const))for(let n=0;n<(index===0?3:2);n++){const c=structuredClone(seed);c.transcript=c.transcript.map(t=>({...t,id:uid(),text:t.text.replace('Меня зовут Алия','Меня зовут '+person.name)}));for(const key of Object.keys(c.evaluations)){c.evaluations[key].evidence=[];c.evaluations[key].appeals=[];}c.evaluations.consultation.value=[20,15,10][(index+n)%3];reviews.push({id:uid(),employee_id:person.id,name:['Поиск отчёта','Вопрос о приложении','Уточнение запроса'][n],language:'RU',channel:n%2?'voice call':'agent chat',score:score(initialChecklist,c.evaluations).total,review_source:'demo',created_at:new Date(Date.now()-(index*3+n)*86400000).toISOString(),version:1,transcript:c.transcript,checklist:structuredClone(initialChecklist),evaluations:c.evaluations,assignment_evidence:[c.transcript[1].id]});}
 return{people,reviews};
}
