import {CoachError,coachLimits,validateCoachInput,authorizeCoachTarget,buildCoachRequest,parseCoachResponse,digest} from './coach-engine.mjs';
export function createCoachHandler({budget,getKey=()=>'',storageConfigured=()=>false,fetchImpl=globalThis.fetch}){
const fetch=fetchImpl;
const publicAuth={url:'https://znnlztgbhnblqmjxqozp.supabase.co',key:'sb_publishable_GwHq4wfBacJKdePB7EYctg_e2H7ekrF'};
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function rows(path,headers){const r=await fetch(publicAuth.url+path,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw new CoachError(503,'Не удалось проверить доступ или загрузить историю. Платный запрос не отправлен.');return r.json();}
async function authorize(request,employeeId){
 const auth=request.headers.get('authorization');if(!/^Bearer \S+$/.test(auth??''))throw new CoachError(401,'Войдите в рабочий аккаунт.');
 const headers={apikey:publicAuth.key,Authorization:auth};const response=await fetch(publicAuth.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});if(!response.ok)throw new CoachError(401,'Сессия истекла. Войдите снова.');const user=await response.json();if(typeof user.id!=='string')throw new CoachError(401,'Не удалось подтвердить аккаунт.');
 const [managers,people]=await Promise.all([rows('/rest/v1/cqa_managers?select=user_id&user_id=eq.'+encodeURIComponent(user.id),headers),rows('/rest/v1/cqa_employees?select=id,user_id&id=eq.'+encodeURIComponent(employeeId),headers)]);
 authorizeCoachTarget(user.id,managers.some(m=>m.user_id===user.id),people.find(p=>p.id===employeeId));return{userId:user.id,headers};
}
return {async fetch(request){
 let reservation,key;
 try{
  const url=new URL(request.url);
  if(request.method==='GET')return reply({enabled:!!getKey()&&!!storageConfigured(),limits:{monthlyCalls:coachLimits.monthlyCalls,userDailyCalls:coachLimits.userDailyCalls,maxReplies:6,monthlyReserveUsd:coachLimits.monthlyReserveUsd}});
  if(request.method!=='POST')throw new CoachError(405,'Метод не поддерживается.');
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new CoachError(403,'Разрешён только запрос с домена сайта.');
  if(!getKey()||!storageConfigured())throw new CoachError(503,'ИИ ещё не настроен. Доступна учебная практика.');
  if(!/^Bearer \S+$/.test(request.headers.get('authorization')??''))throw new CoachError(401,'Войдите в рабочий аккаунт.');
  if(Number(request.headers.get('content-length')??0)>24000)throw new CoachError(413,'Слишком длинный запрос.');const text=await request.text();if(Buffer.byteLength(text)>24000)throw new CoachError(413,'Слишком длинный запрос.');let body;try{body=JSON.parse(text);}catch{throw new CoachError(400,'Некорректный JSON.');}
  const input=validateCoachInput(body),access=await authorize(request,input.employeeId);
  const reviews=await rows('/rest/v1/cqa_conversations?select=id,employee_id,name,created_at,review_source,score,checklist,evaluations&employee_id=eq.'+encodeURIComponent(input.employeeId)+'&score=not.is.null&review_source=neq.demo&order=created_at.desc,id.asc&limit=100',access.headers);
  const providerBody=buildCoachRequest(input,reviews);key=digest({version:2,owner:access.userId,input});reservation=await budget.reserve(digest(access.userId),key);if(reservation.cached)return reply(reservation.cached);
  // One bounded provider call, no automatic retries, tools, web search or background work.
  const provider=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+getKey(),'Content-Type':'application/json'},body:JSON.stringify(providerBody),signal:AbortSignal.timeout(35000)});
  if(!provider.ok)throw new CoachError(503,provider.status===401?'Ключ Coach не принят. Сообщите руководителю.':provider.status===429?'Достигнут лимит провайдера. Попробуйте позже.':'Coach временно недоступен. Автоматические повторы отключены.');
  const result=parseCoachResponse(await provider.json(),input.messages.filter(m=>m.role==='user').length);
  try{await budget.finish(key,reservation.lease,result);}catch{/* Reservation stays consumed even if caching fails. */}
  return reply(result);
 }catch(error){
  if(reservation?.lease&&key)try{await budget.finish(key,reservation.lease,null);}catch{/* Fail closed; never refund an uncertain provider call. */}
  return reply({error:error instanceof CoachError?error.message:'Coach временно недоступен. Платные запросы остановлены.'},error instanceof CoachError?error.status:503);
 }
}};

}
