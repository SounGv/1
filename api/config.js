import { allowMethods, sendError, sendJson } from './_lib/errors.js';

export default function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    sendError(res, 500, 'server_error');
    return;
  }
  sendJson(res, 200, { supabaseUrl, supabaseAnonKey });
}
