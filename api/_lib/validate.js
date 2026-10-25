export const DURATIONS = [5, 10, 15, 30];
export const RATIOS = ['9:16', '16:9'];
export const GENDERS = ['male', 'female'];
export const AGE_GROUPS = ['child', 'teen', 'adult', 'senior'];
export const VOICE_LANGS = ['th', 'en'];
export const SFX_TYPES = ['pop', 'whoosh', 'ding', 'click', 'none'];
export const CHARACTER_IDS = ['A', 'B'];

export const MAX_PROMPT_CHARS = 500;
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 600 * 1024;
export const MAX_TTS_CHARS = 300;
export const MAX_SCENES = 8;
export const MIN_SCENE_SEC = 1;

/** Speech pacing budget. Starting values; tune after listening to real TTS output. */
export const CHARS_PER_SECOND = { th: 12, en: 15 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const TIME_EPSILON = 1e-6;

export const MAX_STORYBOARD_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_TTS_BODY_BYTES = 8 * 1024;

export function isBodyTooLarge(headers, maxBytes) {
  const length = Number(headers?.['content-length']);
  return Number.isFinite(length) && length > maxBytes;
}

/** Vercel parses JSON lazily and throws on malformed input; treat that as no body. */
export function readParsedBody(req) {
  try {
    return req.body ?? null;
  } catch {
    return null;
  }
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function countChars(text) {
  return Array.from(`${text ?? ''}`).length;
}

export function maxLineChars(sceneSec, lang) {
  const perSecond = CHARS_PER_SECOND[lang] ?? CHARS_PER_SECOND.th;
  return Math.min(MAX_TTS_CHARS, Math.floor(sceneSec * perSecond));
}

function startsWithBytes(bytes, signature, offset = 0) {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function sniffImageType(bytes) {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/** Returns { mediaType, base64 } when the data URL is an allowed image whose bytes match its declared type. */
export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  if (dataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, mediaType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  if (sniffImageType(bytes) !== mediaType) return null;
  return { mediaType, base64 };
}

function fail(message) {
  return { ok: false, message };
}

function validateCharacter(character, index) {
  if (!character || typeof character !== 'object') return `ตัวละครที่ ${index + 1} ไม่ถูกต้อง`;
  if (character.id !== CHARACTER_IDS[index]) return `ตัวละครที่ ${index + 1} ต้องมีรหัส ${CHARACTER_IDS[index]}`;
  if (!GENDERS.includes(character.gender)) return 'กรุณาเลือกเพศของตัวละคร';
  if (!AGE_GROUPS.includes(character.ageGroup)) return 'กรุณาเลือกช่วงอายุของตัวละคร';
  if (!Number.isInteger(character.skinTone) || character.skinTone < 1 || character.skinTone > 6) {
    return 'กรุณาเลือกโทนสีผิวของตัวละคร';
  }
  if (!VOICE_LANGS.includes(character.voiceLang)) return 'กรุณาเลือกภาษาเสียงพากย์';
  return null;
}

export function validateStoryboardRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('ข้อมูลที่ส่งมาไม่ถูกต้อง');

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return fail('กรุณาพิมพ์เรื่องที่จะเล่า');
  if (countChars(prompt) > MAX_PROMPT_CHARS) return fail(`เรื่องที่จะเล่ายาวได้ไม่เกิน ${MAX_PROMPT_CHARS} ตัวอักษร`);

  if (!DURATIONS.includes(body.durationSec)) return fail('ความยาวคลิปต้องเป็น 5, 10, 15 หรือ 30 วินาที');
  if (!RATIOS.includes(body.ratio)) return fail('สัดส่วนต้องเป็น 9:16 หรือ 16:9');

  if (!Array.isArray(body.characters) || body.characters.length < 1 || body.characters.length > 2) {
    return fail('เลือกตัวละครได้ 1 ถึง 2 ตัว');
  }
  for (let i = 0; i < body.characters.length; i += 1) {
    const problem = validateCharacter(body.characters[i], i);
    if (problem) return fail(problem);
  }

  const rawImages = body.images ?? [];
  if (!Array.isArray(rawImages)) return fail('รูปแบบภาพไม่ถูกต้อง');
  if (rawImages.length > MAX_IMAGES) return fail(`แนบภาพได้ไม่เกิน ${MAX_IMAGES} ภาพ`);
  const images = [];
  for (let i = 0; i < rawImages.length; i += 1) {
    const parsed = parseImageDataUrl(rawImages[i]);
    if (!parsed) return fail(`ภาพที่ ${i + 1} ใช้ไม่ได้ รองรับ JPEG, PNG และ WebP ขนาดไม่ใหญ่เกินไป`);
    images.push(parsed);
  }

  return {
    ok: true,
    value: {
      prompt,
      durationSec: body.durationSec,
      ratio: body.ratio,
      characters: body.characters.map(({ id, gender, ageGroup, skinTone, voiceLang }) => ({
        id, gender, ageGroup, skinTone, voiceLang,
      })),
      images,
    },
  };
}

export function validateTtsRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('ข้อมูลที่ส่งมาไม่ถูกต้อง');
  if (!isUuid(body.ticketId)) return fail('ตั๋วเรนเดอร์ไม่ถูกต้อง');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return fail('บทพูดว่างอยู่ กรุณาใส่บทพูด');
  if (countChars(text) > MAX_TTS_CHARS) return fail(`บทพูดยาวได้ไม่เกิน ${MAX_TTS_CHARS} ตัวอักษร`);
  if (!VOICE_LANGS.includes(body.lang)) return fail('ภาษาเสียงพากย์ไม่ถูกต้อง');
  if (!GENDERS.includes(body.gender)) return fail('เพศของเสียงพากย์ไม่ถูกต้อง');
  return { ok: true, value: { ticketId: body.ticketId, text, lang: body.lang, gender: body.gender } };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Checks a storyboard against the requested clip.
 * Returns { valid, errors } where errors are short English codes for logs and model retries.
 */
export function validateScenes(scenes, durationSec, characterIds, imageCount) {
  const errors = [];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { valid: false, errors: ['scenes must be a non-empty array'] };
  }
  if (scenes.length > MAX_SCENES) errors.push(`at most ${MAX_SCENES} scenes`);

  let expectedStart = 0;
  scenes.forEach((scene, i) => {
    const at = `scene ${i}`;
    if (!scene || typeof scene !== 'object') {
      errors.push(`${at}: not an object`);
      return;
    }
    const { startSec, endSec, imageIndex, speakerId, line, lang, sfx } = scene;

    if (!isFiniteNumber(startSec) || !isFiniteNumber(endSec)) {
      errors.push(`${at}: startSec and endSec must be numbers`);
      return;
    }
    if (Math.abs(startSec - expectedStart) > TIME_EPSILON) {
      errors.push(startSec > expectedStart
        ? `${at}: gap before startSec ${startSec} (expected ${expectedStart})`
        : `${at}: overlaps previous scene at ${startSec} (expected ${expectedStart})`);
    }
    if (endSec - startSec < MIN_SCENE_SEC - TIME_EPSILON) {
      errors.push(`${at}: must last at least ${MIN_SCENE_SEC}s`);
    }
    expectedStart = endSec;

    if (!characterIds.includes(speakerId)) errors.push(`${at}: unknown speakerId ${String(speakerId)}`);

    if (imageIndex !== null) {
      if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= imageCount) {
        errors.push(`${at}: imageIndex out of range (0..${imageCount - 1} or null)`);
      }
    }

    if (!SFX_TYPES.includes(sfx)) errors.push(`${at}: sfx must be one of ${SFX_TYPES.join(', ')}`);
    if (!VOICE_LANGS.includes(lang)) errors.push(`${at}: lang must be th or en`);

    if (typeof line !== 'string' || line.trim() === '') {
      errors.push(`${at}: line is empty`);
    } else if (VOICE_LANGS.includes(lang)) {
      const limit = maxLineChars(endSec - startSec, lang);
      if (countChars(line.trim()) > limit) errors.push(`${at}: line too long for scene (max ${limit} chars)`);
    }
  });

  const last = scenes[scenes.length - 1];
  if (last && isFiniteNumber(last.endSec) && Math.abs(last.endSec - durationSec) > TIME_EPSILON) {
    errors.push(`last scene must end at ${durationSec}s (got ${last.endSec})`);
  }

  return { valid: errors.length === 0, errors };
}

/** Parses model output that should be bare JSON; tolerates stray code fences. Returns null when unparseable. */
export function parseModelJson(text) {
  if (typeof text !== 'string') return null;
  let candidate = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(candidate);
  if (fenced) candidate = fenced[1];
  if (!candidate.startsWith('{')) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    candidate = candidate.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps only known scene fields so nothing unexpected from the model reaches the browser. */
export function pickSceneFields(scene) {
  return {
    startSec: scene.startSec,
    endSec: scene.endSec,
    imageIndex: scene.imageIndex,
    speakerId: scene.speakerId,
    line: scene.line.trim(),
    lang: scene.lang,
    sfx: scene.sfx,
  };
}
