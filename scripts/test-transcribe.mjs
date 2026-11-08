// Проверки распознавания аудио: роли голосов, склейка реплик, ошибки провайдера, маршрут Vercel.
import assert from 'node:assert/strict';
import {assignRoles, segmentsToTranscript, transcribeAudio, clock, TranscribeError} from '../lib/transcribe-engine.mjs';

assert.equal(clock(5), '00:05'); assert.equal(clock(125.9), '02:05'); assert.equal(clock(3725), '1:02:05');

// RU: оператор узнаётся по представлению, второй голос — клиент.
const ru = segmentsToTranscript([
  {speaker: 'A', start: 0, end: 3, text: 'Freedom Broker, добрый день, меня зовут Дана. Чем могу помочь?'},
  {speaker: 'B', start: 3.2, end: 8, text: 'Здравствуйте, у меня деньги не пришли на счёт.'},
  {speaker: 'B', start: 8.4, end: 10, text: 'Вчера пополнял.'},
  {speaker: 'A', start: 9.5, end: 12, text: 'Назовите, пожалуйста, ФИО, дату рождения и кодовое слово.'},
]);
assert.equal(ru.confident, true);
assert.deepEqual(ru.speakers, [{id: 'Голос A', role: 'operator'}, {id: 'Голос B', role: 'client'}]);
assert.equal(ru.transcript.length, 3, 'подряд идущие фразы одного голоса склеиваются');
assert.equal(ru.transcript[1].text, 'Здравствуйте, у меня деньги не пришли на счёт. Вчера пополнял.');
assert.equal(ru.transcript[1].start_seconds, 3.2); assert.equal(ru.transcript[1].end_seconds, 10);

// KZ и EN.
assert.equal(assignRoles([{speaker: '1', start: 0, end: 2, text: 'Сәлеметсіз бе'}, {speaker: '2', start: 2, end: 5, text: 'Сәлеметсіз бе! Менің атым Ерлан, Freedom Broker қолдау қызметі.'}]).roles['2'], 'operator');
assert.equal(assignRoles([{speaker: 'x', start: 0, end: 2, text: 'Hi, this is Marat speaking from Freedom Broker, how can I help you?'}, {speaker: 'y', start: 2, end: 4, text: 'I want to buy bonds'}]).roles.y, 'client');

// Без признаков роли не назначаются: решает проверяющий.
const unsure = segmentsToTranscript([{speaker: 'A', start: 0, end: 2, text: 'Алло'}, {speaker: 'B', start: 2, end: 4, text: 'Да, слушаю'}]);
assert.equal(unsure.confident, false); assert.ok(unsure.transcript.every(t => t.speaker === 'unknown'));

// Клиент, назвавший компанию, не становится оператором.
assert.equal(assignRoles([
  {speaker: 'A', start: 0, end: 3, text: 'Добрый день, служба поддержки Freedom Broker, меня зовут Асель.'},
  {speaker: 'B', start: 3, end: 6, text: 'Я клиент Freedom Broker, у меня не приходят деньги, кодовое слово — Медео.'},
]).roles.A, 'operator');

// Запрос к OpenAI: правильные поля, ключ только в заголовке, ошибки переводятся на русский.
let sent;
const fake = async (url, init) => {sent = {url, init}; return Response.json({duration: 12, segments: [{speaker: 'A', start: 0, end: 2, text: ' Привет '}, {speaker: 'B', start: 2, end: 3, text: '   '}]});};
const out = await transcribeAudio({bytes: new Uint8Array([1, 2, 3]), filename: 'call.mp3', key: 'sk-test', fetchImpl: fake});
assert.equal(sent.url, 'https://api.openai.com/v1/audio/transcriptions');
assert.equal(sent.init.headers.Authorization, 'Bearer sk-test');
assert.equal(sent.init.body.get('model'), 'gpt-4o-transcribe-diarize');
assert.equal(sent.init.body.get('response_format'), 'diarized_json');
assert.equal(sent.init.body.get('chunking_strategy'), 'auto');
assert.deepEqual(out.segments, [{speaker: 'A', start: 0, end: 2, text: 'Привет'}]);
await assert.rejects(transcribeAudio({bytes: new Uint8Array([1]), filename: 'a.mp3', key: ''}), e => e instanceof TranscribeError && e.status === 503);
await assert.rejects(transcribeAudio({bytes: new Uint8Array(26 * 1024 * 1024), filename: 'a.mp3', key: 'k', fetchImpl: fake}), e => e.status === 413);
await assert.rejects(transcribeAudio({bytes: new Uint8Array([1]), filename: 'a.mp3', key: 'k', fetchImpl: async () => new Response('{}', {status: 401})}), e => /Ключ OpenAI не принят/.test(e.message));
await assert.rejects(transcribeAudio({bytes: new Uint8Array([1]), filename: 'a.mp3', key: 'k', fetchImpl: async () => new Response('{}', {status: 429})}), e => /лимит/.test(e.message));

// Маршрут Vercel: без ключа и вход только проверяющего.
const {default: route} = await import('../api/transcribe.mjs');
delete process.env.OPENAI_API_KEY; delete process.env.COACH_OPENAI_API_KEY;
const health = await (await route.fetch(new Request('https://site.test/api/transcribe'))).json();
assert.equal(health.enabled, false);
const off = await route.fetch(new Request('https://site.test/api/transcribe', {method: 'POST', body: '{}'}));
assert.equal(off.status, 503);
process.env.OPENAI_API_KEY = 'sk-test'; process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_x';
const anon = await route.fetch(new Request('https://site.test/api/transcribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pathname: 'cqa-audio/a.mp3'})}));
assert.equal(anon.status, 401);
const cross = await route.fetch(new Request('https://site.test/api/transcribe', {method: 'POST', headers: {origin: 'https://evil.test'}, body: '{}'}));
assert.equal(cross.status, 403);
delete process.env.OPENAI_API_KEY; delete process.env.BLOB_READ_WRITE_TOKEN;

console.log('Transcription checks passed: RU/KZ/EN operator detection, unsure voices left to reviewer, merging, OpenAI request and errors, route auth and origin.');
