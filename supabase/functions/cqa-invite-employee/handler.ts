export type Invite={id:string;name:string;email:string;userId:string|null;needsPassword:boolean;attemptId:string};
export type InviteDependencies={
 authenticate:(token:string)=>Promise<string|null>;
 isManager:(token:string,id:string)=>Promise<boolean>;
 prepare:(id:string,email:string,manager:string)=>Promise<Invite>;
 sendNew:(email:string,name:string,redirect:string)=>Promise<string>;
 sendExisting:(email:string,redirect:string)=>Promise<void>;
 finish:(invite:Invite,userId:string|null,error:string|null)=>Promise<void>;
};
const SITE='https://freedom-bank-concept.vercel.app';
export function inviteHandler(deps:InviteDependencies){return async(req:Request)=>{
 const origin=req.headers.get('Origin');const allowed=!origin||origin===SITE||/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowed?(origin||SITE):SITE,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers});
 if(!allowed)return reply(403,{message:'Недопустимый источник запроса.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{message:'Используйте POST.'});
 const bearer=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!bearer)return reply(401,{message:'Войдите в аккаунт руководителя.'});
 let invite:Invite|null=null;
 try{
  const managerId=await deps.authenticate(bearer);if(!managerId)return reply(401,{message:'Сессия истекла. Войдите снова.'});
  if(!await deps.isManager(bearer,managerId))return reply(403,{message:'Приглашать сотрудников может только руководитель.'});
  if(Number(req.headers.get('Content-Length')||0)>4096)return reply(413,{message:'Слишком большой запрос.'});
  const reader=req.body?.getReader();let total=0;const parts:Uint8Array[]=[];if(reader)for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>4096){await reader.cancel();return reply(413,{message:'Слишком большой запрос.'});}parts.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{message:'Неверный формат запроса.'});}
  if(typeof body?.employeeId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.employeeId)||typeof body?.email!=='string'||body.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))return reply(400,{message:'Проверьте сотрудника и email.'});
  invite=await deps.prepare(body.employeeId,body.email.trim().toLowerCase(),managerId);
  const redirect=SITE+'/invite.html?setup='+(invite.needsPassword?'1':'0');
  let userId=invite.userId;if(userId)await deps.sendExisting(invite.email,redirect);else userId=await deps.sendNew(invite.email,invite.name,redirect);
  await deps.finish(invite,userId,null);
  return reply(200,{status:'sent',employeeId:invite.id,message:'Приглашение отправлено. Сотрудник получит ссылку на рабочий кабинет.'});
 }catch(error){const code=(error as {code?:string}).code;const message=(error as Error)?.message??'';let safe='Приглашение не отправлено. Проверьте SMTP в Supabase и повторите попытку.';let status=502;
  if(code==='42501'){safe='Приглашать сотрудников может только руководитель.';status=403;}else if(/через минуту/.test(message)){safe=message;status=429;}else if(/Сотрудник не найден|Проверьте email|Профиль уже|Этот email уже/.test(message)){safe=message;status=409;}else if(code==='over_email_send_rate_limit'||code==='over_request_rate_limit'){safe='Превышен лимит отправки писем. Попробуйте позже.';status=429;}
  if(invite)try{await deps.finish(invite,null,safe);}catch{/* No credentials or invite tokens are logged. */}
  return reply(status,{status:'error',message:safe});
 }
};}
