# 22 — Account Deletion (GDPR Article 17)

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🔴 Critical (legal compliance)
**Owner:** Marcello

## Purpose

GDPR Article 17 "right to erasure" + App Store Guideline 5.1.1(v) require an in-app account deletion path. Users delete from `/dashboard/account` (web) or Settings (iOS) → orchestrated cleanup across Stripe, Stream Chat, Supabase DB, and `auth.users`. Anonymized rows retained 30 days for accidental-delete recovery, then hard-purged by daily pg_cron.

The operation is one-way: once `delete-user-account` returns success, the user cannot log back in (auth.users deleted). During the 30-day retention window, an admin can manually restore via service-role UPDATE if the user contacts support.

This flow is co-documented with `01-auth.md` (which has the canonical deletion description in its "Account deletion" section). This file zooms in on the orchestration mechanics.

## Preconditions

- User authenticated.
- `delete-user-account` Edge Function deployed (see Known issues — function source lives in archived backup; binary deployed to Supabase project `bqyqkvkzkemiwyqjkbna`).
- DB RPC `public.delete_user_account()` deployed (migration `20260417150000_gdpr_erasure_pipeline.sql` + bugfix `20260417160000_gdpr_erasure_bugfix.sql`).
- pg_cron job `hard-purge-deleted-accounts` scheduled (daily 03:00 UTC).
- Stripe API key + Stream API secret available to the Edge Function.

## Sequence

### A. Web — `/dashboard/account` flow

`client-webapp/src/app/dashboard/account/page.tsx:166`

1. User clicks "Elimina account" (`page.tsx:419`). Two-step UI confirmation:
   - Open danger panel (`showDeleteConfirm=true`).
   - Type literal text "ELIMINA" into a confirmation input (`deleteConfirmText`).
   - Final button enabled only when match.
2. `handleDeleteAccount` (`page.tsx:166`):
   - Get session → require valid `access_token`.
   - POST `${SUPABASE_URL}/functions/v1/delete-user-account` with `Authorization: Bearer ${access_token}` (the user's own JWT).
   - On success: `supabase.auth.signOut()` to clear local cookies (Edge Function already invalidated server-side), `router.push('/login?account_deleted=1')`.
   - On error: surface message; user can retry or contact support.

### B. iOS — Settings flow

`iOS App/Holistic Unity/Data/Repositories/SupabaseAuthRepository.swift:163`

```swift
func deleteAccount() async throws {
    guard cachedUser != nil else { throw AuthError.unknown(...) }
    // Pre-Phase-5 code did this — DB RPC only, skipped Stripe/Stream cleanup
    try await client.rpc("delete_user_account").execute()
    cachedUser = nil
}
```

**Discrepancy vs web flow:** the iOS code currently calls the DB RPC `delete_user_account` directly (`SupabaseAuthRepository.swift:170`). This bypasses the Edge Function's external-service cleanup (Stripe customer delete, Stream Chat anonymize). The web flow goes through the Edge Function. Per the existing `01-auth.md`, iOS *should* be using the Edge Function — this is a known migration gap.

### C. `delete-user-account` Edge Function orchestration

(Source not in current local tree; binary deployed. Logic per `01-auth.md`):

1. Auth check — require valid user JWT.
2. Rate limit — 1 delete attempt per 5 min per user.
3. **Stripe** — `DELETE /v1/customers/{stripe_customer_id}` if a customer exists via `payment_methods.stripe_customer_id`. Detaches all cards; transaction history retained for audit (Stripe doesn't delete charges).
4. **Stream Chat** — `serverClient.deleteUser(userId, {mark_messages_deleted: true, hard_delete: false})`. Stream's recommended GDPR pattern: messages remain visible to the other party but show as "deleted user".
5. **Supabase DB** — invokes `public.delete_user_account()` RPC AS the user's JWT (security-definer + auth.uid check).
6. **auth.users** — admin API delete so the user cannot log in again.

Returns `{ ok, user_id, db, stripe, stream, auth }` — partial failures in Stripe/Stream are NON-fatal per GDPR Art 17 precedence; the user must be erased even if a downstream service is unreachable.

### D. `public.delete_user_account()` RPC

Migration `20260417150000_gdpr_erasure_pipeline.sql` (in archived backup):

1. Cancel in-flight bookings: `status IN ('pending', 'confirmed', 'reschedule_pending')`.
2. Re-point completed-booking `client_id` to **tombstone UUID `00000000-0000-0000-0000-000000000001`** so the therapist's history is preserved without leaking a deleted user's identity.
3. Redact review text to `[Deleted]` but keep `rating` (therapist aggregate must remain valid).
4. Delete: `session_credits`, `device_tokens`, `notification_preferences`, `notifications`, `conversation_participants`.
5. NULL PII columns on `users` row (display_name, photo_url, phone_number, etc.); set `deleted_at = now()` and `anonymized_at = now()`.
6. If user is also a therapist: anonymize `therapist_profiles` (set `display_name='[Deleted]'`, NULL bio/photo, `is_approved=false`, `approval_status='deleted'`).

The RPC is `SECURITY DEFINER` and explicitly checks `auth.uid() = target_user_id` so a user cannot delete someone else's account by passing a different ID.

### E. 30-day retention + hard purge

pg_cron `hard-purge-deleted-accounts` daily at 03:00 UTC:

```sql
DELETE FROM public.users WHERE deleted_at < now() - interval '30 days';
```

The cascade chain (FKs to `auth.users` + cleanup in the RPC step D) means most data is already gone. The hard purge removes the anonymized stub.

### F. Restore (admin manual)

Within the 30-day window, an admin can run a service-role UPDATE to restore PII columns AND remove the `deleted_at` flag. There's no admin UI for this — it's a manual support ticket → DB ops procedure. After day 30 the row is hard-deleted; restore is impossible.

## Critical assertions

- **Dual-pathway concern: iOS goes direct to DB RPC; web goes through Edge Function.** Per Phase 5 design, both should go through Edge Function for external-service cleanup. iOS migration is pending. **Current iOS deletion does NOT clean up Stripe customer or Stream Chat user.**
- **Tombstone UUID `00000000-0000-0000-0000-000000000001`** preserves therapist's session history without keeping the deleted user's identity. Inserted into the DB via the GDPR migration; cannot be deleted (FK `RESTRICT`). Reviews and bookings re-point to it, so therapist analytics remain valid.
- **Reviews retain `rating` but redact `text`.** Required for therapist's aggregate `average_rating` to remain stable post-deletion. Without rating retention, every deleted user's reviews would be erased and therapist scores would fluctuate retroactively.
- **GDPR precedence over downstream errors.** Even if Stripe DELETE fails (Stripe is down), the local DB anonymization MUST proceed. The Edge Function returns `{stripe: 'failed', ...}` but `db: 'ok'` and the user is removed from auth.users.
- **30-day retention is for accidental-delete recovery, NOT for legal hold.** Italian law requires longer audit retention for transactions (10 years) — those rows are anonymized but PRESERVED past 30 days via the tombstone-pointing pattern above. Only the user's profile row is hard-purged.
- **Rate limit 1 per 5 min per user** prevents accidental double-clicks AND a stolen-cookie attacker from rapidly issuing deletes.
- **Edge Function is service-role internally but accepts user JWT for auth.** The user proves they own the account; the function then escalates to service-role for the cleanup operations.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| User has active Stripe Connect (therapist) | Stripe customer delete | Connect account is NOT deleted (different endpoint); admin manually closes it later |
| Stream Chat 5xx | `deleteUser` call | Logged; flow continues (GDPR precedence) |
| DB RPC fails | `delete_user_account` | Edge Function returns 500; auth.users NOT deleted; user can retry |
| User has confirmed bookings in next 24h | RPC cancels them | Refund handling NOT done in RPC — admin must process manually (V1.1 to integrate) |
| User is a therapist with active payouts | Anonymized but Connect account remains | Future payouts go to a now-orphaned Connect account; admin closes manually |
| Network drop mid-flow | Partial state | User can retry; Edge Function is idempotent for already-deleted entities |
| User typed wrong confirmation | UI gate | Final button disabled until exact "ELIMINA" |

## Files

- `client-webapp/src/app/dashboard/account/page.tsx` — web entry point
- `iOS App/Holistic Unity/Data/Repositories/SupabaseAuthRepository.swift` — iOS path (currently RPC-only)
- Edge Function `delete-user-account` (deployed to Supabase project `bqyqkvkzkemiwyqjkbna`; source archived in `iOS App/untitled folder/Backup 6 Aprile/supabase/functions/delete-user-account/`)
- Migration `20260417150000_gdpr_erasure_pipeline.sql` — `public.delete_user_account()` RPC + tombstone UUID + cascade chain
- Migration `20260417160000_gdpr_erasure_bugfix.sql` — bugfixes to the RPC
- pg_cron `hard-purge-deleted-accounts` — registered in `iOS App/untitled folder/Backup 6 Aprile/supabase/migrations/...` (search for `hard_purge_deleted_accounts`)

## Recent fixes / known issues

- **iOS uses RPC directly, not Edge Function (KNOWN GAP).** Bypasses Stripe + Stream cleanup. Migration to Edge Function is pending. Workaround: admin manually closes Stripe customer + anonymizes Stream after iOS deletes.
- **`delete-user-account` Edge Function source archived (2026-04-25 reorg).** Function deployed to Supabase but source lives in `untitled folder/Backup 6 Aprile/supabase/functions/`. Move back to `iOS App/supabase/functions/delete-user-account/` to make it co-deployable. `01-auth.md` references the function as canonical; current local tree doesn't have it.
- **GDPR migrations live in archived backup (same reorg).** `20260417150000_gdpr_erasure_pipeline.sql` and `20260417160000_gdpr_erasure_bugfix.sql` are deployed to the Supabase project but the migration files are in `untitled folder/Backup 6 Aprile/supabase/migrations/`. Restore to the canonical migrations directory before any `supabase db push` to avoid re-running them.
- **30-day retention is not user-visible.** No "you have 30 days to undo this" message in the deletion confirmation UI; restore requires support ticket. V1.1 to add visibility.
- **Known gap:** no automatic refund of in-flight bookings on deletion. The RPC cancels them but doesn't trigger Stripe refunds. Admin processes per `19-admin-refund.md`.
- **Known gap:** no audit log entry for the user's own deletion (i.e. `deleted_by_self` flag). All anonymized rows look the same as if admin deleted them.
