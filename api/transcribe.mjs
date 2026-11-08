// Распознавание аудио звонка: оператор и клиент отдельно, с таймингами.
// 1) Браузер загружает файл напрямую в закрытый Vercel Blob (запрос к функции ограничен 4,5 МБ).
// 2) POST {pathname}: функция берёт файл, отправляет в OpenAI, удаляет файл и возвращает транскрипт.
// Доступно только проверяющим (cqa_managers). Ключ OpenAI хранится только в переменной окружения.
import {get, del} from '@vercel/blob';
import {handleUpload} from '@vercel/blob/client';
import {TranscribeError, transcribeAudio, segmentsToTranscript, transcribeLimits} from '../lib/transcribe-engine.mjs';

export const config = {maxDuration: 300};

const publicAuth = {url: 'https://znnlztgbhnblqmjxqozp.supabase.co', key: 'sb_publishable_GwHq4wfBacJKdePB7EYctg_e2H7ekrF'};
const key = () => process.env.OPENAI_API_KEY || process.env.COACH_OPENAI_API_KEY || '';
const reply = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
const PREFIX = 'cqa-audio/';

async function requireManager(authorization) {
  if (!/^Bearer \S+$/.test(authorization ?? '')) throw new TranscribeError(401, 'Войдите в аккаунт проверяющего.');
  const headers = {apikey: publicAuth.key, Authorization: authorization};
  const user = await fetch(publicAuth.url + '/auth/v1/user', {headers, signal: AbortSignal.timeout(10000)});
  if (!user.ok) throw new TranscribeError(401, 'Сессия истекла. Войдите снова.');
  const {id} = await user.json();
  const rows = await fetch(publicAuth.url + '/rest/v1/cqa_managers?select=user_id&user_id=eq.' + encodeURIComponent(id), {headers, signal: AbortSignal.timeout(10000)});
  if (!rows.ok || !(await rows.json()).length) throw new TranscribeError(403, 'Распознавание доступно только проверяющим.');
  return id;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET') return reply({enabled: !!key() && !!process.env.BLOB_READ_WRITE_TOKEN, maxBytes: transcribeLimits.maxBytes});
      if (request.method !== 'POST') throw new TranscribeError(405, 'Метод не поддерживается.');
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new TranscribeError(403, 'Разрешён только запрос с домена сайта.');
      if (!key() || !process.env.BLOB_READ_WRITE_TOKEN) throw new TranscribeError(503, 'Распознавание речи не настроено: добавьте OPENAI_API_KEY в настройках Vercel.');

      // Шаг 1: выдача одноразового разрешения на загрузку файла в закрытое хранилище.
      if (url.searchParams.get('action') === 'upload') {
        if (Number(request.headers.get('content-length') ?? 0) > 4000) throw new TranscribeError(413, 'Слишком большой запрос.');
        const body = await request.json();
        if (body?.type !== 'blob.generate-client-token') throw new TranscribeError(400, 'Неверный запрос загрузки.');
        const result = await handleUpload({
          request, body,
          onBeforeGenerateToken: async pathname => {
            await requireManager(request.headers.get('authorization'));
            if (!pathname.startsWith(PREFIX)) throw new TranscribeError(400, 'Неверное имя файла.');
            return {allowedContentTypes: ['audio/*', 'video/mp4', 'video/webm', 'application/octet-stream'], maximumSizeInBytes: transcribeLimits.maxBytes, addRandomSuffix: true, validUntil: Date.now() + 10 * 60 * 1000};
          },
        });
        return reply(result);
      }

      // Шаг 2: распознавание загруженного файла.
      await requireManager(request.headers.get('authorization'));
      if (Number(request.headers.get('content-length') ?? 0) > 4000) throw new TranscribeError(413, 'Слишком большой запрос.');
      const {pathname, filename} = await request.json();
      if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX) || pathname.includes('..')) throw new TranscribeError(400, 'Неверная ссылка на файл.');
      let bytes;
      try {
        const blob = await get(pathname, {access: 'private', useCache: false});
        if (blob?.statusCode !== 200) throw new TranscribeError(404, 'Загруженный файл не найден. Прикрепите аудио снова.');
        bytes = await new Response(blob.stream).arrayBuffer();
      } finally {
        // Запись разговора не хранится дольше, чем нужно для распознавания.
        await del(pathname).catch(() => {});
      }
      const result = await transcribeAudio({bytes, filename: typeof filename === 'string' ? filename.slice(0, 200) : '', key: key(), signal: AbortSignal.timeout(280000)});
      if (!result.segments.length) throw new TranscribeError(422, 'В записи не найдено речи.');
      return reply({...segmentsToTranscript(result.segments), duration: result.duration});
    } catch (error) {
      const known = error instanceof TranscribeError;
      if (!known) console.error('transcribe', error?.name, error?.message);
      return reply({error: known ? error.message : 'Распознавание временно недоступно.'}, known ? error.status : error?.name === 'TimeoutError' ? 504 : 500);
    }
  },
};
