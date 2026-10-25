import { createClient } from '@supabase/supabase-js';

let serviceClient = null;

/** Service-role client. Server-side only: bypasses RLS. */
export function getServiceClient() {
  if (serviceClient) return serviceClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Supabase server env is not configured');
    err.code = 'env_missing';
    throw err;
  }
  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return serviceClient;
}
