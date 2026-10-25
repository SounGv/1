// Parametric flat-style characters. Original generic shapes only; not based on any existing cartoon.

/** Skin tones 1 (lightest) to 6 (deepest). The only place these colors are defined. */
export const SKIN_TONES = ['#f6d8c3', '#ecc09f', '#d49b72', '#b07650', '#875838', '#5c3a25'];

const COLORS = {
  outline: '#131516',
  hairDark: '#2a201b',
  hairChild: '#3b2a20',
  hairGray: '#cfcfca',
  eye: '#131516',
  mouth: '#6f1f2b',
  tongue: '#d86a6f',
  blush: 'rgba(232, 112, 100, 0.28)',
  glasses: '#131516',
  shirtA: '#4e5c00',
  shirtB: '#2f5d7c',
  collar: '#ffffff',
};

const BODY_BY_AGE = {
  child: { head: 0.27, bodyW: 0.62, bodyH: 0.34 },
  teen: { head: 0.235, bodyW: 0.74, bodyH: 0.38 },
  adult: { head: 0.225, bodyW: 0.8, bodyH: 0.4 },
  senior: { head: 0.225, bodyW: 0.8, bodyH: 0.4 },
};

const BLINK_PERIOD = 3.6;
const BLINK_LENGTH = 0.13;

export const GENDER_LABELS = { female: 'หญิง', male: 'ชาย' };
export const AGE_LABELS = { child: 'เด็ก', teen: 'วัยรุ่น', adult: 'วัยทำงาน', senior: 'สูงวัย' };
export const VOICE_LABELS = { th: 'เสียงไทย', en: 'เสียงอังกฤษ' };

export function describeCharacter(spec) {
  return `${GENDER_LABELS[spec.gender]} ${AGE_LABELS[spec.ageGroup]} ${VOICE_LABELS[spec.voiceLang]}`;
}

function phaseFor(spec) {
  return spec.id === 'B' ? 1.7 : 0;
}

function hairColor(spec) {
  if (spec.ageGroup === 'senior') return COLORS.hairGray;
  if (spec.ageGroup === 'child') return COLORS.hairChild;
  return COLORS.hairDark;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillAndStroke(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

function drawBackHair(ctx, spec, cx, cy, r) {
  if (spec.gender !== 'female') return;
  ctx.beginPath();
  if (spec.ageGroup === 'senior') {
    ctx.arc(cx, cy - r * 1.02, r * 0.38, 0, Math.PI * 2);
    fillAndStroke(ctx, hairColor(spec));
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.05, r * 1.1, r * 1.08, 0, 0, Math.PI * 2);
  } else if (spec.ageGroup === 'child') {
    ctx.ellipse(cx, cy + r * 0.1, r * 1.12, r * 1.1, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(cx - r * 1.1, cy);
    ctx.bezierCurveTo(cx - r * 1.25, cy + r * 1.3, cx - r * 0.9, cy + r * 1.75, cx - r * 0.55, cy + r * 1.75);
    ctx.lineTo(cx + r * 0.55, cy + r * 1.75);
    ctx.bezierCurveTo(cx + r * 0.9, cy + r * 1.75, cx + r * 1.25, cy + r * 1.3, cx + r * 1.1, cy);
    ctx.ellipse(cx, cy, r * 1.1, r * 1.12, 0, 0, Math.PI, true);
    ctx.closePath();
  }
  fillAndStroke(ctx, hairColor(spec));
}

function drawFrontHair(ctx, spec, cx, cy, r) {
  const color = hairColor(spec);
  ctx.beginPath();
  if (spec.gender === 'male' && spec.ageGroup === 'senior') {
    ctx.ellipse(cx - r * 0.88, cy - r * 0.25, r * 0.2, r * 0.42, 0.2, 0, Math.PI * 2);
    fillAndStroke(ctx, color);
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.88, cy - r * 0.25, r * 0.2, r * 0.42, -0.2, 0, Math.PI * 2);
    fillAndStroke(ctx, color);
    return;
  }
  if (spec.gender === 'male') {
    ctx.moveTo(cx - r * 0.98, cy - r * 0.05);
    ctx.bezierCurveTo(cx - r * 1.05, cy - r * 1.25, cx + r * 1.05, cy - r * 1.3, cx + r * 0.98, cy - r * 0.05);
    ctx.quadraticCurveTo(cx + r * 0.75, cy - r * 0.55, cx + r * 0.2, cy - r * 0.5);
    ctx.quadraticCurveTo(cx - r * 0.35, cy - r * 0.45, cx - r * 0.98, cy - r * 0.05);
  } else {
    ctx.moveTo(cx - r * 1.0, cy + r * 0.1);
    ctx.bezierCurveTo(cx - r * 1.05, cy - r * 1.3, cx + r * 1.05, cy - r * 1.3, cx + r * 1.0, cy + r * 0.1);
    ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 0.45, cx - r * 0.1, cy - r * 0.42);
    ctx.quadraticCurveTo(cx - r * 0.7, cy - r * 0.38, cx - r * 1.0, cy + r * 0.1);
  }
  ctx.closePath();
  fillAndStroke(ctx, color);
}

function drawBody(ctx, spec, cx, bottom, bodyW, bodyH, neckW, neckTop) {
  const shirt = spec.id === 'B' ? COLORS.shirtB : COLORS.shirtA;
  const left = cx - bodyW / 2;
  const top = bottom - bodyH;

  ctx.beginPath();
  ctx.rect(cx - neckW / 2, neckTop, neckW, top - neckTop + bodyH * 0.2);
  fillAndStroke(ctx, SKIN_TONES[spec.skinTone - 1]);

  roundedRectPath(ctx, left, top, bodyW, bodyH * 1.3, bodyW * 0.32);
  fillAndStroke(ctx, shirt);

  ctx.beginPath();
  if (spec.ageGroup === 'teen') {
    ctx.moveTo(cx - bodyW * 0.3, top + bodyH * 0.02);
    ctx.quadraticCurveTo(cx, top + bodyH * 0.38, cx + bodyW * 0.3, top + bodyH * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.08, top + bodyH * 0.2);
    ctx.lineTo(cx - bodyW * 0.08, top + bodyH * 0.5);
    ctx.moveTo(cx + bodyW * 0.08, top + bodyH * 0.2);
    ctx.lineTo(cx + bodyW * 0.08, top + bodyH * 0.5);
    ctx.stroke();
  } else if (spec.ageGroup === 'adult') {
    ctx.moveTo(cx - bodyW * 0.16, top + 1);
    ctx.lineTo(cx, top + bodyH * 0.28);
    ctx.lineTo(cx + bodyW * 0.16, top + 1);
    ctx.closePath();
    fillAndStroke(ctx, COLORS.collar);
  } else if (spec.ageGroup === 'senior') {
    ctx.moveTo(cx, top + bodyH * 0.12);
    ctx.lineTo(cx, bottom + bodyH * 0.3);
    ctx.stroke();
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(cx + bodyW * 0.06, top + bodyH * (0.32 + i * 0.22), bodyW * 0.018, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.collar;
      ctx.fill();
    }
  } else {
    ctx.arc(cx, top + 1, bodyW * 0.16, 0, Math.PI);
    fillAndStroke(ctx, COLORS.collar);
  }
}

function drawFace(ctx, spec, cx, cy, r, mouthOpen, blinking) {
  const eyeY = cy + r * 0.02;
  const eyeDx = r * 0.36;

  ctx.fillStyle = COLORS.blush;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.55, cy + r * 0.32, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.55, cy + r * 0.32, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.eye;
  for (const dx of [-eyeDx, eyeDx]) {
    ctx.beginPath();
    if (blinking) {
      ctx.ellipse(cx + dx, eyeY + r * 0.02, r * 0.11, r * 0.022, 0, 0, Math.PI * 2);
    } else {
      ctx.ellipse(cx + dx, eyeY, r * 0.085, r * 0.11, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  ctx.strokeStyle = spec.ageGroup === 'senior' ? COLORS.hairGray : hairColor(spec);
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - eyeDx - r * 0.12, eyeY - r * 0.24);
  ctx.lineTo(cx - eyeDx + r * 0.1, eyeY - r * 0.27);
  ctx.moveTo(cx + eyeDx - r * 0.1, eyeY - r * 0.27);
  ctx.lineTo(cx + eyeDx + r * 0.12, eyeY - r * 0.24);
  ctx.stroke();

  if (spec.ageGroup === 'senior') {
    ctx.strokeStyle = COLORS.glasses;
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath();
    ctx.arc(cx - eyeDx, eyeY, r * 0.2, 0, Math.PI * 2);
    ctx.moveTo(cx + eyeDx + r * 0.2, eyeY);
    ctx.arc(cx + eyeDx, eyeY, r * 0.2, 0, Math.PI * 2);
    ctx.moveTo(cx - eyeDx + r * 0.2, eyeY);
    ctx.lineTo(cx + eyeDx - r * 0.2, eyeY);
    ctx.stroke();
  }

  const mouthY = cy + r * 0.48;
  const open = Math.max(0, Math.min(1, mouthOpen));
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = Math.max(1.2, r * 0.045);
  if (open < 0.06) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.17, mouthY - r * 0.02);
    ctx.quadraticCurveTo(cx, mouthY + r * 0.1, cx + r * 0.17, mouthY - r * 0.02);
    ctx.stroke();
    return;
  }
  const mouthH = r * (0.06 + open * 0.24);
  const mouthW = r * (0.2 + open * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, mouthY + mouthH * 0.3, mouthW, mouthH, 0, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.mouth;
  ctx.fill();
  ctx.stroke();
  if (open > 0.35) {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx, mouthY + mouthH * 0.95, mouthW * 0.65, mouthH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.tongue;
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Draws a bust-length character standing on (x, y) = bottom-center.
 * size is the figure's full height in canvas pixels, mouthOpen 0..1, t seconds for idle motion.
 */
export function drawCharacter(ctx, spec, x, y, size, mouthOpen, t) {
  const proportions = BODY_BY_AGE[spec.ageGroup] || BODY_BY_AGE.adult;
  const phase = phaseFor(spec);
  const sway = Math.sin(t * 1.6 + phase) * 0.022;
  const bob = Math.sin(t * 3.2 + phase) * size * 0.004;
  const blinking = ((t + phase * 1.3) % BLINK_PERIOD) < BLINK_LENGTH;

  const r = size * proportions.head;
  const bodyW = size * proportions.bodyW;
  const bodyH = size * proportions.bodyH;
  const headCy = -bodyH - r * 1.02;
  const skin = SKIN_TONES[spec.skinTone - 1] || SKIN_TONES[2];

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(sway);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = Math.max(1.2, size * 0.008);

  drawBackHair(ctx, spec, 0, headCy, r);
  drawBody(ctx, spec, 0, 0, bodyW, bodyH, r * 0.52, headCy + r * 0.6);

  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = Math.max(1.2, size * 0.008);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.95, headCy + r * 0.08, r * 0.16, r * 0.22, 0, 0, Math.PI * 2);
    fillAndStroke(ctx, skin);
  }
  ctx.beginPath();
  ctx.ellipse(0, headCy, r * 0.94, r, 0, 0, Math.PI * 2);
  fillAndStroke(ctx, skin);

  drawFrontHair(ctx, spec, 0, headCy, r);
  drawFace(ctx, spec, 0, headCy, r, mouthOpen, blinking);
  ctx.restore();
}
