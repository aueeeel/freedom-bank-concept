import assert from 'node:assert/strict';
import {initialChecklist,blankEvaluation,demoConversation,score,finalValue,validateChecklist,validRating} from '../src/qa-model';
import {normalizeRecords,parseText,readConversationFile,audioTime,mergeConversations} from '../src/qa-files';
import {uploadedConversations,fileRows,analyseFile} from '../src/qa-file-batch';

const demo=demoConversation();assert.equal(score(initialChecklist,demo.evaluations).total,85.38);
const batchTen=normalizeRecords({data:{records:Array.from({length:10},(_,i)=>({conversation_id:`batch-${i+1}`,language:'RU',channel:'agent chat',transcript:[{speaker:'client',timestamp:'00:00',text:`Вопрос ${i+1}`},{speaker:'operator',timestamp:'00:01',text:`Ответ ${i+1}`}]}))}});
assert.equal(batchTen.length,10);
assert.equal(fileRows(batchTen,initialChecklist).length,10);
assert.equal(fileRows(batchTen,initialChecklist)[9].name,'batch-10');
assert.equal(uploadedConversations([demo,...batchTen],batchTen.map(c=>c.id)).length,10);
const batchCalls:string[]=[],batchResults:string[]=[];
const batchOutcome=await analyseFile(batchTen,new AbortController().signal,async c=>{batchCalls.push(c.sourceId!);if(c.sourceId==='batch-4')throw Error('TEST ONLY: unavailable');return demo.evaluations;},c=>batchResults.push(c.sourceId!),()=>{});
assert.equal(batchCalls.length,10);assert.equal(batchResults.length,9);assert.equal(batchResults[8],'batch-10');assert.equal(batchOutcome.errors[0].name,'batch-4');
const batchStop=new AbortController();let stoppedCalls=0;
const stoppedOutcome=await analyseFile(batchTen,batchStop.signal,async()=>{stoppedCalls++;return demo.evaluations;},()=>{if(stoppedCalls===3)batchStop.abort();},()=>{});
assert.equal(stoppedCalls,3);assert.equal(stoppedOutcome.cancelled,true);
const full=Object.fromEntries(initialChecklist.map(c=>[c.id,{...blankEvaluation(),value:c.type==='scale'?Math.max(...c.scale):c.type==='flag'?'no':'yes'}]));
assert.equal(score(initialChecklist,full).total,100);
full.management.value=0;assert.equal(score(initialChecklist,full).total,85); // 10-point scale is weighted at 15.
full.gross.value='yes';assert.equal(score(initialChecklist,full).total,85);assert.equal(score(initialChecklist,full).gross,true);
assert.equal(score(initialChecklist,{}).total,null);
assert.equal(score([{...initialChecklist[1],weight:15}],{needs:{...blankEvaluation(),value:'na'}}).total,null);
const appeal={...demo.evaluations.consultation,appeals:[{id:'a',comment:'Проверить',createdAt:'test',decision:{value:20,reason:'Запрос решён',at:'test'}}]};
assert.equal(finalValue(appeal),20);assert.equal(appeal.value,15);assert.ok(score(initialChecklist,{...demo.evaluations,consultation:appeal}).total!>85.38);
assert.throws(()=>validateChecklist([{...initialChecklist[0],weight:-1}]));assert.throws(()=>validateChecklist([{...initialChecklist[3],scale:[0,0]}]));assert.equal(validRating(initialChecklist[0],'na'),false);
const dataset={isSuccess:true,data:{records:[{conversation_id:'test-ru',language:'RU',transcript:[{timestamp:'00:02',speaker:'operator',text:'Здравствуйте!'},{timestamp:'2026-11-07T10:00:02+05:00',speaker:'client',text:'Спасибо'}]}]}};
const parsed=normalizeRecords(dataset);assert.equal(parsed[0].sourceId,'test-ru');assert.equal(parsed[0].transcript[1].timestamp,'2026-11-07T10:00:02+05:00');
assert.equal(normalizeRecords({transcript:[{text:'unknown',speaker:'not-an-operator'}]})[0].transcript[0].speaker,'unknown');
assert.throws(()=>normalizeRecords({isSuccess:false,error:'Bad group'}));assert.throws(()=>normalizeRecords({transcript:'not an array'}));
const txt=parseText('[00:01] Оператор: Здравствуйте!\n[00:03] Клиент: Сәлеметсіз бе!');assert.equal(txt.length,2);assert.equal(txt[1].speaker,'client');
const sub=parseText('1\n00:00:02,200 --> 00:00:04,500\nOperator: Hello\n\n2\n00:00:05,000 --> 00:00:06,000\nClient: Thanks');assert.equal(sub[0].timestamp,'00:00:02.200');assert.equal(sub[1].speaker,'client');
const iso=normalizeRecords({transcript:[{timestamp:'2026-11-07T10:00:00+05:00',speaker:'operator',text:'A'},{timestamp:'2026-11-07T10:00:08+05:00',speaker:'client',text:'B'}]})[0].transcript;assert.equal(audioTime(iso[1],iso),8);
const csv=await readConversationFile(new File(['timestamp,speaker,text\n00:01,operator,"Hello, client"\n00:02,client,"First line\nSecond line"'], 'sample.csv'));
assert.equal(csv[0].transcript[0].text,'Hello, client');assert.equal(csv[0].transcript[1].text,'First line\nSecond line');
{const split=normalizeRecords({records:[{conversation_id:'one',transcript:[{timestamp:'00:00',speaker:'bot',text:'Я бот'},{timestamp:'00:10',speaker:'client',text:'Оператора'}]},{conversation_id:'one',transcript:[{timestamp:'00:30',speaker:'operator',text:'Здравствуйте, я Алия'}]},{conversation_id:'two',transcript:[{speaker:'client',text:'Другой чат'}]}]});assert.equal(split.length,2);assert.deepEqual(split[0].transcript.map(t=>t.speaker),['bot','client','operator']);
const [bot]=normalizeRecords({transcript:[{timestamp:'00:00',speaker:'bot',text:'a'},{timestamp:'01:00',speaker:'bot',text:'c'}]}),[op]=normalizeRecords({transcript:[{timestamp:'00:30',speaker:'operator',text:'b'}]});assert.deepEqual(mergeConversations([bot,op]).transcript.map(t=>t.text),['a','b','c']);}
await assert.rejects(()=>readConversationFile(new File(['{oops'], 'bad.json')));
console.log('CQA checks passed: weighting, N/A, gross flags, appeals, checklist validation, dataset, text, SRT, ISO times, CSV, invalid files, one chat stays one.');
