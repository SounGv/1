import { requireUser } from './_lib/auth.js';
import { allowMethods, logServerError, sendError, sendJson } from './_lib/errors.js';
import { ensureProfile, getQuotaStatus } from './_lib/quota.js';
import { getServiceClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const supabase = getServiceClient();
    await ensureProfile(supabase, user);
    sendJson(res, 200, await getQuotaStatus(supabase, user.id));
  } catch (err) {
    logServerError('me', err);
    sendError(res, 500, 'server_error');
  }
}
