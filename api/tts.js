import { requireUser } from './_lib/auth.js';
import { allowMethods, logServerError, rpcErrorCode, sendError, sendJson } from './_lib/errors.js';
import { getServiceClient } from './_lib/supabase.js';
import { MAX_TTS_BODY_BYTES, isBodyTooLarge, readParsedBody, validateTtsRequest } from './_lib/validate.js';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const TTS_TIMEOUT_MS = 15000;

/** The single place that decides which Google voice is used. */
const VOICES = {
  th: {
    languageCode: 'th-TH',
    female: 'th-TH-Chirp3-HD-Kore',
    male: 'th-TH-Chirp3-HD-Charon',
  },
  en: {
    languageCode: 'en-US',
    female: 'en-US-Chirp3-HD-Kore',
    male: 'en-US-Chirp3-HD-Charon',
  },
};

async function synthesize({ text, lang, gender }) {
  const voice = VOICES[lang];
  const url = `${GOOGLE_TTS_URL}?key=${encodeURIComponent(process.env.GOOGLE_TTS_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice[gender] },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error('google tts failed'), { code: `google_tts_${response.status}` });
  }
  const data = await response.json();
  if (!data.audioContent) throw Object.assign(new Error('google tts empty'), { code: 'google_tts_empty' });
  return data.audioContent;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  if (isBodyTooLarge(req.headers, MAX_TTS_BODY_BYTES)) {
    sendError(res, 413, 'payload_too_large');
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;

  const checked = validateTtsRequest(readParsedBody(req));
  if (!checked.ok) {
    sendError(res, 400, 'invalid_input', checked.message);
    return;
  }
  const request = checked.value;

  try {
    const { error } = await getServiceClient().rpc('consume_tts_call', {
      p_ticket: request.ticketId,
      p_user: user.id,
    });
    if (error) {
      if (rpcErrorCode(error) === 'ticket_invalid') {
        sendError(res, 403, 'ticket_invalid');
        return;
      }
      throw Object.assign(new Error('consume tts failed'), { code: 'consume_tts' });
    }
  } catch (err) {
    logServerError('tts.ticket', err);
    sendError(res, 500, 'server_error');
    return;
  }

  if (!process.env.GOOGLE_TTS_API_KEY) {
    logServerError('tts', { code: 'env_missing' });
    sendError(res, 502, 'tts_failed');
    return;
  }

  try {
    const audioBase64 = await synthesize(request);
    sendJson(res, 200, { audioBase64, mime: 'audio/mpeg' });
  } catch (err) {
    logServerError('tts.google', err);
    sendError(res, 502, 'tts_failed');
  }
}
