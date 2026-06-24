import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client using the service_role key.
 * NEVER import this in client components — server-side only (API routes, server actions).
 * Bypasses RLS for admin operations (e.g. approving therapists).
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
