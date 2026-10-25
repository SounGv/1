// Short synthesized sound effects. No external audio files.

export const SFX_OPTIONS = [
  { value: 'none', label: 'ไม่มีเสียง' },
  { value: 'pop', label: 'ป๊อป' },
  { value: 'whoosh', label: 'วูบ' },
  { value: 'ding', label: 'ติ๊ง' },
  { value: 'click', label: 'คลิก' },
];

const noiseCache = new WeakMap();

function noiseBuffer(ctx) {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.0), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}

function envelope(ctx, when, attack, peak, decay) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return gain;
}

function pop(ctx, when, out) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(720, when);
  osc.frequency.exponentialRampToValueAtTime(180, when + 0.09);
  const gain = envelope(ctx, when, 0.005, 0.6, 0.11);
  osc.connect(gain).connect(out);
  osc.start(when);
  osc.stop(when + 0.14);
}

function whoosh(ctx, when, out) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(300, when);
  filter.frequency.exponentialRampToValueAtTime(2600, when + 0.32);
  filter.frequency.exponentialRampToValueAtTime(900, when + 0.55);
  const gain = envelope(ctx, when, 0.18, 0.45, 0.38);
  src.connect(filter).connect(gain).connect(out);
  src.start(when);
  src.stop(when + 0.6);
}

function ding(ctx, when, out) {
  for (const [freq, level] of [[1318.5, 0.32], [2637, 0.12]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = envelope(ctx, when, 0.004, level, 0.9);
    osc.connect(gain).connect(out);
    osc.start(when);
    osc.stop(when + 0.95);
  }
}

function click(ctx, when, out) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2000;
  const gain = envelope(ctx, when, 0.001, 0.7, 0.025);
  src.connect(filter).connect(gain).connect(out);
  src.start(when);
  src.stop(when + 0.04);
}

const PLAYERS = { pop, whoosh, ding, click };

/** Schedules one effect at AudioContext time `when` into `destination`. 'none' is a no-op. */
export function playSfx(ctx, type, when, destination) {
  const player = PLAYERS[type];
  if (player) player(ctx, Math.max(when, ctx.currentTime), destination);
}
