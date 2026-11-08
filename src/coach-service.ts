import {db} from './workforce-client';
import type {CoachReview} from './coach-model';
export async function loadCoachReviews(employeeId:string,signal:AbortSignal):Promise<CoachReview[]>{
 const {data,error}=await db().from('cqa_conversations').select('id,employee_id,name,created_at,review_source,score,checklist,evaluations').eq('employee_id',employeeId).not('score','is',null).neq('review_source','demo').order('created_at',{ascending:false}).order('id').limit(100).abortSignal(signal);
 if(error)throw Error('Не удалось загрузить историю оценок. Попробуйте ещё раз.');return data??[];
}
export type CoachMessage={role:'user'|'assistant';text:string};
export type CoachReply={customer:string;feedback:string;complete:boolean};
declare global{interface Window{FREEDOM_COACH_CONFIG?:{endpoint?:string}}}
export const coachConnected=()=>!!window.FREEDOM_COACH_CONFIG?.endpoint?.trim();
export async function coachReady(signal:AbortSignal){if(!coachConnected())return false;const url=new URL(window.FREEDOM_COACH_CONFIG!.endpoint!,location.origin);if(url.origin!==location.origin)return false;try{const response=await fetch(url,{signal,cache:'no-store'});return response.ok&&(await response.json()).enabled===true;}catch{return false;}}
export function validateCoachReply(data:unknown):CoachReply{const v=data as CoachReply;if(!v||typeof v.customer!=='string'||typeof v.feedback!=='string'||typeof v.complete!=='boolean'||v.customer.length>4000||v.feedback.length>6000||(!v.complete&&!v.customer.trim())||!v.feedback.trim())throw Error('Coach вернул неполный ответ. Попробуйте ещё раз.');return {customer:v.customer,feedback:v.feedback,complete:v.complete};}
// Future server resolves authorized employee/history from JWT, never from a client claim.
export async function requestCoach(employeeId:string,criterionId:string,messages:CoachMessage[],signal:AbortSignal):Promise<CoachReply>{
 const configured=window.FREEDOM_COACH_CONFIG?.endpoint;if(!configured)throw Error('ИИ ещё не подключён. Доступна учебная практика.');
 const url=new URL(configured,location.origin);if(url.origin!==location.origin)throw Error('Coach должен использовать серверный маршрут на домене сайта.');
 if(messages.length>40||messages.some(m=>!m.text.trim()||m.text.length>4000||!['user','assistant'].includes(m.role)))throw Error('Превышен размер тренировки. Начните новую.');
 const {data,error}=await db().auth.getSession();if(error||!data.session)throw Error('Войдите снова, чтобы продолжить тренировку.');
 const response=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({employeeId,criterionId,messages})});
 if(!response.ok){let message=response.status===401?'Войдите снова.':response.status===403?'Этот профиль недоступен.':'Coach временно недоступен. Ваш ответ сохранён в поле ввода.';try{const body=await response.json();if(typeof body.error==='string')message=body.error.slice(0,300);}catch{}throw Error(message);}return validateCoachReply(await response.json());
}
