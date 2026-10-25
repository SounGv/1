import { drawCharacter } from './characters.js';
import { playSfx } from './sfx.js';

export const CANVAS_SIZES = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
};

/** Caption band sits above the platform UI safe zone; characters stand on top of it. */
const LAYOUTS = {
  '9:16': {
    safeBottom: 230, captionHeight: 220, captionFont: 44, captionMaxLines: 3, captionPadX: 48,
    characterSize: 380, slots: { 1: [0.5], 2: [0.29, 0.71] },
  },
  '16:9': {
    safeBottom: 56, captionHeight: 170, captionFont: 42, captionMaxLines: 3, captionPadX: 120,
    characterSize: 290, slots: { 1: [0.84], 2: [0.15, 0.85] },
  },
};

const FPS = 30;
const LEAD_IN = 0.25;
const SPEECH_DELAY = 0.2;
const CROSSFADE = 0.35;
const TAIL = 0.2;
const FONT_FAMILY = '"Noto Sans Thai Looped", system-ui, sans-serif';

export class RenderAbortedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'RenderAbortedError';
    this.reason = reason;
  }
}

const MIME_CANDIDATES = [
  { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1,opus', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

export function pickRecorderFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) || null;
}

export function isRecordingSupported() {
  const canvas = document.createElement('canvas');
  return Boolean(
    pickRecorderFormat()
    && typeof canvas.captureStream === 'function'
    && (window.AudioContext || window.webkitAudioContext),
  );
}

/** Must be called synchronously inside the user's tap so mobile browsers allow audio. */
export function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextClass();
  ctx.resume().catch(() => {});
  return ctx;
}

function cssToken(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readCanvasPalette() {
  return {
    empty: [cssToken('--canvas-empty-1', '#e7e9dc'), cssToken('--canvas-empty-2', '#dfe6ea')],
    captionBg: cssToken('--canvas-caption-bg', 'rgba(19,21,22,0.86)'),
    captionText: cssToken('--canvas-caption-text', '#ffffff'),
  };
}

/** Draws `image` covering the w×h area, scaled by `zoom` and shifted by (panX, panY) in pixels. */
export function drawImageCover(ctx, image, w, h, zoom = 1, panX = 0, panY = 0) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (w - dw) / 2 + panX, (h - dh) / 2 + panY, dw, dh);
}

function drawSceneBackground(ctx, scene, index, progress, images, palette, w, h) {
  const image = scene.imageIndex === null ? null : images[scene.imageIndex];
  if (!image) {
    ctx.fillStyle = palette.empty[index % 2];
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const direction = index % 2 === 0 ? 1 : -1;
  const zoom = 1.06 + 0.08 * progress;
  const panX = (progress - 0.5) * w * 0.04 * direction;
  const panY = (progress - 0.5) * h * 0.02;
  ctx.fillStyle = palette.empty[0];
  ctx.fillRect(0, 0, w, h);
  drawImageCover(ctx, image, w, h, zoom, panX, panY);
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null;

function splitIntoPieces(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Thai has no spaces between words, so wrap on word segments and fall back to characters. */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let current = '';
  for (const piece of splitIntoPieces(text)) {
    const candidate = current + piece;
    if (ctx.measureText(candidate).width <= maxWidth || current === '') {
      current = candidate;
      if (ctx.measureText(current).width > maxWidth) {
        const chars = Array.from(current);
        current = '';
        for (const ch of chars) {
          if (current && ctx.measureText(current + ch).width > maxWidth) {
            lines.push(current);
            current = ch;
          } else {
            current += ch;
          }
        }
      }
    } else {
      lines.push(current.trimEnd());
      current = piece.trimStart();
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function drawCaption(ctx, text, layout, palette, w, h) {
  const bandBottom = h - layout.safeBottom;
  const bandTop = bandBottom - layout.captionHeight;
  ctx.fillStyle = palette.captionBg;
  ctx.fillRect(0, bandTop, w, layout.captionHeight);

  const maxWidth = w - layout.captionPadX * 2;
  let fontSize = layout.captionFont;
  let lines = [];
  for (; fontSize >= 24; fontSize -= 4) {
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= layout.captionMaxLines && lines.length * fontSize * 1.5 <= layout.captionHeight - 24) break;
  }
  lines = lines.slice(0, layout.captionMaxLines);
  const lineHeight = fontSize * 1.5;
  const blockTop = bandTop + (layout.captionHeight - lines.length * lineHeight) / 2;
  ctx.fillStyle = palette.captionText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, w / 2, blockTop + lineHeight * (i + 0.5)));
}

function sceneIndexAt(scenes, t) {
  for (let i = scenes.length - 1; i >= 0; i -= 1) {
    if (t >= scenes[i].startSec) return i;
  }
  return 0;
}

function analyserLevel(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buffer.length);
  return Math.min(1, Math.max(0, (rms - 0.02) * 6));
}

/** Draws one frame. `mouthLevels` maps character id to 0..1. */
export function drawFrame(ctx, { scenes, characters, images, ratio, palette, t, mouthLevels }) {
  const { width: w, height: h } = CANVAS_SIZES[ratio];
  const layout = LAYOUTS[ratio];
  const index = sceneIndexAt(scenes, t);
  const scene = scenes[index];
  const length = scene.endSec - scene.startSec;
  const progress = Math.min(1, Math.max(0, (t - scene.startSec) / length));

  drawSceneBackground(ctx, scene, index, progress, images, palette, w, h);
  const next = scenes[index + 1];
  const fadeStart = scene.endSec - CROSSFADE;
  if (next && t > fadeStart) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (t - fadeStart) / CROSSFADE);
    drawSceneBackground(ctx, next, index + 1, 0, images, palette, w, h);
    ctx.restore();
  }

  const bandTop = h - layout.safeBottom - layout.captionHeight;
  const slots = layout.slots[characters.length] || layout.slots[1];
  characters.forEach((character, i) => {
    const level = mouthLevels[character.id] || 0;
    drawCharacter(ctx, character, w * slots[i], bandTop + 4, layout.characterSize, level, t);
  });

  drawCaption(ctx, scene.line, layout, palette, w, h);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch {
    // Not fatal: some browsers refuse without a reason we can act on.
  }
  return null;
}

/**
 * Records the clip in real time.
 * audioBuffers[i] is the decoded speech for scenes[i] (or null).
 * Resolves { blob, mimeType, extension }; rejects with RenderAbortedError('hidden' | 'cancelled').
 */
export async function recordClip({
  audioContext, canvas, scenes, characters, images, ratio, durationSec, audioBuffers, onProgress, signal,
}) {
  const format = pickRecorderFormat();
  if (!format) throw new Error('recording_unsupported');

  const { width, height } = CANVAS_SIZES[ratio];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const palette = readCanvasPalette();

  try {
    await document.fonts.load(`700 40px ${FONT_FAMILY}`);
  } catch {
    // Falls back to system font.
  }
  if (audioContext.state !== 'running') await audioContext.resume();

  const recordDestination = audioContext.createMediaStreamDestination();
  const master = audioContext.createGain();
  master.gain.value = 1;
  master.connect(recordDestination);
  master.connect(audioContext.destination);

  const t0 = audioContext.currentTime + LEAD_IN;
  const sources = [];
  const analysers = scenes.map((scene, i) => {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(master);
    const buffer = audioBuffers[i];
    if (buffer) {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.start(t0 + scene.startSec + SPEECH_DELAY);
      source.stop(t0 + scene.endSec);
      sources.push(source);
    }
    playSfx(audioContext, scene.sfx, t0 + scene.startSec, master);
    return analyser;
  });
  const sampleBuffer = new Uint8Array(512);

  const stream = canvas.captureStream(FPS);
  recordDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const wakeLock = await requestWakeLock();
  const smoothed = {};
  let frameId = 0;
  let abortReason = null;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', onVisibility);
      signal?.removeEventListener('abort', onAbort);
      sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
      master.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      wakeLock?.release().catch(() => {});
    };

    const abort = (reason) => {
      if (abortReason) return;
      abortReason = reason;
      if (recorder.state !== 'inactive') recorder.stop();
      else { cleanup(); reject(new RenderAbortedError(reason)); }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') abort('hidden'); };
    const onAbort = () => abort('cancelled');
    document.addEventListener('visibilitychange', onVisibility);
    signal?.addEventListener('abort', onAbort);

    recorder.onstop = () => {
      cleanup();
      if (abortReason) {
        reject(new RenderAbortedError(abortReason));
        return;
      }
      resolve({ blob: new Blob(chunks, { type: format.mimeType.split(';')[0] }), ...format });
    };
    recorder.onerror = () => abort('recorder_error');

    const tick = () => {
      const t = Math.min(durationSec, Math.max(0, audioContext.currentTime - t0));
      const index = sceneIndexAt(scenes, t);
      const mouthLevels = {};
      characters.forEach((c) => {
        const target = scenes[index].speakerId === c.id ? analyserLevel(analysers[index], sampleBuffer) : 0;
        smoothed[c.id] = (smoothed[c.id] || 0) * 0.5 + target * 0.5;
        mouthLevels[c.id] = smoothed[c.id];
      });
      drawFrame(ctx, { scenes, characters, images, ratio, palette, t, mouthLevels });
      onProgress?.(t / durationSec);

      if (audioContext.currentTime >= t0 + durationSec + TAIL) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    if (document.visibilityState === 'hidden') {
      cleanup();
      reject(new RenderAbortedError('hidden'));
      return;
    }
    recorder.start(1000);
    tick();
  });
}
