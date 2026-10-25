import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_CHARS,
  MAX_IMAGES,
  MAX_STORYBOARD_BODY_BYTES,
  parseImageDataUrl,
  parseModelJson,
  validateScenes,
  validateStoryboardRequest,
} from '../api/_lib/validate.js';

const IDS = ['A', 'B'];

function scene(overrides = {}) {
  return {
    startSec: 0,
    endSec: 5,
    imageIndex: 0,
    speakerId: 'A',
    line: 'สวัสดีค่ะ',
    lang: 'th',
    sfx: 'pop',
    ...overrides,
  };
}

function twoScenes() {
  return [
    scene({ startSec: 0, endSec: 4, imageIndex: 0, speakerId: 'A', sfx: 'whoosh' }),
    scene({ startSec: 4, endSec: 10, imageIndex: null, speakerId: 'B', line: 'Hello there', lang: 'en', sfx: 'none' }),
  ];
}

function expectInvalid(scenes, durationSec, imageCount, pattern) {
  const result = validateScenes(scenes, durationSec, IDS, imageCount);
  assert.equal(result.valid, false, 'expected storyboard to be rejected');
  assert.ok(result.errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got: ${result.errors.join(' | ')}`);
}

test('accepts a single scene covering the whole clip', () => {
  const result = validateScenes([scene()], 5, IDS, 1);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('accepts contiguous scenes from 0 to duration with valid speakers and images', () => {
  const result = validateScenes(twoScenes(), 10, IDS, 2);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('accepts imageIndex null when no images are attached', () => {
  const result = validateScenes([scene({ imageIndex: null })], 5, ['A'], 0);
  assert.equal(result.valid, true);
});

test('rejects a gap between scenes', () => {
  const scenes = twoScenes();
  scenes[1].startSec = 5;
  expectInvalid(scenes, 10, 2, /gap/);
});

test('rejects overlapping scenes', () => {
  const scenes = twoScenes();
  scenes[1].startSec = 3;
  expectInvalid(scenes, 10, 2, /overlaps/);
});

test('rejects a first scene that does not start at 0', () => {
  expectInvalid([scene({ startSec: 1 })], 5, 1, /gap/);
});

test('rejects a storyboard that does not end at the clip length', () => {
  expectInvalid([scene({ endSec: 4 })], 5, 1, /must end at 5s/);
  expectInvalid([scene({ endSec: 6 })], 5, 1, /must end at 5s/);
});

test('rejects an unknown speaker', () => {
  expectInvalid([scene({ speakerId: 'C' })], 5, 1, /unknown speakerId/);
  const result = validateScenes([scene({ speakerId: 'B' })], 5, ['A'], 1);
  assert.equal(result.valid, false);
});

test('rejects imageIndex out of range', () => {
  expectInvalid([scene({ imageIndex: 1 })], 5, 1, /imageIndex/);
  expectInvalid([scene({ imageIndex: -1 })], 5, 1, /imageIndex/);
  expectInvalid([scene({ imageIndex: 0 })], 5, 0, /imageIndex/);
  expectInvalid([scene({ imageIndex: 0.5 })], 5, 2, /imageIndex/);
});

test('rejects sfx outside the allowed list', () => {
  expectInvalid([scene({ sfx: 'boom' })], 5, 1, /sfx/);
  expectInvalid([scene({ sfx: undefined })], 5, 1, /sfx/);
});

test('rejects an empty line', () => {
  expectInvalid([scene({ line: '' })], 5, 1, /line is empty/);
  expectInvalid([scene({ line: '   ' })], 5, 1, /line is empty/);
  expectInvalid([scene({ line: null })], 5, 1, /line is empty/);
});

test('rejects a line too long to speak within the scene', () => {
  expectInvalid([scene({ line: 'ก'.repeat(61) })], 5, 1, /too long/);
});

test('rejects empty or non-array scenes', () => {
  assert.equal(validateScenes([], 5, IDS, 0).valid, false);
  assert.equal(validateScenes(null, 5, IDS, 0).valid, false);
});

test('parseModelJson reads bare JSON, fenced JSON, and rejects junk', () => {
  assert.deepEqual(parseModelJson('{"refused":true,"reason":"x"}'), { refused: true, reason: 'x' });
  assert.deepEqual(parseModelJson('```json\n{"scenes":[]}\n```'), { scenes: [] });
  assert.equal(parseModelJson('no json here'), null);
  assert.equal(parseModelJson('[1,2]'), null);
});

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('parseImageDataUrl checks declared MIME against file bytes', () => {
  assert.equal(parseImageDataUrl(TINY_PNG)?.mediaType, 'image/png');
  assert.equal(parseImageDataUrl(TINY_PNG.replace('image/png', 'image/jpeg')), null);
  assert.equal(parseImageDataUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw='), null);
});

test('six images at the size cap fit under the request body limit', () => {
  const oneImage = MAX_IMAGE_DATA_URL_CHARS;
  const body = oneImage * MAX_IMAGES + 8 * 1024;
  assert.ok(body < MAX_STORYBOARD_BODY_BYTES);
  assert.ok(oneImage <= Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64);
  // The browser resizes to this many characters (public/js/main.js). Keep the two in step.
  assert.ok(510_000 <= oneImage);
});

test('validateStoryboardRequest enforces the request contract', () => {
  const base = {
    prompt: 'แนะนำร้านกาแฟเปิดใหม่',
    durationSec: 5,
    ratio: '9:16',
    characters: [{ id: 'A', gender: 'female', ageGroup: 'adult', skinTone: 2, voiceLang: 'th' }],
    images: [TINY_PNG],
  };
  assert.equal(validateStoryboardRequest(base).ok, true);
  assert.equal(validateStoryboardRequest({ ...base, durationSec: 7 }).ok, false);
  assert.equal(validateStoryboardRequest({ ...base, ratio: '1:1' }).ok, false);
  assert.equal(validateStoryboardRequest({ ...base, prompt: 'ก'.repeat(501) }).ok, false);
  assert.equal(validateStoryboardRequest({ ...base, characters: [] }).ok, false);
  assert.equal(validateStoryboardRequest({ ...base, images: Array(7).fill(TINY_PNG) }).ok, false);
  const badTone = { ...base, characters: [{ ...base.characters[0], skinTone: 7 }] };
  assert.equal(validateStoryboardRequest(badTone).ok, false);
});
