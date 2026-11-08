import {score,type Conversation,type Criterion,type Evaluation} from './qa-model';

export function uploadedConversations(cases:Conversation[],ids:readonly string[]){
 const byId=new Map(cases.map(c=>[c.id,c]));
 return ids.flatMap(id=>{const c=byId.get(id);return c?[c]:[];});
}
export function fileRows(cases:Conversation[],checklist:Criterion[]){
 return cases.map(c=>({id:c.id,name:(c.sourceId??c.name)+(c.targetRole?' · '+(c.targetRole==='bot'?'Бот':'Оператор'):''),total:score(checklist,c.evaluations).total,
  origin:c.reviewSource==='ai'?'ИИ':score(checklist,c.evaluations).complete?'Ручная оценка':'Не оценён'}));
}
export async function analyseFile(cases:Conversation[],signal:AbortSignal,
 request:(c:Conversation)=>Promise<Record<string,Evaluation>>,
 onResult:(c:Conversation,evaluations:Record<string,Evaluation>)=>void,
 onProgress:(done:number,total:number,current:string)=>void){
 let completed=0;const errors:{id:string;name:string;error:string}[]=[];
 for(const c of cases){
  if(signal.aborted)break;
  onProgress(completed+errors.length,cases.length,c.sourceId??c.name);
  try{const result=await request(c);if(signal.aborted)break;onResult(c,result);completed++;}
  catch(e){if(signal.aborted||e instanceof Error&&e.name==='AbortError')break;errors.push({id:c.id,name:c.sourceId??c.name,error:e instanceof Error?e.message:String(e)});}
  onProgress(completed+errors.length,cases.length,c.sourceId??c.name);
 }
 return{completed,errors,cancelled:signal.aborted,total:cases.length};
}
