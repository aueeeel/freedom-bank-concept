import assert from 'node:assert/strict';
import {rules,calculate,resultFrom,documentFor,validate,failure,recordsFrom,checkSplit} from './lib.mjs';
const config={team_name:'Тест',model:{mode:'local',name:'Test model'}};
const record={conversation_id:'original-id',transcript:Array.from({length:8},(_,i)=>({id:`t${i+1}`,speaker:i===3?'operator':'client',text:'Тест'}))};
const values=['yes','na','na',15,'yes',7,'yes','no'];
const evaluations=Object.fromEntries(rules.map((r,i)=>[r.internal,{value:values[i],reason:'Обоснование',evidence:['t4']}]));
const result=resultFrom(record,evaluations);assert.equal(result.score.final_score,85.38);assert.equal(result.score.critical_flag,false);assert.deepEqual(result.criteria[0].evidence_turns,[4]);
const doc=documentFor(config,[result]);assert.deepEqual(validate(doc,{records:[record]}),{total:1,ok:1,errors:0});
const critical=structuredClone(result.criteria);critical.find(c=>c.criterion_id==='critical').value=true;assert.equal(calculate(critical).final_score,85.38);assert.equal(calculate(critical).critical_flag,true);
for(const change of [d=>d.results.push(d.results[0]),d=>d.results[0].criteria[0].value=1,d=>d.results[0].criteria[0].value=null,d=>d.results[0].criteria[0].evidence_turns=[9],d=>d.results[0].criteria[0].evidence_turns=[0],d=>d.results[0].criteria[0].evidence_turns=[],d=>d.results[0].criteria[1].criterion_id='contact',d=>d.results[0].score.final_score=0,d=>d.results[0].score.critical_flag=true,d=>d.results[0].criteria[0].rationale='']){const bad=structuredClone(doc);change(bad);assert.throws(()=>validate(bad,{records:[record]}));}
assert.throws(()=>validate(doc,{split:'prod'}));assert.throws(()=>validate(doc,{records:[{...record,conversation_id:'other'}]}));assert.throws(()=>recordsFrom({records:[record,record]}));assert.throws(()=>checkSplit([record],'dev'));
const errors=documentFor(config,[failure(record.conversation_id,'Модель недоступна')]);assert.equal(validate(errors,{records:[record]}).errors,1);errors.results[0].score={final_score:0,critical_flag:false};assert.throws(()=>validate(errors));
console.log('Submission: original turn indices, official weights, N/A, independent critical flag, ID coverage, types, evidence and error records passed.');
