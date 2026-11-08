import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {checklist,recordsFrom,checkSplit,fingerprint,responseFormat,resultFrom,failure,documentFor,validate} from './lib.mjs';
const require=createRequire(import.meta.url);
const {buildRequest,parseAnswer}=require('../cqa-local-model.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf('--'+name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Нет значения --'+name);return args[i+1];};
async function main(){
  const input=get('input'),split=get('split');if(!input||!split)throw Error('Запуск: node submission/run.mjs --split dev|prod --input <набор.json> [--resume] [--retry-errors]');
  const config=JSON.parse(fs.readFileSync(path.join(root,'submission/config.json'),'utf8'));
  const records=recordsFrom(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')));checkSplit(records,split);
  const modelUrl=get('model-url',config.model_url).replace(/\/$/,'');const url=new URL(modelUrl);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw Error('Этот runner предназначен только для локального llama-server.');
  const timeout=Number(get('timeout-ms','300000'));if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>900000)throw Error('Неверный timeout-ms.');
  // Fail before writing results if the local model is unavailable; do not create 65 fake failures.
  const health=await fetch(modelUrl+'/v1/models',{signal:AbortSignal.timeout(10000)});if(!health.ok)throw Error('Модель недоступна: HTTP '+health.status);
  const modelList=await health.json();const availableNames=(modelList.data??[]).map(m=>String(m.id));if(!availableNames.some(n=>n.toLowerCase().includes('qwen3.5-4b-cqa-q4_k_m')))throw Error('Запущена другая модель. Ожидается Qwen3.5-4B-cqa-Q4_K_M.gguf.');
  const provenance=fingerprint({version:2,records,checklist,model:config.model});
  const cacheFile=path.join(root,'tmp/submission',split+'.checkpoint.json');const output=path.resolve(get('output',path.join(root,'results',split,'results.json')));
  fs.mkdirSync(path.dirname(cacheFile),{recursive:true});fs.mkdirSync(path.dirname(output),{recursive:true});
  let done=[];if(args.includes('--resume')&&fs.existsSync(cacheFile)){const old=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(old.provenance!==provenance)throw Error('Checkpoint относится к другому набору, модели или чек-листу.');done=old.results;}
  const save=()=>{fs.writeFileSync(cacheFile+'.tmp',JSON.stringify({provenance,results:done},null,2)+'\n');fs.renameSync(cacheFile+'.tmp',cacheFile);};
  for(const [i,raw] of records.entries()){
    const previous=done.find(r=>r.conversation_id===raw.conversation_id);if(previous&&!(args.includes('--retry-errors')&&previous.status==='error')){console.log(`${i+1}/${records.length} ${raw.conversation_id}: сохранено`);continue;}
    const record={...raw,transcript:raw.transcript.map((t,n)=>({...t,id:`t${n+1}`}))};const started=Date.now();let item;
    try{
      const request=buildRequest({conversation:record,checklist});
      request.messages[0].content+='\nОценивай только оператора. Бот и события — контекст. Для каждого критерия обязательно дай непустое evidence с ID исходных реплик t1, t2 и т. д.; для пропущенного действия укажи участок, где оно ожидалось. Для N/A объясни условие. Для gross=no укажи проверенные реплики оператора. Не придумывай внутренние правила компании.';
      const response=await fetch(modelUrl+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:availableNames[0],messages:request.messages,temperature:0,max_tokens:2200,response_format:responseFormat(record),chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(timeout)});
      if(!response.ok)throw Error('HTTP '+response.status+' при локальной оценке.');const data=await response.json();if(data.choices?.[0]?.finish_reason==='length')throw Error('Ответ модели оборван лимитом токенов.');const parsed=parseAnswer(data.choices?.[0]?.message?.content??'',request);item=resultFrom(record,parsed.evaluations);
    }catch(e){item=failure(raw.conversation_id,e.message);}
    done=done.filter(r=>r.conversation_id!==raw.conversation_id);done.push(item);save();
    console.log(`${i+1}/${records.length} ${raw.conversation_id}: ${item.status}${item.score?' '+item.score.final_score:''} (${Math.round((Date.now()-started)/1000)} с)${item.error?' '+item.error:''}`);
  }
  const doc=documentFor(config,records.map(r=>done.find(d=>d.conversation_id===r.conversation_id)));const stats=validate(doc,{split,records});
  fs.writeFileSync(output+'.tmp',JSON.stringify(doc,null,2)+'\n');fs.renameSync(output+'.tmp',output);
  console.log(JSON.stringify({output,...stats}));if(stats.errors)process.exitCode=2;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
