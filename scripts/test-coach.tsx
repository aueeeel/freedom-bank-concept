import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {findWeaknesses,scenarioFor,basicTopics,type CoachReview} from '../src/coach-model';
import {validateCoachReply,requestCoach} from '../src/coach-service';
import {CoachWorkspace} from '../src/coach-app';
import {demoConversation,initialChecklist,score} from '../src/qa-model';
const seed=demoConversation();
function review(id:string):CoachReview{const evaluations=structuredClone(seed.evaluations);evaluations.empathy.value='no';evaluations.contact.value='no';return{id,employee_id:'own',name:'Разговор '+id,created_at:'2026-11-08T10:00:00Z',review_source:'ai',score:score(initialChecklist,evaluations).total,checklist:structuredClone(initialChecklist),evaluations};}
const first=review('first');const second=review('second');second.evaluations.contact.appeals=[{id:'appeal',comment:'Встречное доказательство',createdAt:'2026-11-08',decision:{value:'yes',reason:'Приветствие подтверждено',at:'2026-11-08'}}];
const foreign={...review('foreign'),employee_id:'other'};const demo={...review('demo'),review_source:'demo'};const unfinished=review('unfinished');unfinished.evaluations.contact.value=null;const notScored={...review('null'),score:null};
const focus=findWeaknesses([first,first,second,foreign,demo,unfinished,notScored],'own');
assert.equal(focus[0].id,'empathy');assert.equal(focus.find(f=>f.id==='empathy')?.misses,2);assert.equal(focus.find(f=>f.id==='contact')?.misses,1);assert.equal(focus.find(f=>f.id==='contact')?.samples,2);assert.ok(!focus.some(f=>f.id==='needs'||f.id==='identity'||f.id==='gross'));
assert.ok(focus.flatMap(f=>f.examples).every(e=>['first','second'].includes(e.id)));assert.deepEqual(findWeaknesses([foreign,demo,unfinished,notScored],'own'),[]);
const changed=review('changed');changed.checklist[0].definition='Совсем другой критерий';assert.equal(findWeaknesses([first,changed],'own').find(f=>f.id==='contact')?.samples,1);
const corrected=review('corrected');for(const c of corrected.checklist){const e=corrected.evaluations[c.id];e.appeals=[{id:'fixed-'+c.id,createdAt:'now',comment:'Пересмотр',decision:{value:c.type==='flag'?'no':c.type==='scale'?Math.max(...c.scale):'yes',reason:'Исправлено',at:'now'}}];}assert.deepEqual(findWeaknesses([corrected],'own'),[]);
const gross=review('gross');gross.evaluations.gross.value='yes';assert.equal(findWeaknesses([gross],'own')[0].id,'gross');
const zero=review('zero');zero.evaluations.consultation.value=0;assert.ok(findWeaknesses([zero],'own').find(f=>f.id==='consultation'));
for(const topic of basicTopics){const scenario=scenarioFor(topic.id);assert.ok(scenario.steps.length>=2);for(const step of scenario.steps){assert.ok(step.customer&&step.example&&step.checks.length);}}
assert.equal(scenarioFor('custom-criterion').id,'general');
assert.deepEqual(validateCoachReply({customer:'Следующий вопрос',feedback:'Обратная связь',complete:false}),{customer:'Следующий вопрос',feedback:'Обратная связь',complete:false});assert.throws(()=>validateCoachReply({customer:'',feedback:'',complete:false}));assert.throws(()=>validateCoachReply({customer:'',feedback:'x',complete:'false'}));assert.throws(()=>validateCoachReply({customer:'x'.repeat(4001),feedback:'x',complete:false}));
const html=renderToStaticMarkup(<CoachWorkspace person={{id:'own',name:'Сотрудник',aliases:[],user_id:'user'}} focuses={focus}/>);assert.ok(html.includes('Учебная практика · без ИИ'));assert.ok(html.includes('empathy')===false);assert.ok(html.includes('Эмпатия'));assert.ok(!html.includes('foreign'));assert.ok(html.includes('ИИ подключим позже'));assert.ok(html.includes('Открыть разбор'));assert.ok(html.includes('coach-answer'));
const empty=renderToStaticMarkup(<CoachWorkspace focuses={[]}/>);assert.ok(empty.includes('Персональные темы появятся'));assert.ok(!empty.includes('Почему эта тема'));
(globalThis as any).window={FREEDOM_COACH_CONFIG:{endpoint:''}};await assert.rejects(requestCoach('own','empathy',[],new AbortController().signal),/не подключён/);
(globalThis as any).location={origin:'https://example.test'};(globalThis as any).window.FREEDOM_COACH_CONFIG.endpoint='https://other.test/coach';await assert.rejects(requestCoach('own','empathy',[],new AbortController().signal),/домене сайта/);
console.log('AI Coach: personal weaknesses, appeal decisions, ownership, scenarios, UI and adapter validation passed.');
