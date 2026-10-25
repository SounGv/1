// Converts a recorded WebM clip to MP4 with ffmpeg.wasm. Loaded only when MediaRecorder could not produce MP4.

const FFMPEG_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm';
const FFMPEG_WORKER_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js/+esm';
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

let loading = null;

/** Cross-origin workers and wasm must be served from blob: URLs. */
async function toBlobUrl(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('ffmpeg_download_failed');
  const blob = new Blob([await response.arrayBuffer()], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function loadFfmpeg() {
  // Dynamic import keeps the ~30 MB converter off the page unless this browser needs it.
  const { FFmpeg } = await import(FFMPEG_MODULE_URL);
  const [classWorkerURL, coreURL, wasmURL] = await Promise.all([
    toBlobUrl(FFMPEG_WORKER_URL, 'text/javascript'),
    toBlobUrl(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    toBlobUrl(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
  return ffmpeg;
}

/**
 * onStage('download' | 'convert') reports which phase is running, onProgress gets 0..1 during conversion.
 * Rejects with an AbortError when `signal` aborts.
 */
export async function convertToMp4(webmBlob, { onStage, onProgress, signal } = {}) {
  onStage?.('download');
  if (!loading) {
    loading = loadFfmpeg().catch((err) => {
      loading = null;
      throw err;
    });
  }
  const ffmpeg = await loading;
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const handleProgress = ({ progress }) => onProgress?.(Math.min(1, Math.max(0, progress)));
  ffmpeg.on('progress', handleProgress);
  const onAbort = () => {
    ffmpeg.terminate();
    loading = null;
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    onStage?.('convert');
    await ffmpeg.writeFile('input.webm', new Uint8Array(await webmBlob.arrayBuffer()));
    const exitCode = await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ]);
    if (exitCode !== 0) throw new Error('ffmpeg_failed');
    const data = await ffmpeg.readFile('output.mp4');
    await Promise.allSettled([ffmpeg.deleteFile('input.webm'), ffmpeg.deleteFile('output.mp4')]);
    return new Blob([data], { type: 'video/mp4' });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!signal?.aborted) ffmpeg.off('progress', handleProgress);
  }
}
