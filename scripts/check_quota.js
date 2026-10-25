// Runs against the TEST Supabase project only (TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).
// Creates throwaway users under @quota-check.invalid and deletes them (and their rows) afterwards.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const pointsAtProduction = Boolean(url && process.env.SUPABASE_URL && url === process.env.SUPABASE_URL);

let skipReason = false;
if (!url || !serviceKey) skipReason = 'TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY not set';
if (pointsAtProduction) skipReason = 'TEST_SUPABASE_URL equals SUPABASE_URL; refusing to run against production';

const supabase = skipReason
  ? null
  : createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const createdUserIds = [];

async function createTestUser(quota) {
  const email = `quota-${randomUUID()}@quota-check.invalid`;
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;
  createdUserIds.push(userId);
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ user_id: userId, email, display_name: 'quota check', monthly_quota: quota });
  if (profileError) throw profileError;
  return userId;
}

async function issueTicket(userId) {
  return supabase.rpc('issue_render_ticket', { p_user: userId });
}

async function countTickets(userId) {
  const { count, error } = await supabase
    .from('render_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count;
}

describe('quota and render tickets (test project)', { skip: skipReason }, () => {
  before(() => {
    assert.ok(supabase);
  });

  after(async () => {
    for (const userId of createdUserIds) {
      // Deleting the auth user cascades to profiles, render_tickets and storyboard_calls.
      await supabase.auth.admin.deleteUser(userId);
    }
  });

  test('quota 10: tickets 1-10 succeed, ticket 11 is quota_exceeded', async () => {
    const userId = await createTestUser(10);
    for (let i = 1; i <= 10; i += 1) {
      const { data, error } = await issueTicket(userId);
      assert.equal(error, null, `ticket ${i} should be issued`);
      assert.match(data, /^[0-9a-f-]{36}$/);
    }
    const { error } = await issueTicket(userId);
    assert.ok(error, 'ticket 11 should fail');
    assert.match(error.message, /quota_exceeded/);
    assert.equal(await countTickets(userId), 10);
  });

  test('one ticket left and 5 concurrent requests: exactly one succeeds', async () => {
    const userId = await createTestUser(1);
    const results = await Promise.all(Array.from({ length: 5 }, () => issueTicket(userId)));
    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    assert.equal(succeeded.length, 1);
    assert.equal(failed.length, 4);
    for (const r of failed) assert.match(r.error.message, /quota_exceeded/);
    assert.equal(await countTickets(userId), 1);
  });

  test('consume_tts_call reuses the same ticket and rejects call 25', async () => {
    const userId = await createTestUser(10);
    const { data: ticketId, error } = await issueTicket(userId);
    assert.equal(error, null);
    for (let i = 1; i <= 24; i += 1) {
      const { error: callError } = await supabase.rpc('consume_tts_call', { p_ticket: ticketId, p_user: userId });
      assert.equal(callError, null, `tts call ${i} should be allowed`);
    }
    assert.equal(await countTickets(userId), 1, 'tts calls must not create tickets');
    const { error: overLimit } = await supabase.rpc('consume_tts_call', { p_ticket: ticketId, p_user: userId });
    assert.ok(overLimit, 'tts call 25 should fail');
    assert.match(overLimit.message, /ticket_invalid/);
  });

  test('a ticket cannot be used by another user', async () => {
    const owner = await createTestUser(10);
    const other = await createTestUser(10);
    const { data: ticketId } = await issueTicket(owner);
    const { error } = await supabase.rpc('consume_tts_call', { p_ticket: ticketId, p_user: other });
    assert.ok(error);
    assert.match(error.message, /ticket_invalid/);
  });

  test('an expired ticket is rejected', async () => {
    const userId = await createTestUser(10);
    const { data: ticketId } = await issueTicket(userId);
    const { error: updateError } = await supabase
      .from('render_tickets')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', ticketId);
    assert.equal(updateError, null);
    const { error } = await supabase.rpc('consume_tts_call', { p_ticket: ticketId, p_user: userId });
    assert.ok(error);
    assert.match(error.message, /ticket_invalid/);
  });
});

if (skipReason) {
  console.log(`check:quota skipped: ${skipReason}`);
}
