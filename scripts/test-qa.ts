import assert from 'node:assert/strict';
import {initialChecklist,blankEvaluation,demoConversation,score,finalValue,validateChecklist,validRating} from '../src/qa-model';
import {normalizeRecords,parseText,readConversationFile,audioTime,mergeConversations} from '../src/qa-files';

const demo=demoConversation();assert.equal(score(initialChecklist,demo.evaluations).total,85.38);
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
const handoff={records:[{conversation_id:'phase-bot',channel:'bot chat',transcript:[{timestamp:'00:00',speaker:'bot',text:'Здравствуйте'},{timestamp:'00:01',speaker:'client',text:'Оператора, пожалуйста'}]},{conversation_id:'phase-agent',channel:'agent chat',transcript:[{timestamp:'00:02',speaker:'system',text:'Переключение'},{timestamp:'00:03',speaker:'operator',text:'Здравствуйте, я Лера'}]}]};
const handoffFile=new File([JSON.stringify(handoff)],'whole-chat.json');
const one=await readConversationFile(handoffFile);assert.equal(one.length,1);assert.equal(one[0].channel,'agent chat');assert.equal(one[0].transcript.length,4);assert.deepEqual(one[0].transcript.map(t=>t.speaker),['bot','client','system','operator']);assert.deepEqual(one[0].transcript.map(t=>t.timestamp),['00:00','00:01','00:02','00:03']);
assert.equal((await readConversationFile(handoffFile,'batch')).length,2);
const structuredTxt=await readConversationFile(new File([JSON.stringify(handoff)],'whole-chat.txt'));assert.equal(structuredTxt.length,1);assert.equal(structuredTxt[0].transcript[3].speaker,'operator');
await assert.rejects(()=>readConversationFile(new File([JSON.stringify({records:handoff.records.map((r,i)=>({...r,audio_url:`https://example.com/clip-${i}.mp3`}))})],'audio-set.json')),/Набор диалогов/);
await assert.rejects(()=>readConversationFile(new File(['{oops'], 'bad.json')));
console.log('CQA checks passed: weighting, N/A, gross flags, appeals, checklist validation, dataset, text, SRT, ISO times, CSV, invalid files, one chat stays one.');
