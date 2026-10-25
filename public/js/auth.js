import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

let client = null;

export function initAuth({ supabaseUrl, supabaseAnonKey }) {
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function getSession() {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

export async function signInWithGoogle() {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  await client.auth.signOut();
}

export function onSignedOut(callback) {
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback();
  });
}
