import { getAccessToken, getSession, initAuth, onSignedOut, signInWithGoogle, signOut } from './auth.js';
import {
  ApiError,
  createRenderTicket,
  createStoryboard,
  fetchMe,
  fetchPublicConfig,
  setAccessTokenProvider,
  synthesizeSpeech,
} from './api.js';
import { SKIN_TONES, describeCharacter, drawCharacter } from './characters.js';
import { SFX_OPTIONS, playSfx } from './sfx.js';
import {
  RenderAbortedError,
  createAudioContext,
  drawImageCover,
  isRecordingSupported,
  readCanvasPalette,
  recordClip,
} from './renderer.js';
import { convertToMp4 } from './mp4.js';

/** Placeholder until the project owner confirms the real contact channel. */
const ADMIN_CONTACT = { label: 'admin@example.com', href: 'mailto:admin@example.com' };

const MAX_IMAGES = 6;
const MAX_IMAGE_SIDE = 1024;
const MAX_IMAGE_DATA_URL_CHARS = 780_000;
const MAX_PROMPT_CHARS = 500;
const MAX_TTS_CHARS = 300;
const CHARS_PER_SECOND = { th: 12, en: 15 };
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function defaultCharacter(id, voiceLang = 'th') {
  return id === 'A'
    ? { id, gender: 'female', ageGroup: 'adult', skinTone: 2, voiceLang }
    : { id, gender: 'male', ageGroup: 'adult', skinTone: 3, voiceLang };
}

const state = {
  me: null,
  form: {
    prompt: '',
    durationSec: 5,
    ratio: '9:16',
    characters: [defaultCharacter('A')],
    images: [],
    sfxEnabled: true,
    rightsConfirmed: false,
  },
  scenes: null,
  storyboardSettings: null,
  ticket: null,
  audioCache: new Map(),
  result: null,
  render: null,
  editingCharacterIndex: null,
  sheetReturnFocus: null,
};

/* ---------- helpers ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const NOTICE_ICONS = { error: 'alert', warning: 'alert', info: 'info' };

function setNotice(node, type, text) {
  if (!text) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  node.className = `notice notice-${type}`;
  node.replaceChildren(icon(NOTICE_ICONS[type]), el('span', { text }));
  node.hidden = false;
}

function setBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.replaceChildren(el('span', { className: 'spinner spinner-small', 'aria-hidden': 'true' }), el('span', { text: busyLabel }));
  } else {
    button.removeAttribute('aria-busy');
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

function countChars(text) {
  return Array.from(text || '').length;
}

function maxLineChars(scene) {
  const perSecond = CHARS_PER_SECOND[scene.lang] || CHARS_PER_SECOND.th;
  return Math.min(MAX_TTS_CHARS, Math.floor((scene.endSec - scene.startSec) * perSecond));
}

const thaiDateFormat = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
});
const timeFormat = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });

function formatThaiDate(iso) {
  return thaiDateFormat.format(new Date(iso));
}

function clipFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `clip-${stamp}.mp4`;
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function sizeCanvasToElement(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawAvatar(canvas, spec) {
  const { ctx, width, height } = sizeCanvasToElement(canvas);
  ctx.clearRect(0, 0, width, height);
  drawCharacter(ctx, spec, width / 2, height * 1.06, width * 1.05, 0, 0.6);
}

/* ---------- screens ---------- */

function showScreen(name) {
  for (const screen of $$('[data-screen]')) screen.hidden = screen.dataset.screen !== name;
  document.body.classList.toggle('is-dark', name === 'rendering');
  window.scrollTo(0, 0);
}

function showError({ title, message, primary, secondary, note = '' }) {
  $('#error-title').textContent = title;
  $('#error-message').textContent = message;
  $('#error-note').textContent = note;
  const primaryButton = $('#error-primary');
  primaryButton.textContent = primary.label;
  primaryButton.onclick = primary.action;
  const secondaryButton = $('#error-secondary');
  secondaryButton.hidden = !secondary;
  if (secondary) {
    secondaryButton.textContent = secondary.label;
    secondaryButton.onclick = secondary.action;
  }
  showScreen('error');
}

function showQuotaExhausted(resetAt) {
  const reset = resetAt || state.me?.resetAt;
  const quota = state.me?.monthlyQuota ?? 10;
  $('#quota-message').textContent = `ใช้ครบ ${quota} คลิปของเดือนนี้แล้ว โควตาจะรีเซ็ตวันที่ ${formatThaiDate(reset)}`;
  const contact = $('#admin-contact');
  contact.replaceChildren(el('a', { href: ADMIN_CONTACT.href, text: ADMIN_CONTACT.label }));
  showScreen('quota');
}

function updateQuotaUI() {
  const me = state.me;
  const text = me ? `เหลือ ${me.remaining}/${me.monthlyQuota} คลิป` : '';
  for (const pill of [$('#quota-pill'), ...$$('[data-quota-pill]')]) pill.textContent = text;
}

function showLogin(message) {
  showScreen('login');
  setNotice($('#login-status'), 'error', message || '');
  drawHero();
}

/* ---------- login ---------- */

function drawHero() {
  const canvas = $('#hero-canvas');
  const { ctx, width, height } = sizeCanvasToElement(canvas);
  ctx.clearRect(0, 0, width, height);
  const size = height * 0.92;
  drawCharacter(ctx, { id: 'A', gender: 'female', ageGroup: 'adult', skinTone: 2, voiceLang: 'th' }, width * 0.36, height + 4, size, 0.4, 0.6);
  drawCharacter(ctx, { id: 'B', gender: 'male', ageGroup: 'senior', skinTone: 4, voiceLang: 'th' }, width * 0.66, height + 4, size, 0, 0.6);
}

function bindLogin() {
  const checkbox = $('#consent-checkbox');
  const button = $('#login-button');
  const note = $('#login-note');
  checkbox.addEventListener('change', () => {
    button.disabled = !checkbox.checked;
    note.textContent = checkbox.checked
      ? 'ระบบจะพาไปหน้าเข้าสู่ระบบของ Google แล้วกลับมาที่นี่'
      : 'ติ๊กยอมรับข้อตกลงด้านบนก่อนเข้าสู่ระบบ';
  });
  button.addEventListener('click', async () => {
    if (!checkbox.checked) return;
    if (!navigator.onLine) {
      setNotice($('#login-status'), 'error', 'ไม่มีอินเทอร์เน็ต เชื่อมต่อแล้วกดเข้าสู่ระบบอีกครั้ง');
      return;
    }
    setBusy(button, true, 'กำลังไปหน้า Google');
    try {
      await signInWithGoogle();
    } catch {
      setBusy(button, false);
      setNotice($('#login-status'), 'error', 'เปิดหน้าเข้าสู่ระบบของ Google ไม่สำเร็จ ลองกดอีกครั้ง');
    }
  });
}

async function loadMe() {
  try {
    state.me = await fetchMe();
    updateQuotaUI();
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      showLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      return false;
    }
    showError({
      title: 'โหลดข้อมูลบัญชีไม่สำเร็จ',
      message: err.message || 'ระบบขัดข้องชั่วคราว ลองอีกครั้งในอีกสักครู่',
      primary: { label: 'ลองอีกครั้ง', action: () => startSignedIn() },
    });
    return false;
  }
}

async function startSignedIn() {
  showScreen('loading');
  if (!(await loadMe())) return;
  showCreate();
}

/* ---------- create screen ---------- */

function showCreate() {
  showScreen('create');
  renderCharacterTiles();
  renderImageStrip();
  drawStagePreview();
  if (state.me && state.me.remaining === 0 && !state.ticket) {
    setNotice($('#create-status'), 'warning',
      `โควตาเดือนนี้หมดแล้ว สร้างสตอรีบอร์ดได้ แต่จะสร้างคลิปได้อีกครั้งวันที่ ${formatThaiDate(state.me.resetAt)}`);
  }
}

function drawStagePreview() {
  const canvas = $('#stage-canvas');
  if (!canvas.isConnected || canvas.getBoundingClientRect().width === 0) return;
  const { ctx, width, height } = sizeCanvasToElement(canvas);
  const palette = readCanvasPalette();
  ctx.fillStyle = palette.empty[0];
  ctx.fillRect(0, 0, width, height);
  const firstImage = state.form.images[0]?.image;
  if (firstImage) drawImageCover(ctx, firstImage, width, height);

  const characters = state.form.characters;
  const portrait = state.form.ratio === '9:16';
  const size = portrait ? height * 0.5 : height * 0.8;
  const slots = characters.length === 2 ? [0.3, 0.7] : [0.5];
  characters.forEach((spec, i) => {
    drawCharacter(ctx, spec, width * slots[i], height + size * 0.04, size, i === 0 ? 0.35 : 0, 0.6);
  });
}

function setPressed(container, attribute, value) {
  for (const button of $$(`[${attribute}]`, container)) {
    button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === String(value)));
  }
}

function bindStageControls() {
  $('#duration-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-duration]');
    if (!button) return;
    state.form.durationSec = Number(button.dataset.duration);
    setPressed($('#duration-chips'), 'data-duration', state.form.durationSec);
  });
  $('#ratio-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ratio]');
    if (!button) return;
    state.form.ratio = button.dataset.ratio;
    setPressed($('#ratio-chips'), 'data-ratio', state.form.ratio);
    $('#stage-frame').dataset.ratio = state.form.ratio;
  });
  new ResizeObserver(() => drawStagePreview()).observe($('#stage-frame'));
}

function bindPrompt() {
  const input = $('#prompt-input');
  const counter = $('#prompt-count');
  input.addEventListener('input', () => {
    state.form.prompt = input.value;
    const count = countChars(input.value);
    counter.textContent = `${count}/${MAX_PROMPT_CHARS}`;
    counter.parentElement.classList.toggle('is-over', count > MAX_PROMPT_CHARS);
  });
}

/* images */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_decode_failed'));
    image.src = src;
  });
}

async function resizeImageFile(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const source = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    let dataUrl = '';
    for (const quality of [0.85, 0.72, 0.6, 0.5]) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS) break;
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) throw new Error('image_too_large');
    return { dataUrl, image: await loadImage(dataUrl) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function addImageFiles(files) {
  const status = $('#create-status');
  const room = MAX_IMAGES - state.form.images.length;
  const accepted = files.filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
  const messages = [];
  if (accepted.length < files.length) messages.push('ข้ามไฟล์ที่ไม่ใช่ภาพ JPEG, PNG หรือ WebP');
  if (accepted.length > room) messages.push(`แนบได้สูงสุด ${MAX_IMAGES} ภาพ ระบบเพิ่มให้ ${Math.max(room, 0)} ภาพแรก`);

  for (const file of accepted.slice(0, Math.max(room, 0))) {
    try {
      state.form.images.push(await resizeImageFile(file));
    } catch {
      messages.push(`เปิดภาพ ${file.name} ไม่ได้ ลองเลือกภาพอื่น`);
    }
  }
  setNotice(status, 'warning', messages.join(' '));
  renderImageStrip();
  drawStagePreview();
}

function renderImageStrip() {
  const strip = $('#image-strip');
  const tiles = state.form.images.map((entry, index) => el('div', { className: 'image-tile', role: 'listitem' }, [
    el('img', { src: entry.dataUrl, alt: `ภาพ ${index + 1}` }),
    el('span', { className: 'image-tile-label', text: `ภาพ ${index + 1}`, 'aria-hidden': 'true' }),
    el('button', {
      type: 'button',
      className: 'image-remove',
      'aria-label': `ลบภาพ ${index + 1}`,
      onClick: () => {
        state.form.images.splice(index, 1);
        renderImageStrip();
        drawStagePreview();
      },
    }, el('span', {}, icon('close'))),
  ]));
  if (state.form.images.length < MAX_IMAGES) {
    tiles.push(el('div', { role: 'listitem' }, el('button', {
      type: 'button',
      className: 'image-add',
      onClick: () => $('#image-input').click(),
    }, [icon('plus'), el('span', { text: 'เพิ่มภาพ' })])));
  }
  strip.replaceChildren(...tiles);
  const hasImages = state.form.images.length > 0;
  $('#images-empty').hidden = hasImages;
  $('#rights-row').hidden = !hasImages;
}

function bindImages() {
  const input = $('#image-input');
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) addImageFiles(files);
  });
}

/* characters + sheet */

function renderCharacterTiles() {
  const container = $('#character-tiles');
  const tiles = state.form.characters.map((spec, index) => {
    const canvas = el('canvas', { 'aria-hidden': 'true' });
    const tile = el('button', {
      type: 'button',
      className: 'character-tile',
      'aria-label': `แก้ตัวละคร ${spec.id}: ${describeCharacter(spec)}`,
      onClick: (event) => openCharacterSheet(index, event.currentTarget),
    }, [
      canvas,
      el('span', { className: 'character-tile-name', text: `ตัวละคร ${spec.id}` }),
      el('span', { className: 'character-tile-desc', text: describeCharacter(spec) }),
    ]);
    return { tile, canvas, spec };
  });
  const nodes = tiles.map((t) => t.tile);
  if (state.form.characters.length < 2) {
    nodes.push(el('button', {
      type: 'button',
      className: 'character-tile character-tile-add',
      onClick: (event) => {
        state.form.characters.push(defaultCharacter('B', state.form.characters[0].voiceLang));
        renderCharacterTiles();
        drawStagePreview();
        openCharacterSheet(1, event.currentTarget);
      },
    }, [icon('plus'), el('span', { text: 'เพิ่มตัวละครที่ 2' })]));
  }
  container.replaceChildren(...nodes);
  tiles.forEach(({ canvas, spec }) => drawAvatar(canvas, spec));
}

function buildSwatches() {
  const row = $('#character-sheet [data-field="skinTone"]');
  row.replaceChildren(...SKIN_TONES.map((color, i) => {
    const button = el('button', {
      type: 'button',
      className: 'swatch',
      'data-value': String(i + 1),
      'aria-label': `โทน ${i + 1}`,
      'aria-pressed': 'false',
    });
    button.style.setProperty('--swatch', color);
    return button;
  }));
}

function syncSheet() {
  const index = state.editingCharacterIndex;
  const spec = state.form.characters[index];
  if (!spec) return;
  const sheet = $('#character-sheet');
  $('#sheet-title').textContent = `ตัวละคร ${spec.id}`;
  for (const group of $$('[data-field]', sheet)) {
    const value = String(spec[group.dataset.field]);
    for (const button of $$('[data-value]', group)) {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
    }
  }
  $('#remove-character-button').hidden = index === 0;
  drawAvatar($('#sheet-avatar'), spec);
}

function openCharacterSheet(index, returnFocus) {
  state.editingCharacterIndex = index;
  state.sheetReturnFocus = returnFocus || null;
  const sheet = $('#character-sheet');
  sheet.hidden = false;
  syncSheet();
  requestAnimationFrame(() => {
    sheet.classList.add('is-open');
    $('[data-field="gender"] [aria-pressed="true"]', sheet)?.focus();
  });
}

function closeCharacterSheet() {
  const sheet = $('#character-sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { sheet.hidden = true; }, reduceMotion ? 0 : 280);
  const index = state.editingCharacterIndex;
  state.editingCharacterIndex = null;
  renderCharacterTiles();
  const tiles = $$('#character-tiles .character-tile');
  (tiles[Math.min(index ?? 0, tiles.length - 1)] || state.sheetReturnFocus)?.focus();
}

function bindCharacterSheet() {
  buildSwatches();
  const sheet = $('#character-sheet');
  sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-sheet-close]')) {
      closeCharacterSheet();
      return;
    }
    const option = event.target.closest('[data-value]');
    const group = option?.closest('[data-field]');
    if (!option || !group) return;
    const spec = state.form.characters[state.editingCharacterIndex];
    const field = group.dataset.field;
    spec[field] = field === 'skinTone' ? Number(option.dataset.value) : option.dataset.value;
    syncSheet();
    drawStagePreview();
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCharacterSheet();
  });
  $('#remove-character-button').addEventListener('click', () => {
    state.form.characters.splice(1, 1);
    closeCharacterSheet();
    drawStagePreview();
  });
}

/* storyboard request */

function storyboardPayload() {
  const { prompt, durationSec, ratio, characters, images } = state.form;
  return {
    prompt: prompt.trim(),
    durationSec,
    ratio,
    characters: characters.map((c) => ({ ...c })),
    images: images.map((entry) => entry.dataUrl),
  };
}

async function requestStoryboard() {
  const button = $('#storyboard-button');
  const status = $('#create-status');
  const { prompt, images } = state.form;

  if (!prompt.trim()) {
    setNotice(status, 'error', 'พิมพ์เรื่องที่จะเล่าก่อน แล้วกดสร้างสตอรีบอร์ดอีกครั้ง');
    $('#prompt-input').focus();
    return;
  }
  if (countChars(prompt.trim()) > MAX_PROMPT_CHARS) {
    setNotice(status, 'error', `เรื่องที่จะเล่ายาวเกิน ${MAX_PROMPT_CHARS} ตัวอักษร ตัดให้สั้นลงแล้วลองอีกครั้ง`);
    $('#prompt-input').focus();
    return;
  }
  if (images.length > 0 && !$('#rights-checkbox').checked) {
    setNotice(status, 'error', 'ติ๊กยืนยันสิทธิ์การใช้ภาพก่อน หรือลบภาพที่ไม่ได้รับอนุญาตออก');
    $('#rights-checkbox').focus();
    return;
  }
  if (!navigator.onLine) {
    setNotice(status, 'error', 'ไม่มีอินเทอร์เน็ต เชื่อมต่อแล้วกดสร้างสตอรีบอร์ดอีกครั้ง');
    return;
  }

  setNotice(status, 'info', '');
  setBusy(button, true, 'กำลังสร้างสตอรีบอร์ด อาจใช้เวลาราว 20 วินาที');
  try {
    const payload = storyboardPayload();
    const { scenes } = await createStoryboard(payload);
    state.scenes = scenes.map((scene) => ({ ...scene, sfx: state.form.sfxEnabled ? scene.sfx : 'none' }));
    state.storyboardSettings = {
      durationSec: payload.durationSec,
      ratio: payload.ratio,
      characters: payload.characters,
      images: state.form.images.slice(),
      sfxEnabled: state.form.sfxEnabled,
    };
    if (state.ticket?.used) state.ticket = null;
    showStoryboard();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      showLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      return;
    }
    setNotice(status, 'error', err.message || 'สร้างสตอรีบอร์ดไม่สำเร็จ ยังไม่มีการหักโควตา ลองอีกครั้งได้เลย');
  } finally {
    setBusy(button, false);
  }
}

/* ---------- storyboard screen ---------- */

function sceneTimeLabel(scene) {
  return `${scene.startSec}–${scene.endSec} วินาที`;
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function renderSceneThumb(thumb, scene, images) {
  const select = $('select', thumb);
  const image = scene.imageIndex === null ? null : images[scene.imageIndex];
  const visual = image
    ? el('img', { src: image.dataUrl, alt: '' })
    : el('span', { className: 'scene-thumb-empty' }, [icon('image'), el('span', { text: 'ไม่มีภาพ' })]);
  thumb.replaceChildren(visual, select);
}

function renderScene(scene, index) {
  const settings = state.storyboardSettings;
  const { characters, images } = settings;
  const time = sceneTimeLabel(scene);

  const imageSelect = el('select', { 'aria-label': `ภาพของฉาก ${time}` }, [
    el('option', { value: '', text: 'ไม่มีภาพ' }),
    ...images.map((_, i) => el('option', { value: String(i), text: `ภาพ ${i + 1}` })),
  ]);
  imageSelect.value = scene.imageIndex === null ? '' : String(scene.imageIndex);
  const thumb = el('div', { className: 'scene-thumb' }, imageSelect);
  renderSceneThumb(thumb, scene, images);
  imageSelect.addEventListener('change', () => {
    scene.imageIndex = imageSelect.value === '' ? null : Number(imageSelect.value);
    renderSceneThumb(thumb, scene, images);
  });

  const counter = el('span', { className: 'num' });
  const voiceNote = el('span');
  const textarea = el('textarea', {
    className: 'scene-line',
    rows: '1',
    'aria-label': `บทพูดฉาก ${time}`,
    'data-scene-line': String(index),
  });
  textarea.value = scene.line;

  const refreshLineMeta = () => {
    const speaker = characters.find((c) => c.id === scene.speakerId) || characters[0];
    const limit = maxLineChars(scene);
    const count = countChars(scene.line.trim());
    counter.textContent = `${count}/${limit}`;
    counter.classList.toggle('is-over', count > limit);
    voiceNote.textContent = `ตัวละคร ${speaker.id} ${describeCharacter(speaker)}`;
  };
  textarea.addEventListener('input', () => {
    scene.line = textarea.value;
    autosize(textarea);
    refreshLineMeta();
  });

  const speakerChips = characters.map((spec) => {
    const avatar = el('canvas', { 'aria-hidden': 'true' });
    const chip = el('button', {
      type: 'button',
      className: `chip chip-small${characters.length === 1 ? ' chip-static' : ''}`,
      'aria-pressed': String(scene.speakerId === spec.id),
      'aria-label': `ผู้พูด ตัวละคร ${spec.id}`,
      onClick: () => {
        if (characters.length === 1) return;
        scene.speakerId = spec.id;
        scene.lang = spec.voiceLang;
        speakerChips.forEach(({ chip: c, spec: s }) => c.setAttribute('aria-pressed', String(s.id === spec.id)));
        refreshLineMeta();
      },
    }, [avatar, el('span', { text: spec.id })]);
    return { chip, spec, avatar };
  });

  const sfxSelect = el('select', { 'aria-label': `เสียงเอฟเฟกต์ของฉาก ${time}` },
    SFX_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })));
  sfxSelect.value = scene.sfx;
  sfxSelect.addEventListener('change', () => {
    scene.sfx = sfxSelect.value;
    previewSfx(scene.sfx);
  });

  const item = el('li', { className: 'scene' }, [
    el('div', { className: 'scene-axis', 'aria-hidden': 'true' }),
    el('div', { className: 'scene-body' }, [
      el('span', { className: 'scene-time', text: time }),
      el('div', { className: 'scene-top' }, [
        thumb,
        el('div', { className: 'scene-controls' }, [
          el('div', { className: 'chip-row', role: 'group', 'aria-label': 'ผู้พูด' }, speakerChips.map((s) => s.chip)),
          el('label', { className: 'pill-select' }, [icon('sound'), sfxSelect]),
        ]),
      ]),
      textarea,
      el('div', { className: 'scene-line-meta' }, [voiceNote, counter]),
    ]),
  ]);

  refreshLineMeta();
  requestAnimationFrame(() => {
    autosize(textarea);
    speakerChips.forEach(({ avatar, spec }) => drawAvatar(avatar, spec));
  });
  return item;
}

let sfxPreviewContext = null;
function previewSfx(type) {
  if (type === 'none') return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  sfxPreviewContext = sfxPreviewContext || new AudioContextClass();
  sfxPreviewContext.resume().catch(() => {});
  playSfx(sfxPreviewContext, type, sfxPreviewContext.currentTime + 0.02, sfxPreviewContext.destination);
}

function ticketIsFresh() {
  return Boolean(state.ticket && new Date(state.ticket.expiresAt).getTime() > Date.now());
}

function updateRenderButton() {
  const button = $('#render-button');
  const note = $('#render-note');
  if (state.ticket) {
    button.textContent = 'สร้างคลิปอีกครั้ง ใช้ตั๋วเดิม';
    note.textContent = ticketIsFresh()
      ? `ไม่หักโควตาเพิ่ม ตั๋วนี้ขอเสียงใหม่ได้ถึง ${timeFormat.format(new Date(state.ticket.expiresAt))} น.`
      : 'ไม่หักโควตาเพิ่ม ถ้าแก้บทพูดหลังตั๋วหมดอายุ ต้องใช้โควตาใหม่';
    return;
  }
  button.textContent = 'สร้างคลิป หักโควตา 1 ครั้ง';
  const remaining = state.me?.remaining ?? 0;
  note.textContent = remaining > 0
    ? `เหลือ ${remaining} คลิปเดือนนี้ หลังกดจะเหลือ ${remaining - 1}`
    : 'โควตาเดือนนี้หมดแล้ว';
}

function showStoryboard(message) {
  const timeline = $('#timeline');
  timeline.replaceChildren(...state.scenes.map((scene, i) => renderScene(scene, i)));
  setNotice($('#storyboard-status'), message?.type || 'info', message?.text || '');
  updateQuotaUI();
  updateRenderButton();
  showScreen('storyboard');
}

function validateEditedScenes() {
  for (let i = 0; i < state.scenes.length; i += 1) {
    const scene = state.scenes[i];
    const line = scene.line.trim();
    if (!line) return { index: i, message: `บทพูดช่วง ${sceneTimeLabel(scene)} ว่างอยู่ ใส่บทพูดก่อนสร้างคลิป` };
    if (countChars(line) > maxLineChars(scene)) {
      return { index: i, message: `บทพูดช่วง ${sceneTimeLabel(scene)} ยาวเกินเวลาของฉาก ตัดให้สั้นลงก่อนสร้างคลิป` };
    }
  }
  return null;
}

/* ---------- rendering ---------- */

const STEP_LABELS = { active: 'กำลังทำ', done: 'เสร็จแล้ว', error: 'ไม่สำเร็จ' };

function resetSteps(needsTicket) {
  for (const step of $$('#render-steps li')) {
    step.dataset.state = 'pending';
    $('.step-state', step).replaceChildren(icon('pending'));
    if (step.dataset.step === 'convert') step.hidden = true;
  }
  $('#render-steps [data-step="ticket"] .step-text').textContent = needsTicket ? 'ออกตั๋วเรนเดอร์ หักโควตา 1 ครั้ง' : 'ใช้ตั๋วเดิม ไม่หักโควตาเพิ่ม';
  setProgress(0, '');
}

function setStep(name, stepState) {
  const step = $(`#render-steps [data-step="${name}"]`);
  step.hidden = false;
  step.dataset.state = stepState;
  const holder = $('.step-state', step);
  if (stepState === 'active') holder.replaceChildren(el('span', { className: 'spinner spinner-small', 'aria-hidden': 'true' }), el('span', { text: STEP_LABELS.active }));
  else if (stepState === 'done') holder.replaceChildren(icon('check', 'icon icon-done'), el('span', { text: STEP_LABELS.done }));
  else if (stepState === 'error') holder.replaceChildren(icon('alert'), el('span', { text: STEP_LABELS.error }));
}

function setProgress(fraction, detail) {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  $('#render-progress-fill').style.width = `${percent}%`;
  $('#render-progress').setAttribute('aria-valuenow', String(percent));
  if (detail !== undefined) $('#render-detail').textContent = detail;
}

function audioKey(scene, speaker) {
  return `${speaker.voiceLang}|${speaker.gender}|${scene.line.trim()}`;
}

function preventUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

function backToStoryboardAction() {
  return { label: 'กลับไปที่สตอรีบอร์ด', action: () => showStoryboard() };
}

function handleRenderFailure(err) {
  const hasTicket = Boolean(state.ticket);
  const retry = { label: hasTicket ? 'ลองอีกครั้งด้วยตั๋วเดิม' : 'ลองอีกครั้ง', action: () => startRender() };

  if (err instanceof RenderAbortedError && err.reason === 'hidden') {
    showError({
      title: 'การอัดคลิปหยุดลง',
      message: 'คุณออกจากหน้านี้ระหว่างอัดคลิป ต้องเปิดหน้านี้ค้างไว้จนอัดเสร็จ ลองใหม่ได้ด้วยตั๋วเดิม ไม่หักโควตาเพิ่ม',
      primary: { label: 'อัดใหม่ด้วยตั๋วเดิม', action: () => startRender() },
      secondary: backToStoryboardAction(),
    });
    return;
  }
  if ((err instanceof RenderAbortedError && err.reason === 'cancelled') || err?.name === 'AbortError') {
    showStoryboard({
      type: 'info',
      text: hasTicket
        ? 'ยกเลิกแล้ว กดสร้างคลิปอีกครั้งเพื่อใช้ตั๋วเดิมได้ ไม่หักโควตาเพิ่ม'
        : 'ยกเลิกแล้ว ยังไม่มีการหักโควตา',
    });
    return;
  }
  if (err instanceof ApiError) {
    if (err.status === 401) {
      showLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      return;
    }
    if (err.code === 'quota_exceeded') {
      if (state.me) state.me.remaining = 0;
      updateQuotaUI();
      showQuotaExhausted(err.data.resetAt);
      return;
    }
    if (err.code === 'ticket_invalid') {
      state.ticket = null;
      showError({
        title: 'ตั๋วเรนเดอร์เดิมใช้ต่อไม่ได้',
        message: 'ตั๋วเดิมหมดอายุหรือขอเสียงพูดครบจำนวนแล้ว กลับไปที่สตอรีบอร์ดแล้วกดสร้างคลิป ระบบจะหักโควตาใหม่ 1 ครั้ง',
        primary: backToStoryboardAction(),
      });
      return;
    }
    if (err.code === 'tts_failed') {
      showError({
        title: 'สร้างเสียงพูดไม่สำเร็จ',
        message: err.message,
        primary: retry,
        secondary: backToStoryboardAction(),
        note: 'เสียงฉากที่สร้างเสร็จแล้วจะไม่ถูกขอซ้ำ',
      });
      return;
    }
    showError({
      title: err.code === 'network' ? 'การเชื่อมต่อขาดหาย' : 'สร้างคลิปไม่สำเร็จ',
      message: hasTicket ? `${err.message} ตั๋วเดิมยังใช้ได้ ไม่หักโควตาเพิ่ม` : err.message,
      primary: retry,
      secondary: backToStoryboardAction(),
    });
    return;
  }
  if (err?.message?.startsWith('ffmpeg')) {
    showError({
      title: 'แปลงไฟล์เป็น MP4 ไม่สำเร็จ',
      message: 'อัดคลิปเสร็จแล้วแต่แปลงไฟล์ไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้งด้วยตั๋วเดิม ไม่หักโควตาเพิ่ม',
      primary: retry,
      secondary: backToStoryboardAction(),
    });
    return;
  }
  showError({
    title: 'อัดคลิปไม่สำเร็จ',
    message: 'ลองอีกครั้งด้วยตั๋วเดิม ไม่หักโควตาเพิ่ม ถ้ายังไม่ได้ ลองเปิดหน้านี้ด้วย Chrome หรือ Safari เวอร์ชันล่าสุด',
    primary: retry,
    secondary: backToStoryboardAction(),
  });
}

async function startRender() {
  const problem = validateEditedScenes();
  if (problem) {
    if (!$('[data-screen="storyboard"]').hidden) {
      setNotice($('#storyboard-status'), 'error', problem.message);
      $(`[data-scene-line="${problem.index}"]`)?.focus();
    } else {
      showStoryboard({ type: 'error', text: problem.message });
    }
    return;
  }
  if (!isRecordingSupported()) {
    showError({
      title: 'เบราว์เซอร์นี้อัดคลิปไม่ได้',
      message: 'เปิดลิงก์นี้ด้วย Chrome บน Android หรือ Safari บน iPhone เวอร์ชันล่าสุด แล้วลองอีกครั้ง ยังไม่มีการหักโควตา',
      primary: backToStoryboardAction(),
    });
    return;
  }
  if (!state.ticket && state.me && state.me.remaining <= 0) {
    showQuotaExhausted();
    return;
  }

  const settings = state.storyboardSettings;
  const scenes = state.scenes.map((scene) => ({ ...scene, line: scene.line.trim() }));
  const speakers = scenes.map((scene) => settings.characters.find((c) => c.id === scene.speakerId) || settings.characters[0]);
  const missingAudio = scenes.filter((scene, i) => !state.audioCache.has(audioKey(scene, speakers[i])));

  if (missingAudio.length > 0 && !navigator.onLine) {
    showStoryboard({ type: 'error', text: 'ไม่มีอินเทอร์เน็ต เชื่อมต่อแล้วกดสร้างคลิปอีกครั้ง ยังไม่มีการหักโควตาเพิ่ม' });
    return;
  }

  const audioContext = createAudioContext();
  const controller = new AbortController();
  const { signal } = controller;
  state.render = { controller };

  const canvas = el('canvas', { 'aria-label': 'ตัวอย่างคลิประหว่างอัด' });
  $('#render-preview').replaceChildren(canvas);
  resetSteps(!state.ticket);
  showScreen('rendering');
  window.addEventListener('beforeunload', preventUnload);

  try {
    setStep('ticket', 'active');
    setProgress(0.02, state.ticket ? 'ใช้ตั๋วเดิม' : 'กำลังออกตั๋ว');
    if (!state.ticket) {
      const ticket = await createRenderTicket(signal);
      state.ticket = { id: ticket.ticketId, expiresAt: ticket.expiresAt, used: false };
      if (state.me) {
        state.me.remaining = ticket.remaining;
        state.me.used += 1;
      }
      updateQuotaUI();
    }
    setStep('ticket', 'done');

    setStep('voice', 'active');
    for (let i = 0; i < scenes.length; i += 1) {
      setProgress(0.05 + (0.2 * i) / scenes.length, `เสียงพูดฉากที่ ${i + 1} จาก ${scenes.length}`);
      const key = audioKey(scenes[i], speakers[i]);
      if (state.audioCache.has(key)) continue;
      const speech = await synthesizeSpeech({
        ticketId: state.ticket.id,
        text: scenes[i].line,
        lang: speakers[i].voiceLang,
        gender: speakers[i].gender,
      }, signal);
      state.audioCache.set(key, base64ToArrayBuffer(speech.audioBase64));
    }
    const audioBuffers = await Promise.all(scenes.map((scene, i) => (
      audioContext.decodeAudioData(state.audioCache.get(audioKey(scene, speakers[i])).slice(0))
    )));
    setStep('voice', 'done');

    setStep('record', 'active');
    const recordShare = 0.6;
    const recording = await recordClip({
      audioContext,
      canvas,
      scenes,
      characters: settings.characters,
      images: settings.images.map((entry) => entry.image),
      ratio: settings.ratio,
      durationSec: settings.durationSec,
      audioBuffers,
      signal,
      onProgress: (fraction) => {
        const seconds = Math.min(settings.durationSec, Math.floor(fraction * settings.durationSec));
        setProgress(0.25 + recordShare * fraction, `อัดแล้ว ${seconds} จาก ${settings.durationSec} วินาที`);
      },
    });
    setStep('record', 'done');

    let blob = recording.blob;
    if (recording.extension !== 'mp4') {
      setStep('convert', 'active');
      blob = await convertToMp4(recording.blob, {
        signal,
        onStage: (stage) => setProgress(0.86, stage === 'download'
          ? 'กำลังเตรียมตัวแปลงไฟล์ ครั้งแรกต้องดาวน์โหลดราว 32 MB'
          : 'กำลังแปลงไฟล์'),
        onProgress: (fraction) => setProgress(0.86 + 0.14 * fraction, `กำลังแปลงไฟล์ ${Math.round(fraction * 100)}%`),
      });
      setStep('convert', 'done');
    }
    setProgress(1, 'เสร็จแล้ว');
    state.ticket.used = true;
    showDone(blob);
  } catch (err) {
    const active = $('#render-steps li[data-state="active"]');
    if (active) setStep(active.dataset.step, 'error');
    handleRenderFailure(err);
  } finally {
    window.removeEventListener('beforeunload', preventUnload);
    state.render = null;
    audioContext.close().catch(() => {});
  }
}

/* ---------- done ---------- */

function showDone(blob) {
  if (state.result?.url) URL.revokeObjectURL(state.result.url);
  const url = URL.createObjectURL(blob);
  const filename = clipFilename();
  state.result = { url, filename };
  const video = $('#result-video');
  video.src = url;
  const link = $('#download-link');
  link.href = url;
  link.download = filename;
  $('#download-note').textContent = `ไฟล์ ${filename} เหลือโควตา ${state.me?.remaining ?? '-'} คลิปเดือนนี้`;
  updateQuotaUI();
  showScreen('done');
}

/* ---------- global wiring ---------- */

function bindOfflineBanner() {
  const banner = $('#offline-banner');
  const update = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function resetForSignOut() {
  state.me = null;
  state.scenes = null;
  state.storyboardSettings = null;
  state.ticket = null;
  state.audioCache.clear();
  updateQuotaUI();
}

function bindActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    switch (target.dataset.action) {
      case 'logout':
        await signOut();
        resetForSignOut();
        showLogin();
        break;
      case 'back-to-create':
        showCreate();
        break;
      case 'back-to-storyboard':
        showStoryboard();
        break;
      case 'new-clip':
        state.scenes = null;
        state.storyboardSettings = null;
        state.ticket = null;
        showCreate();
        break;
      default:
        break;
    }
  });
  $('#storyboard-button').addEventListener('click', requestStoryboard);
  $('#render-button').addEventListener('click', () => startRender());
  $('#cancel-render-button').addEventListener('click', () => state.render?.controller.abort());
  $('#sfx-switch').addEventListener('change', (event) => { state.form.sfxEnabled = event.target.checked; });
}

function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const hadParams = ['code', 'error', 'error_description', 'error_code'].some((key) => url.searchParams.has(key));
  const authError = url.searchParams.get('error');
  if (hadParams) {
    window.history.replaceState({}, document.title, url.pathname);
  }
  return authError;
}

async function init() {
  bindOfflineBanner();
  bindLogin();
  bindStageControls();
  bindPrompt();
  bindImages();
  bindCharacterSheet();
  bindActions();

  let config;
  try {
    config = await fetchPublicConfig();
  } catch (err) {
    showError({
      title: 'เปิดแอปไม่สำเร็จ',
      message: err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง',
      primary: { label: 'โหลดหน้าใหม่', action: () => window.location.reload() },
    });
    return;
  }

  initAuth(config);
  setAccessTokenProvider(getAccessToken);
  onSignedOut(() => {
    resetForSignOut();
    showLogin();
  });

  let session = null;
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  const authError = cleanAuthParamsFromUrl();
  if (!session) {
    showLogin(authError ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองอีกครั้ง' : '');
    return;
  }
  await startSignedIn();
}

init();
