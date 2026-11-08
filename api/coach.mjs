import {get,head,put,BlobPreconditionFailedError,BlobNotFoundError} from '@vercel/blob';
import {createCoachBudget} from '../lib/coach-engine.mjs';
import {createCoachHandler} from '../lib/coach-handler.mjs';
const budgetPath='coach/private-budget-v1.json';
const budget=createCoachBudget({
 async read(){let metadata;try{metadata=await head(budgetPath);}catch(e){if(e instanceof BlobNotFoundError)return null;throw e;}const r=await get(budgetPath,{access:'private',useCache:false});if(r?.statusCode!==200)throw new CoachError(503,'Счётчик расходов недоступен. Платные запросы остановлены.');return{value:await new Response(r.stream).json(),etag:metadata.etag};},
 async write(value,etag){await put(budgetPath,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json'});},
 conflict:e=>e instanceof BlobPreconditionFailedError||/already exists/i.test(e.message),
});
export default createCoachHandler({budget,getKey:()=>process.env.COACH_OPENAI_API_KEY,storageConfigured:()=>!!process.env.BLOB_READ_WRITE_TOKEN});
