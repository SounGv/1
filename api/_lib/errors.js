const DEFAULT_MESSAGES = {
  unauthorized: 'กรุณาเข้าสู่ระบบอีกครั้ง แล้วลองใหม่',
  method_not_allowed: 'คำขอนี้ไม่รองรับ',
  invalid_input: 'ข้อมูลที่ส่งมาไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง',
  payload_too_large: 'ข้อมูลที่ส่งมาใหญ่เกินไป ลองลดจำนวนภาพแล้วส่งใหม่',
  rate_limited: 'สร้างสตอรีบอร์ดครบ 10 ครั้งในชั่วโมงนี้แล้ว รอสักครู่แล้วลองใหม่ ไม่มีการหักโควตา',
  content_refused: 'สร้างสตอรีบอร์ดจากเรื่องนี้ไม่ได้ ลองปรับเนื้อเรื่องแล้วส่งใหม่',
  storyboard_invalid: 'สร้างสตอรีบอร์ดไม่สำเร็จ ยังไม่มีการหักโควตา ลองกดสร้างอีกครั้งได้เลย',
  ai_unavailable: 'ระบบสร้างสตอรีบอร์ดไม่ตอบสนองตอนนี้ ยังไม่มีการหักโควตา ลองอีกครั้งในอีกสักครู่',
  quota_exceeded: 'ใช้โควตาเดือนนี้ครบแล้ว',
  ticket_invalid: 'ตั๋วเรนเดอร์หมดอายุหรือใช้ครบแล้ว กลับไปที่สตอรีบอร์ดแล้วกดสร้างคลิปใหม่',
  tts_failed: 'สร้างเสียงพูดไม่สำเร็จ โควตาของคุณยังไม่ถูกหักเพิ่ม ลองอีกครั้งได้เลย',
  server_error: 'ระบบขัดข้องชั่วคราว ลองอีกครั้งในอีกสักครู่',
};

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, {
    error: code,
    message: message || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES.server_error,
    ...extra,
  });
}

export function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  sendError(res, 405, 'method_not_allowed');
  return false;
}

/** Logs only the error kind, never user content or secrets. */
export function logServerError(where, err) {
  const kind = err && (err.code || err.name) ? `${err.code || err.name}` : 'unknown';
  console.error(`[${where}] ${kind}`);
}

/** Supabase RPC errors carry the plpgsql `raise exception` text in `message`. */
export function rpcErrorCode(error) {
  const text = `${error?.message || ''}`;
  for (const code of ['quota_exceeded', 'profile_missing', 'ticket_invalid', 'rate_limited']) {
    if (text.includes(code)) return code;
  }
  return null;
}
