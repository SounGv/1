const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokParts(now) {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** Same value as public.thai_month_key() in the database. Thailand has no DST. */
export function thaiMonthKey(now = new Date()) {
  const { year, month } = bangkokParts(now);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** First day of next month, 00:00 Thai time, as ISO with +07:00 offset. */
export function nextThaiMonthStartIso(now = new Date()) {
  const { year, month } = bangkokParts(now);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`;
}

export async function ensureProfile(supabase, user) {
  const meta = user.user_metadata || {};
  const { error } = await supabase.from('profiles').upsert(
    {
      user_id: user.id,
      email: user.email ?? null,
      display_name: meta.full_name || meta.name || null,
    },
    { onConflict: 'user_id', ignoreDuplicates: true },
  );
  if (error) throw Object.assign(new Error('profile upsert failed'), { code: 'profile_upsert' });
}

export async function getQuotaStatus(supabase, userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, display_name, monthly_quota')
    .eq('user_id', userId)
    .single();
  if (profileError || !profile) throw Object.assign(new Error('profile read failed'), { code: 'profile_read' });

  const { count, error: countError } = await supabase
    .from('render_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('month_key', thaiMonthKey());
  if (countError) throw Object.assign(new Error('ticket count failed'), { code: 'ticket_count' });

  const used = count ?? 0;
  return {
    email: profile.email,
    displayName: profile.display_name,
    monthlyQuota: profile.monthly_quota,
    used,
    remaining: Math.max(0, profile.monthly_quota - used),
    resetAt: nextThaiMonthStartIso(),
  };
}
