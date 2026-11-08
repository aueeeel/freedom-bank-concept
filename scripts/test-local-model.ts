import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initialChecklist} from '../src/qa-model';
const require = createRequire(import.meta.url);
const model = require('../cqa-local-model.cjs');

const transcript = [
  {id: 'a-1', timestamp: '00:00', speaker: 'client', text: 'Не пришли деньги'},
  {id: 'b-2', timestamp: '00:30', speaker: 'operator', text: 'Здравствуйте, меня зовут Алия'},
];
const request = model.buildRequest({conversation: {transcript, channel: 'agent chat', language: 'RU'}, checklist: initialChecklist});
assert.equal(request.messages[0].content.startsWith('Ты — эксперт по контролю качества'), true);
assert.ok(request.messages[0].content.includes('Оцени все критерии: contact, needs, identity, consultation, empathy, management, closing, gross.'));
assert.deepEqual(JSON.parse(request.messages[1].content).conversation.transcript.map((t: any) => t.id), ['t1', 't2']);

// Ответ модели: числа строкой, лишние ссылки на реплики отбрасываются, id возвращаются в формат страницы.
const answer = {evaluations: Object.fromEntries(initialChecklist.map(c => [c.id, {value: c.type === 'scale' ? String(Math.max(...c.scale)) : 'yes', reason: 'ok [00:30]', evidence: ['t2', 't99']}]))};
answer.evaluations.gross.value = 'no';
const parsed = model.parseAnswer('```json\n' + JSON.stringify(answer) + '\n```', request);
assert.equal(parsed.evaluations.consultation.value, 20);
assert.deepEqual(parsed.evaluations.contact.evidence, ['b-2']);
assert.throws(() => model.parseAnswer('не JSON', request), /не в формате JSON/);
const bad = structuredClone(answer); bad.evaluations.management.value = 'na';
assert.throws(() => model.parseAnswer(JSON.stringify(bad), request), /недопустимое значение/);

// Полный цикл с подменённой моделью.
const fake = async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(answer)}}]}));
const result = await model.analyze({conversation: {transcript}, checklist: initialChecklist}, {fetchImpl: fake});
assert.equal(result.evaluations.closing.value, 'yes');
await assert.rejects(model.analyze({conversation: {transcript}, checklist: initialChecklist}, {fetchImpl: async () => { throw new Error('down'); }}), /не запущена/);
console.log('Local model checks passed: training prompt, turn id mapping, numeric strings, invalid answers, offline model.');
