import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Use ONLY from server contexts that have
 * already verified authority some other way (e.g. a JWT auth check via
 * the SSR client, or an HMAC token on a public endpoint).
 *
 * Bypasses RLS — handle with care. NEVER import from a client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
