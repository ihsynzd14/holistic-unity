# Data Model

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Current (post migration `20260416100000_therapist_services_is_active`)
**Owner:** Marcello

> **Source of truth:** the live Supabase DB (`bqyqkvkzkemiwyqjkbna`). Migration files in `supabase/migrations/` should match. Base schema in `supabase_migration.sql` (legacy snapshot).

## Tables (11 public tables with RLS — 12 if counting the `users` tombstone row `00000000-0000-0000-0000-000000000001`, a reserved placeholder for anonymized deleted accounts)

### `users`
Stores all accounts (client, therapist, admin).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, matches `auth.users.id` |
| `email` | TEXT | Unique |
| `role` | TEXT | `client` / `therapist` / `admin` |
| `display_name` | TEXT | |
| `photo_url` | TEXT | |
| `phone_number` | TEXT | |
| `city`, `country` | TEXT | `country` added 2026-04-16 |
| `preferred_languages` | TEXT[] | |
| `experience_level`, `intention` | TEXT | client only |
| `birth_date`, `birth_time`, `birth_place` | TEXT | optional for astrology clients |
| `has_skipped_birth_data` | BOOL | NOT NULL, default false |
| `latitude`, `longitude` | DOUBLE PRECISION | client-coarse location (IP-derived, optional) |
| `auth_provider` | TEXT | NOT NULL, `'email'` / `'apple'` / `'google'` |
| `is_email_verified` | BOOL | NOT NULL |
| `fcm_token` | TEXT | push token mirror (primary source is `device_tokens`) |
| `stripe_customer_id` | TEXT | set by Stripe on first payment method attach |
| `marketing_consent`, `marketing_consent_date` | BOOL / TIMESTAMPTZ | GDPR opt-in |
| `is_admin` | BOOL | Default false; migration `20260417120000`; `_guard_user_is_admin_updates` trigger blocks client-side flips |
| `deleted_at`, `anonymized_at` | TIMESTAMPTZ | Soft-delete markers; migration `20260417150000`; `hard_purge_deleted_accounts()` hard-deletes after 30 days |

### `therapist_profiles`
Extends `users` for therapist-specific data. `id` = user id (1-1).

Key columns: `display_name`, `tagline`, `bio`, `photo_url`, `city`, `country`, `years_experience`, `categories TEXT[]`, `languages TEXT[]`, `video_intro_url`, `gallery_image_urls TEXT[]`, `currency`, `vat_number`, `is_verified`, `is_approved`, `approval_status`, `profile_completeness`, `average_rating`, `total_reviews`, `stripe_connected_account_id`, `stripe_account_status`, `cancellation_policy`, `availability JSONB`.

`availability` JSONB structure:
```json
{
  "timezone": "Europe/Rome",
  "minNoticeHours": 2,
  "bufferMinutes": 15,
  "recurring": { "monday": [["09:00", "18:00"]], ... },
  "exceptions": [{ "date": "2026-05-01", "slots": [] }]
}
```

### `therapist_services`
Services offered by each therapist.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `therapist_id` | UUID | FK → therapist_profiles.id |
| `name`, `description` | TEXT | |
| `duration` | INT | Minutes (15/30/45/60/75/90/120) |
| `price` | DOUBLE | Must be ≥ 0 (CHECK) |
| `category` | TEXT | TherapyCategory raw or dashboard label (see `SupabaseDTOs.swift:mapCategory`) |
| `is_intro_call` | BOOL | Free first-contact call |
| `is_active` | BOOL | Default true, added 2026-04-16; **iOS filters is_active=true on all reads** |
| `pack_size` | INT? | 4/6/8/10 or null |
| `pack_price` | DOUBLE? | Per-session price in pack |

Index: `idx_therapist_services_active` on `(therapist_id, is_active) WHERE is_active = true`.

### `certifications`
| `therapist_id`, `name`, `issuing_organization`, `year_obtained`, `is_verified` (admin-only) |

### `bookings`
Core transactional table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `client_id`, `therapist_id`, `service_id` | UUID | FKs |
| `scheduled_at`, `duration` | TIMESTAMPTZ / INT | |
| `status` | TEXT | `pending`/`confirmed`/`in_progress`/`completed`/`cancelled`/`reschedule_pending` |
| `price`, `therapist_payout`, `platform_fee`, `processing_fee`, `iva_amount` | NUMERIC | |
| `pack_sessions_remaining` | INT? | Only on pack-purchase booking |
| `credit_id` | UUID? | Link to session_credits when used |
| `stripe_payment_intent_id` | TEXT | |
| `cancellation_reason` | TEXT | |
| `video_room_id` | TEXT | Deterministic per booking (salted) |

Triggers / guards:
- `bookings_overlap_guard` (migration `20260414_booking_overlap_guard`) — prevents double-booking
- `protect_booking_financial_columns` — disallow client updates to price/payout
- `price_non_negative` CHECK

### `transactions`
Financial audit trail — every Stripe payment/refund.

Columns: `id`, `booking_id`, `user_id` (client), `therapist_id`, `amount`, `total_charged`, `commission_base`, `platform_fee`, `processing_fee`, `therapist_payout`, `iva_amount`, `iva_applied`, `service_fee`, `therapist_country`, `currency`, `status` (`pending`/`completed`/`refunded`/`failed`), `stripe_payment_intent_id` (UNIQUE partial index), `stripe_charge_id`, `stripe_refund_id`, `payout_status`, `payout_after`, `stripe_connected_account_id`, `stripe_transfer_id`, `created_at`.

### `session_credits`
Pack credits tracking.

Columns: `id`, `client_id`, `therapist_id`, `service_id`, `pack_booking_id` (source booking), `total_sessions`, `sessions_remaining` (CHECK ≥ 0 via RPC), `expires_at` (unused V1), `created_at`.

### `conversations` + `conversation_participants` + `messages`
Stream Chat mirrors channel metadata here for RLS. Media lives in `chat-media` storage bucket.

### `notifications`
In-app notifications. `user_id`, `type`, `title`, `body`, `data JSONB`, `is_read`, `created_at`.

Insert restricted to `service_role` (post migration `20260415_security_hardening`).

### `reviews`
`booking_id` UNIQUE, `client_id`, `therapist_id`, `rating` (1-5 CHECK), `text`, `therapist_reply`, `therapist_reply_date`, `created_at`.

Trigger recomputes `therapist_profiles.average_rating` + `total_reviews` on insert.

### `therapist_calendar_integrations`
`(therapist_id, provider)` composite PK. `access_token`, `refresh_token`, `token_expires_at`, `calendar_email`, `calendar_id`, `connected_at`.

### `device_tokens`
Push notification registration. `(user_id, token)` UNIQUE. `platform` (`ios`/`android`/`web`).

## Storage buckets

| Bucket | Public | Contents |
|--------|--------|----------|
| `profile-photos` | ✅ | Avatar + gallery (`${userId}/avatar.{ext}`, `${userId}/gallery/${uuid}.{ext}`) |
| `certificates` | ❌ | Uploaded PDFs/images per therapist |
| `chat-media` | ❌ | RLS-scoped to conversation participants |
| `video-intros` | ✅ | Optional video uploads (currently URL-only) |

## RPC functions

All SECURITY DEFINER, `SET search_path = ''` (verified 2026-04-17 — see `security.md` "Database function hardening").

| RPC | Purpose |
|-----|---------|
| `create_booking_with_credit` | Atomic: decrement session_credits + insert booking (migration `20260414100200`) |
| `use_session_credit` | Decrement with lock; raises if ≤ 0 |
| `restore_session_credit` | Increment on cancellation |
| `cleanup_orphaned_bookings` | Cron cleanup of old `pending` bookings (migration `20260412100000`) |
| `cleanup_stale_reschedule_pending` | Cron auto-cancel of `reschedule_pending` bookings whose original `scheduled_at` has passed by > 1 h (migration `20260416130000`) |
| `delete_user_account` | GDPR right-to-erasure — soft-delete + PII anonymization (returns `{bookings_cancelled, reviews_redacted, credits_deleted}` JSON; **invoke via `delete-user-account` edge function** which orchestrates Stripe + Stream cleanup first) |
| `hard_purge_deleted_accounts` | Cron job running daily at 03:00 UTC — permanently deletes `users` rows whose `deleted_at` > 30 days (migration `20260417150000`) |
| `is_admin` | Returns `true` if `auth.uid()` is marked `users.is_admin = true` (migration `20260417120000`) |
| `check_rate_limit(key, max, window_sec)` | Atomic fixed-window counter; returns `{count, limited}` — backs distributed rate limiter (migration `20260417130000`) |
| `cleanup_rate_limit_buckets` | Cron cleanup of expired rate-limit rows every 10 minutes |
| `handle_new_user` | Trigger on `auth.users` insert; creates matching `public.users` row |
| `submit_therapist_profile_for_review` | State-machine transition `draft → pending_review` |
| `get_conversation_participants_for_user` | Used by Stream Chat SDK integration |
| `get_or_create_conversation` | Ensures a single conversation per (client, therapist) pair |
| `increment_unread_count` | Updates `conversation_participants.unread_count` atomically |
| `trigger_push_notification` | pg_net HTTP call to `send-push-notification` edge function |
| `refresh_therapist_rating_stats` / `..._trigger` | Recomputes `therapist_profiles.average_rating` + `total_reviews` after review insert/update |
| `update_therapist_rating` | Manual recompute helper |
| `validate_review_booking` | Trigger that enforces 1 review per booking + status=completed |
| `prevent_overlapping_active_bookings` | Trigger that rejects new bookings overlapping an existing confirmed slot |
| `protect_booking_columns` / `protect_stripe_financial_columns` | Triggers that block client-side updates of financial fields (price, payout, Stripe IDs) |
| `_guard_user_is_admin_updates` | Trigger that blocks non-admin updates to `users.is_admin` |

### pg_cron scheduled jobs

| Name | Cadence | RPC |
|------|---------|-----|
| `cleanup-orphaned-bookings` | every 15 min | `cleanup_orphaned_bookings()` |
| `cleanup-stale-reschedule-pending` | every 30 min | `cleanup_stale_reschedule_pending()` |
| `cleanup-rate-limit-buckets` | every 10 min | `cleanup_rate_limit_buckets()` |
| `hard-purge-deleted-accounts` | daily 03:00 UTC | `hard_purge_deleted_accounts()` — hard-deletes `users` rows where `deleted_at < NOW() - INTERVAL '30 days'` (keeps tombstone row `00000000-0000-0000-0000-000000000001`) |

## Migrations

Located at `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. Must be **additive, idempotent, reversible**.

Current count: 27 migrations (through `20260417160000_gdpr_erasure_bugfix`).

Recent additions (2026-04-17 pre-TestFlight security hardening):

- `20260417120000_admin_role` — `users.is_admin` column, `public.is_admin()` RPC, admin-scoped RLS policies, `_guard_user_is_admin_updates` trigger
- `20260417130000_pg_rate_limit` — `rate_limit_buckets` table, `check_rate_limit()` + `cleanup_rate_limit_buckets()` RPCs, pg_cron schedule
- `20260417140000_search_path_audit` — `ALTER FUNCTION ... SET search_path = ''` on 5 previously vulnerable SECURITY DEFINER functions
- `20260417150000_gdpr_erasure_pipeline` — `users.deleted_at` + `anonymized_at` columns, soft-delete + tombstone pattern, `hard_purge_deleted_accounts()` cron (daily 03:00 UTC), replaced hard-delete `delete_user_account()` with soft-delete variant returning cleanup counts
- `20260417160000_gdpr_erasure_bugfix` — follow-up after DB-level E2E test found 4 bugs: (a) `protect_booking_columns` trigger refused client cancel from `reschedule_pending` (now allowed); (b) trigger refused `client_id` re-point (now bypassed via `set_config('request.jwt.claim.role','service_role',true)` inside `delete_user_account`); (c) anonymization UPDATE referenced non-existent columns (`interests`, `budget_tier`, `birth_city`) — now uses real live-schema columns; (d) NOT-NULL columns (`display_name`, `preferred_languages`) cannot be NULLed — now use sentinel values `'[Deleted]'`, empty array.

Previous notes:

- **2026-04-16:** `format` column removed from both `bookings` and `therapist_services`. Platform is virtual-only V1. RPC `create_booking_with_credit` signature updated to drop `p_format`.
- **2026-04-16:** `users` RLS tightened — two permissive SELECT policies dropped, replaced with relationship-scoped policy.

## Known gaps

- Schema snapshot `supabase_schema.sql` (at repo root) is stale — DO NOT use for reference; check migrations folder instead
- No `EXPLAIN ANALYZE` baseline for common queries (future: track slow queries)
- Some TIMESTAMPTZ columns stored as TEXT historically — DTO parsing is tolerant (see `SupabaseDTOs.swift`)
- Booking status is TEXT not ENUM (allows typos in service-role code)
