import { getServiceClient } from './supabase.js';
import { sendError, logServerError } from './errors.js';

function readBearerToken(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Verifies the Supabase access token and returns the user.
 * Sends 401 (or 500) and returns null when the request must stop.
 */
export async function requireUser(req, res) {
  const token = readBearerToken(req);
  if (!token) {
    sendError(res, 401, 'unauthorized');
    return null;
  }
  try {
    const { data, error } = await getServiceClient().auth.getUser(token);
    if (error || !data?.user) {
      sendError(res, 401, 'unauthorized');
      return null;
    }
    return data.user;
  } catch (err) {
    logServerError('auth', err);
    sendError(res, 500, 'server_error');
    return null;
  }
}
