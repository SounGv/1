import { requireUser } from './_lib/auth.js';
import { allowMethods, logServerError, rpcErrorCode, sendError, sendJson } from './_lib/errors.js';
import { ensureProfile, getQuotaStatus, nextThaiMonthStartIso } from './_lib/quota.js';
import { getServiceClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const supabase = getServiceClient();
    await ensureProfile(supabase, user);

    const { data: ticketId, error } = await supabase.rpc('issue_render_ticket', { p_user: user.id });
    if (error) {
      if (rpcErrorCode(error) === 'quota_exceeded') {
        sendError(res, 403, 'quota_exceeded', undefined, { resetAt: nextThaiMonthStartIso() });
        return;
      }
      throw Object.assign(new Error('issue ticket failed'), { code: 'issue_ticket' });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from('render_tickets')
      .select('expires_at')
      .eq('id', ticketId)
      .single();
    if (ticketError) throw Object.assign(new Error('ticket read failed'), { code: 'ticket_read' });

    const { remaining } = await getQuotaStatus(supabase, user.id);
    sendJson(res, 200, { ticketId, expiresAt: ticket.expires_at, remaining });
  } catch (err) {
    logServerError('render-ticket', err);
    sendError(res, 500, 'server_error');
  }
}
