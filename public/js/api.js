const NETWORK_MESSAGE = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง';

const STATUS_MESSAGES = {
  413: 'ข้อมูลที่ส่งมาใหญ่เกินไป ลองลดจำนวนภาพแล้วส่งใหม่',
  504: 'ระบบใช้เวลานานเกินไป ยังไม่มีการหักโควตา ลองอีกครั้งได้เลย',
};

export class ApiError extends Error {
  constructor({ status, code, message, data }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data || {};
  }
}

let getAccessToken = async () => null;

export function setAccessTokenProvider(provider) {
  getAccessToken = provider;
}

async function request(path, { method = 'GET', body, signal, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getAccessToken();
    if (!token) throw new ApiError({ status: 401, code: 'unauthorized', message: 'กรุณาเข้าสู่ระบบอีกครั้ง แล้วลองใหม่' });
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'network', message: NETWORK_MESSAGE });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: data?.error || 'server_error',
      message: data?.message || STATUS_MESSAGES[response.status] || 'ระบบขัดข้องชั่วคราว ลองอีกครั้งในอีกสักครู่',
      data,
    });
  }
  return data;
}

export const fetchPublicConfig = () => request('/api/config', { auth: false });
export const fetchMe = () => request('/api/me');
export const createStoryboard = (payload, signal) => request('/api/storyboard', { method: 'POST', body: payload, signal });
export const createRenderTicket = (signal) => request('/api/render-ticket', { method: 'POST', signal });
export const synthesizeSpeech = (payload, signal) => request('/api/tts', { method: 'POST', body: payload, signal });
