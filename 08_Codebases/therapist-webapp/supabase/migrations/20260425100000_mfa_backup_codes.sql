-- 2026-04-25: MFA backup codes + MFA audit log
-- Enables self-recovery for therapists who lose their authenticator device.
-- Both tables are RLS deny-all; only service_role accesses them via API routes.

CREATE TABLE IF NOT EXISTS public.mfa_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_unused_idx
  ON public.mfa_backup_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all for authenticated/anon. Service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.mfa_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN (
    'enrolled',
    'verified',
    'disabled',
    'backup_code_used',
    'backup_codes_regenerated',
    'admin_override'
  )),
  ip          inet,
  user_agent  text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_audit_log_user_created_idx
  ON public.mfa_audit_log (user_id, created_at DESC);

ALTER TABLE public.mfa_audit_log ENABLE ROW LEVEL SECURITY;
-- Same: deny-all for authenticated/anon.
