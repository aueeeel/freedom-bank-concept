import {createHash} from 'node:crypto';

// Submission Appendix 1.0. This contract is independent of the website's editable weights.
export const rules = [
  {id:'contact', internal:'contact', weight:10, values:[true,false]},
  {id:'discovery', internal:'needs', weight:15, values:[true,false,null]},
  {id:'identification', internal:'identity', weight:20, values:[true,false,null]},
  {id:'consultation', internal:'consultation', weight:20, max:20, values:[0,5,10,15,20,null]},
  {id:'empathy', internal:'empathy', weight:15, values:[true,false]},
  {id:'dialogue', internal:'management', weight:15, max:10, values:[0,4,7,10]},
  {id:'closure', internal:'closing', weight:5, values:[true,false,null]},
  {id:'critical', internal:'gross', weight:0, values:[true,false]},
];
const definitions = [
  'Оператор поздоровался на языке клиента и представился в первом ответе.',
  'Оператор учёл известные детали и уточнил недостающее до ответа. N/A: данных для ответа хватало с самого начала.',
  'Проверка личности подтверждена до раскрытия данных или защищённого действия. N/A: запрос не требовал идентификации.',
  '20: все существенные вопросы закрыты или дан корректный следующий шаг; 15: основной вопрос решён, пропущена второстепенная деталь; 10: часть запроса закрыта, существенный вопрос открыт; 5: общая подсказка, но непонятно, как действовать; 0: ответа по существу нет или ключевая рекомендация ошибочна. N/A: чат закончился до формулировки запроса.',
  'Оператор вежлив и, если клиент выразил недовольство или описал неудобство, отреагировал на конкретную проблему.',
  '10: ответы ясные и связные, при явном ожидании оператор предупредил; 7: один заметный сбой, ответ понятен; 4: клиент переспрашивает из-за формулировок или порядка; 0: ход диалога непонятен из-за бессвязных или противоречивых реплик. Порог первой реакции 3 минуты, теги и вложения не учитываются.',
  'Оператор подвёл итог или предложил дальнейшую помощь и попрощался. N/A: чат оборвался до возможности завершения.',
  'Да: оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Флаг не обнуляет итог.',
];
const names=['Установление контакта','Выявление потребности','Идентификация','Корректная и полная консультация','Эмпатия','Ведение диалога','Завершение','Грубые ошибки'];
export const checklist=rules.map((r,i)=>({id:r.internal,name:names[i],definition:definitions[i],weight:r.weight,type:r.max?'scale':r.weight?'binary':'flag',scale:r.max?r.values.filter(v=>typeof v==='number'):[],allowNA:r.values.includes(null)}));
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function responseFormat(record){
  const properties=Object.fromEntries(checklist.map(c=>[c.id,{type:'object',properties:{value:{enum:c.type==='scale'?[...c.scale,...(c.allowNA?['na']:[])]:['yes','no',...(c.allowNA?['na']:[])]},reason:{type:'string',minLength:1},evidence:{type:'array',minItems:1,maxItems:12,items:{enum:record.transcript.map((_,i)=>`t${i+1}`)}}},required:['value','reason','evidence'],additionalProperties:false}]));
  return {type:'json_object',schema:{type:'object',properties:{evaluations:{type:'object',properties,required:checklist.map(c=>c.id),additionalProperties:false}},required:['evaluations'],additionalProperties:false}};
}
export function recordsFrom(data){
  if(data?.isSuccess===false)throw Error('API вернул ошибку получения набора.');
  const records=data?.data?.records??data?.records??(Array.isArray(data)?data:null);
  if(!Array.isArray(records)||!records.length)throw Error('Нет непустого массива records.');
  const seen=new Set();
  for(const r of records){
    if(typeof r.conversation_id!=='string'||!r.conversation_id.trim()||seen.has(r.conversation_id))throw Error('Пустой или повторяющийся conversation_id.');
    seen.add(r.conversation_id);
    if(!Array.isArray(r.transcript)||!r.transcript.length||r.transcript.some(t=>typeof t.text!=='string'))throw Error(r.conversation_id+': некорректный транскрипт.');
  }
  return records;
}
export function checkSplit(records,split){
  const expected=split==='dev'?65:split==='prod'?10:null;
  if(expected===null)throw Error('Укажите split dev или prod.');
  if(records.length!==expected)throw Error(`${split}: нужно ${expected} диалогов, получено ${records.length}.`);
  if(split==='dev'&&(records.filter(r=>r.channel==='agent chat').length!==60||records.filter(r=>r.channel==='voice call').length!==5))throw Error('DEV должен содержать 60 чатов и 5 звонков.');
}
export function calculate(criteria){
  let available=0,earned=0;
  for(const r of rules){const c=criteria.find(c=>c.criterion_id===r.id);if(!c||!r.values.some(v=>v===c.value))throw Error('Недопустимое значение '+r.id);if(!r.weight||c.value===null)continue;available+=r.weight;earned+=r.weight*(r.max?c.value/r.max:c.value===true?1:0);}
  if(!available)throw Error('Нет применимых критериев с весом.');
  return {final_score:Math.round(earned/available*10000)/100,critical_flag:criteria.find(c=>c.criterion_id==='critical').value};
}
export function failure(id,error){return {conversation_id:id,status:'error',criteria:[],score:null,error:String(error).slice(0,1500)};}
export function resultFrom(record,evaluations){
  const turnIndex=new Map(record.transcript.map((t,i)=>[String(t.id??`t${i+1}`),i+1]));
  const criteria=rules.map(r=>{
    const e=evaluations[r.internal];if(!e)throw Error('Нет оценки '+r.internal);
    const decisions=(e.appeals??[]).filter(a=>a.decision);const decision=decisions.at(-1)?.decision;
    const raw=decision?.value??e.value;
    const value=raw==='yes'?true:raw==='no'?false:raw==='na'?null:raw;
    if(!r.values.some(v=>v===value))throw Error('Недопустимая оценка '+r.id);
    const rationale=decision?.reason??e.reason;
    if(typeof rationale!=='string'||!rationale.trim())throw Error('Нет обоснования '+r.id);
    const evidence_turns=[...new Set((e.evidence??[]).map(id=>turnIndex.get(String(id))))];
    if(!evidence_turns.length||evidence_turns.some(n=>!Number.isInteger(n)))throw Error('Нет корректных ссылок на исходные реплики: '+r.id);
    return {criterion_id:r.id,value,rationale:rationale.trim(),evidence_turns:evidence_turns.sort((a,b)=>a-b)};
  });
  return {conversation_id:record.conversation_id,status:'ok',criteria,score:calculate(criteria)};
}
export function documentFor(config,results){return {schema_version:'1.0',team_name:config.team_name,model:config.model,results};}
function exactKeys(value,keys,context){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error(context+': неверный набор полей.');}
export function validate(doc,{split,records}={}){
  exactKeys(doc,['schema_version','team_name','model','results'],'Документ');
  if(doc.schema_version!=='1.0'||typeof doc.team_name!=='string'||!doc.team_name.trim()||doc.team_name==='Название команды')throw Error('Проверьте версию схемы и название команды.');
  exactKeys(doc.model,['mode','name'],'Модель');
  if(!['local','external_api','hybrid'].includes(doc.model.mode)||typeof doc.model.name!=='string'||!doc.model.name.trim())throw Error('Неверное описание модели.');
  if(!Array.isArray(doc.results))throw Error('results должен быть массивом.');
  const expected=split==='dev'?65:split==='prod'?10:undefined;
  if(expected!==undefined&&doc.results.length!==expected)throw Error(`${split}: нужно ${expected} записей, получено ${doc.results.length}.`);
  const seen=new Set(),source=records?new Map(records.map(r=>[r.conversation_id,r])):null;
  for(const item of doc.results){
    if(typeof item.conversation_id!=='string'||!item.conversation_id.trim()||seen.has(item.conversation_id))throw Error('Пустой или повторяющийся ID.');seen.add(item.conversation_id);
    if(source&&!source.has(item.conversation_id))throw Error('ID отсутствует в исходном наборе: '+item.conversation_id);
    if(item.status==='error'){exactKeys(item,['conversation_id','status','criteria','score','error'],'Ошибка');if(!Array.isArray(item.criteria)||item.criteria.length||item.score!==null||typeof item.error!=='string'||!item.error.trim())throw Error(item.conversation_id+': неверная запись ошибки.');continue;}
    exactKeys(item,['conversation_id','status','criteria','score'],'Результат');
    if(item.status!=='ok'||!Array.isArray(item.criteria)||item.criteria.length!==8)throw Error(item.conversation_id+': нужны 8 критериев.');
    const ids=new Set();for(const c of item.criteria){exactKeys(c,['criterion_id','value','rationale','evidence_turns'],'Критерий');const r=rules.find(r=>r.id===c.criterion_id);if(!r||ids.has(r.id)||!r.values.some(v=>v===c.value))throw Error('Неверный/повторяющийся критерий или тип значения.');ids.add(r.id);if(typeof c.rationale!=='string'||!c.rationale.trim())throw Error('Пустое обоснование.');const refs=c.evidence_turns;if(!Array.isArray(refs)||!refs.length||new Set(refs).size!==refs.length||refs.some(n=>!Number.isSafeInteger(n)||n<1||source&&n>source.get(item.conversation_id).transcript.length))throw Error('Неверные номера реплик.');}
    exactKeys(item.score,['final_score','critical_flag'],'Итог');const correct=calculate(item.criteria);
    if(typeof item.score.final_score!=='number'||!Number.isFinite(item.score.final_score)||Math.abs(item.score.final_score-correct.final_score)>0.000001||item.score.critical_flag!==correct.critical_flag)throw Error(item.conversation_id+': итог не соответствует критериям.');
  }
  if(source&&(seen.size!==source.size||[...source.keys()].some(id=>!seen.has(id))))throw Error('Набор ID не совпадает с исходным.');
  return {total:seen.size,ok:doc.results.filter(r=>r.status==='ok').length,errors:doc.results.filter(r=>r.status==='error').length};
}
