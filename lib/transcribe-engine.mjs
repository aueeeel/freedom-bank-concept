// Распознавание речи звонка с разделением на говорящих (OpenAI gpt-4o-transcribe-diarize)
// и определением, кто из говорящих оператор, а кто клиент.
// Используется и сервером Vercel (api/transcribe.mjs), и локальным server.cjs.

export class TranscribeError extends Error {constructor(status, message) {super(message); this.status = status;}}

export const transcribeLimits = {maxBytes: 25 * 1024 * 1024};
export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe-diarize';

const AUDIO_EXT = /\.(mp3|mp4|m4a|mpeg|mpga|wav|webm|ogg|oga|flac)$/i;

/** Отправляет аудио в OpenAI и возвращает сегменты [{speaker,start,end,text}]. */
export async function transcribeAudio({bytes, filename, key, fetchImpl = globalThis.fetch, signal}) {
  if (!key) throw new TranscribeError(503, 'Распознавание речи не настроено: на сервере нет ключа OpenAI.');
  if (!bytes?.byteLength) throw new TranscribeError(400, 'Аудиофайл пустой.');
  if (bytes.byteLength > transcribeLimits.maxBytes) throw new TranscribeError(413, 'Аудиофайл больше 25 МБ. Сожмите его в MP3 (моно, 32–64 кбит/с) или разделите на части.');
  const name = AUDIO_EXT.test(filename ?? '') ? filename : 'call.mp3';
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  form.set('model', TRANSCRIBE_MODEL);
  form.set('response_format', 'diarized_json');
  form.set('chunking_strategy', 'auto');
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: form, signal});
  if (!response.ok) {
    let detail = '';
    try {detail = (await response.json())?.error?.message ?? '';} catch {/* ответ без JSON */}
    if (response.status === 401) throw new TranscribeError(503, 'Ключ OpenAI не принят. Проверьте OPENAI_API_KEY.');
    if (response.status === 429) throw new TranscribeError(503, 'Достигнут лимит или закончился баланс OpenAI.');
    if (response.status === 400) throw new TranscribeError(400, 'OpenAI не смог обработать файл' + (detail ? ': ' + detail.slice(0, 200) : '.'));
    throw new TranscribeError(502, `Сервис распознавания ответил ошибкой (${response.status}).`);
  }
  const data = await response.json();
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  return {
    duration: Number(data?.duration) || null,
    segments: segments
      .filter(s => typeof s?.text === 'string' && s.text.trim())
      .map(s => ({speaker: String(s.speaker ?? '?'), start: Number(s.start) || 0, end: Number(s.end) || Number(s.start) || 0, text: s.text.trim()})),
  };
}

/** Секунды → «MM:SS» или «H:MM:SS». */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

// Фразы, по которым оператора можно узнать уверенно (RU / KZ / EN).
const OPERATOR_CUES = [
  /freedom\s*(broker|bank|finance)?/i, /служб[аы]\s+(поддержки|заботы)/i, /меня зовут/i, /(слушаю вас|чем могу помочь|могу ещё чем[- ]то помочь)/i,
  /менің атым/i, /қолдау қызметі/i, /қалай көмектесе аламын/i,
  /my name is/i, /this is \w+ (speaking|from)/i, /how (can|may) i help/i, /support (team|desk)/i,
  /(пройдите|назовите).{0,30}(идентификац|кодовое слово|дату рождения)/i, /кодтық сөз(ді)? (жазыңыз|айтыңыз)/i, /verify your identity/i,
];
const CLIENT_CUES = [
  /(у меня|мой|моя|мои) (счёт|счет|карта|деньги|заявка)/i, /(не приходят|не пришли|не могу (вывести|войти|купить))/i,
  /(менің|маған) /i, /(my account|i can'?t|i want to|i need to)/i,
  /кодовое слово\s*[—-]/i, /кодтық сөз\s*[—-]/i, /code word\s+\w+/i,
];

/** Определяет роли говорящих. Без явных признаков роль остаётся «unknown» — её назначает проверяющий. */
export function assignRoles(segments) {
  const speakers = [...new Set(segments.map(s => s.speaker))];
  const score = Object.fromEntries(speakers.map(id => [id, {operator: 0, client: 0, words: 0, first: Infinity}]));
  segments.forEach((s, i) => {
    const sc = score[s.speaker];
    sc.words += s.text.split(/\s+/).length;
    sc.first = Math.min(sc.first, i);
    for (const re of OPERATOR_CUES) if (re.test(s.text)) sc.operator += i < 6 ? 2 : 1;
    for (const re of CLIENT_CUES) if (re.test(s.text)) sc.client += 1;
  });
  const roles = Object.fromEntries(speakers.map(id => [id, 'unknown']));
  if (!speakers.length) return {roles, confident: false};
  const ranked = [...speakers].sort((a, b) => (score[b].operator - score[b].client) - (score[a].operator - score[a].client));
  const best = ranked[0], margin = (score[best].operator - score[best].client) - (ranked[1] ? score[ranked[1]].operator - score[ranked[1]].client : 0);
  const confident = score[best].operator >= 2 && margin >= 2;
  if (confident) {
    roles[best] = 'operator';
    // Остальные голоса — клиенты, если их один; при нескольких оставляем решение человеку.
    const others = speakers.filter(id => id !== best);
    if (others.length === 1) roles[others[0]] = 'client';
  }
  return {roles, confident};
}

/** Сегменты → реплики сайта: подряд идущие фразы одного говорящего склеиваются. */
export function segmentsToTranscript(segments) {
  const {roles, confident} = assignRoles(segments);
  const turns = [];
  for (const s of segments) {
    const last = turns[turns.length - 1];
    if (last && last._speaker === s.speaker && s.start - last._end < 1.5) {last.text += ' ' + s.text; last._end = s.end; continue;}
    turns.push({_speaker: s.speaker, _start: s.start, _end: s.end, text: s.text});
  }
  const labels = Object.fromEntries([...new Set(segments.map(s => s.speaker))].map((id, i) => [id, `Голос ${String.fromCharCode(65 + i)}`]));
  return {
    confident,
    speakers: Object.entries(roles).map(([id, role]) => ({id: labels[id], role})),
    transcript: turns.map(t => ({timestamp: clock(t._start), end: clock(t._end), start_seconds: Math.round(t._start * 10) / 10, end_seconds: Math.round(t._end * 10) / 10, speaker: roles[t._speaker], voice: labels[t._speaker], text: t.text})),
  };
}
