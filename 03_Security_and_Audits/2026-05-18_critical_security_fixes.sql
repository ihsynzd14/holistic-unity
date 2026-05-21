-- ════════════════════════════════════════════════════════════
-- SECURITY FIX 2026-05-18 — block anon read of PII columns
-- on therapist_profiles + tos_acceptances_latest view.
-- Findings from external audit:
--   • therapist_profiles leaked Italian codice_fiscale, p_iva,
--     pec_email, stripe_connected_account_id of all therapists
--   • tos_acceptances_latest leaked user UUIDs + IP addresses
-- Approach: granular GRANT (column-level), non-destructive.
-- ════════════════════════════════════════════════════════════

-- F1: therapist_profiles — revoke anon SELECT, regrant only safe columns.
-- Excluded (PII / business-sensitive, stay private):
--   stripe_connected_account_id, stripe_account_status, stripe_country,
--   p_iva, codice_fiscale, codice_destinatario, pec_email,
--   billing_address, billing_email, tax_id_foreign, vat_number,
--   vat_validated_at, regime_forfettario, fic_client_id,
--   email_notifications, last_billing_reminder_at, updated_at
REVOKE SELECT ON public.therapist_profiles FROM anon;
GRANT SELECT (
  id, display_name, photo_url, bio, tagline, helps_with,
  city, country, latitude, longitude,
  categories, languages, availability,
  average_rating, total_reviews,
  years_experience, has_mfa, is_verified, is_approved,
  profile_completeness, gallery_image_urls,
  video_intro_url, currency, cancellation_policy, approval_status,
  created_at
) ON public.therapist_profiles TO anon;

-- F2: tos_acceptances_latest view — no client app queries it. Revoke anon.
REVOKE SELECT ON public.tos_acceptances_latest FROM anon;
GRANT SELECT ON public.tos_acceptances_latest TO authenticated;

-- Verify (paranoid double-check the underlying table also has RLS)
ALTER TABLE public.tos_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ta_self_read ON public.tos_acceptances;
CREATE POLICY ta_self_read ON public.tos_acceptances
  FOR SELECT USING (auth.uid() = user_id);
