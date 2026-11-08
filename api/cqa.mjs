import {get,head,put,BlobPreconditionFailedError,BlobNotFoundError} from '@vercel/blob';
import {createQueue,HttpError,validateInput,workerAuthorized} from '../lib/cqa-queue.mjs';
const path='cqa/private-queue-v1.json';
const queue=createQueue({
 async save(kind,key,value){
  const filename='cqa/'+kind+'/'+key+'.json';
  try{await head(filename);return filename;}catch(e){if(!(e instanceof BlobNotFoundError))throw e;}
  try{await put(filename,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}catch(e){if(!/already exists/i.test(e.message))throw e;}
  return filename;
 },
 async load(filename){
  if(!/^cqa\/(?:inputs|results)\/[a-f0-9]{64}\.json$/.test(filename))throw new Error('Invalid private object reference');
  const r=await get(filename,{access:'private'});if(r?.statusCode!==200)throw new Error('Private object unavailable');return new Response(r.stream).json();
 },
 async read(mode){
  // Blob GET uses an HTTP entity tag; conditional writes require the metadata tag.
  // Read metadata first, then bypass the CDN: a concurrent write makes this CAS fail safely.
  let metadata;
  if(mode==='write')try{metadata=await head(path);}catch(e){if(e instanceof BlobNotFoundError)return null;throw e;}
  const r=await get(path,{access:'private',useCache:false});
  return r?.statusCode===200?{value:await new Response(r.stream).json(),etag:metadata?.etag??null}:null;
 },
 async write(value,etag){await put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json'});},
 conflict:e=>e instanceof BlobPreconditionFailedError||/already exists/i.test(e.message),
});
const publicAuth={url:'https://znnlztgbhnblqmjxqozp.supabase.co',key:'sb_publishable_GwHq4wfBacJKdePB7EYctg_e2H7ekrF'};
async function manager(request){
 const auth=request.headers.get('authorization');
 if(!/^Bearer \S+$/.test(auth??''))throw new HttpError(401,'Войдите в аккаунт менеджера для автоматической проверки.');
 const headers={apikey:publicAuth.key,Authorization:auth};
 const r=await fetch(publicAuth.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new HttpError(401,'Сессия истекла. Войдите снова.');
 const user=await r.json();
 const membership=await fetch(publicAuth.url+'/rest/v1/cqa_managers?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{headers,signal:AbortSignal.timeout(10000)});
 if(!membership.ok||!(await membership.json()).some(x=>x.user_id===user.id))throw new HttpError(403,'Автоматическую оценку запускает менеджер.');
 return user.id;
}
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default{async fetch(request){
 try{
  const url=new URL(request.url),action=url.searchParams.get('action')??'health';
  if(request.method==='GET'&&action==='health')return reply({service:'freedom-cqa-queue',version:1,configured:!!process.env.CQA_WORKER_TOKEN,storage:!!process.env.BLOB_READ_WRITE_TOKEN});
  const isWorker=workerAuthorized(request.headers.get('authorization'),process.env.CQA_WORKER_TOKEN);
  const origin=request.headers.get('origin');
  if(!isWorker&&origin&&origin!==url.origin)throw new HttpError(403,'Разрешён только запрос с домена сайта.');
  if(request.method==='GET'&&action==='job'){const owner=await manager(request);return reply(await queue.get(owner,url.searchParams.get('id')));}
  if(request.method!=='POST')throw new HttpError(405,'Метод не поддерживается.');
  if(Number(request.headers.get('content-length')??0)>1000000)throw new HttpError(413,'Запрос слишком большой.');
  const text=await request.text();if(text.length>1000000)throw new HttpError(413,'Запрос слишком большой.');
  let body;try{body=JSON.parse(text);}catch{throw new HttpError(400,'Некорректный JSON.');}
  if(['claim','finish','heartbeat','selftest','selftest-result','selftest-appeal'].includes(action)){
   if(!isWorker)throw new HttpError(401,'Неверный ключ обработчика.');
   if(action==='claim')return reply(await queue.claim(String(body.worker_id).slice(0,100)));
   if(action==='finish')return reply(await queue.finish(body.worker_id,body.id,body.lease,body.result,body.error));
   if(action==='heartbeat')return reply(await queue.heartbeat(body.worker_id,body.id,body.lease));
   if(action==='selftest-result')return reply(await queue.get('worker-selftest',body.id));
   if(action==='selftest-appeal')return reply(await queue.appeal('worker-selftest',body.parent_id,body.criterion_id,body.argument,body.selected_ids));
   return reply(await queue.enqueue('worker-selftest',validateInput(body)));
  }
  const owner=await manager(request);
  if(action==='enqueue')return reply(await queue.enqueue(owner,validateInput(body)),202);
  if(action==='appeal')return reply(await queue.appeal(owner,body.parent_id,body.criterion_id,body.argument,body.selected_ids),202);
  throw new HttpError(400,'Неизвестное действие.');
 }catch(error){
  if(!(error instanceof HttpError))console.error('CQA queue failed',error?.constructor?.name??'Error',String(error?.message??'').replace(/(?:vercel_blob_rw_|Bearer )[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,300));
  return reply({error:error instanceof HttpError?error.message:'Очередь временно недоступна. Задачи и оценки не заменяются вымышленными результатами.'},error instanceof HttpError?error.status:503);
 }
}};
