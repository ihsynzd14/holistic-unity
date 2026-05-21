# Holistic Unity — Database Schema Reference

**Database:** PostgreSQL (Supabase-hosted)
**Project:** `bqyqkvkzkemiwyqjkbna`
**Migration File:** `supabase_migration.sql`
**Last Applied:** March 25, 2026

---

## Tables (15)

### 1. users
Core user accounts, linked to `auth.users` via CASCADE.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | References auth.users(id) |
| email | text | |
| display_name | text | Default: '' |
| photo_url | text | |
| phone_number | text | |
| role | text | 'client' or 'therapist' |
| city | text | |
| country | text | |
| latitude | double precision | |
| longitude | double precision | |
| auth_provider | text | 'email', 'apple', 'google' |
| is_email_verified | boolean | |
| preferred_languages | text[] | Default: {"English"} |
| fcm_token | text | |
| stripe_customer_id | text | Added for Stripe payments |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-updated by trigger |

### 2. therapist_profiles
Extended profile for therapist users.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | References users(id) |
| display_name | text | |
| tagline | text | |
| bio | text | |
| photo_url | text | |
| years_experience | integer | |
| categories | text[] | Therapy types offered |
| languages | text[] | |
| video_intro_url | text | |
| gallery_image_urls | text[] | |
| availability | jsonb | Schedule data |
| cancellation_policy | text | 'flexible' default |
| currency | text | 'usd' default |
| city, country, latitude, longitude | various | Location |
| average_rating | double precision | Auto-calculated by trigger |
| total_reviews | integer | Auto-calculated by trigger |
| profile_completeness | integer | 0-100 |
| is_verified | boolean | Admin-controlled |
| is_approved | boolean | Admin-controlled |
| approval_status | text | draft → pending_review → approved / changes_requested |
| stripe_connected_account_id | text | Stripe Connect account |
| stripe_account_status | text | not_connected → onboarding_pending → active / restricted |
| created_at, updated_at | timestamptz | |

### 3. therapist_services

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| therapist_id | uuid (FK) | |
| name | text | Service name |
| description | text | |
| duration | integer | Minutes (default 60) |
| price | double precision | |
| format | text | 'virtual', 'in_person', 'both' |
| category | text | |
| is_intro_call | boolean | Free intro call flag |
| pack_size | integer | Session pack quantity |
| pack_price | double precision | Discounted pack price |

### 4. certifications

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| therapist_id | uuid (FK) | |
| name | text | |
| issuing_organization | text | |
| year_obtained | integer | |
| document_url | text | Stored in 'certificates' bucket |
| is_verified | boolean | Admin-controlled |

### 5. bookings

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| client_id | uuid (FK) | |
| therapist_id | uuid (FK) | |
| service_id | uuid (FK) | |
| service_name | text | Denormalized |
| duration | integer | |
| price | double precision | |
| scheduled_at | timestamptz | |
| timezone | text | |
| format | text | virtual/in_person/both |
| status | text | pending → confirmed → in_progress → completed/cancelled/no_show/reschedule_pending |
| cancellation_reason | text | |
| video_room_id | text | LiveKit room |
| stripe_payment_intent_id | text | |
| platform_fee | double precision | |
| therapist_payout | double precision | |
| promo_code | text | |
| discount | double precision | |
| proposed_scheduled_at | timestamptz | For reschedule flow |
| reschedule_count | integer | |
| created_at, updated_at | timestamptz | |

### 6. conversations

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| last_message_text | text | |
| last_message_sender_id | uuid | |
| last_message_timestamp | timestamptz | |
| last_message_type | text | |
| created_at, updated_at | timestamptz | |

### 7. conversation_participants

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| conversation_id | uuid (FK) | |
| user_id | uuid (FK) | |
| unread_count | integer | |
| UNIQUE(conversation_id, user_id) | | |

### 8. messages

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| conversation_id | uuid (FK) | Indexed |
| sender_id | uuid (FK) | |
| type | text | text/image/voice/session_link/system |
| text_content | text | |
| media_url | text | |
| media_duration | double precision | For voice messages |
| booking_id | uuid (FK) | Optional link to booking |
| read_at | timestamptz | |
| is_deleted | boolean | Soft delete |
| created_at | timestamptz | Indexed |

### 9. reviews

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| booking_id | uuid (FK) | |
| client_id | uuid (FK) | |
| therapist_id | uuid (FK) | Indexed |
| client_name | text | Denormalized |
| client_photo_url | text | |
| rating | integer | 1-5 |
| text | text | |
| therapist_reply | text | |
| therapist_reply_date | timestamptz | |
| is_flagged | boolean | |
| created_at | timestamptz | |

### 10. notifications

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK) | Indexed |
| type | text | Default 'promotional' |
| title | text | |
| body | text | |
| booking_id | uuid (FK) | Optional |
| conversation_id | uuid (FK) | Optional |
| therapist_id | uuid (FK) | Optional |
| client_id | uuid (FK) | Optional |
| is_read | boolean | |
| created_at | timestamptz | |

### 11. device_tokens

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK) | Indexed |
| token | text | APNs token |
| platform | text | 'ios' |
| created_at | timestamptz | |
| UNIQUE(user_id, token) | | |

### 12. user_notification_preferences

| Column | Type | Notes |
|---|---|---|
| user_id | uuid (PK, FK) | |
| push_enabled | boolean | Master toggle |
| push_booking_reminders | boolean | |
| push_new_messages | boolean | |
| push_session_reminders | boolean | |
| push_promotional | boolean | Default false |
| updated_at | timestamptz | |

### 13. transactions

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| booking_id | uuid (FK) | Indexed |
| client_id | uuid (FK) | Indexed |
| therapist_id | uuid (FK) | Indexed |
| amount | double precision | |
| platform_fee | double precision | 20% |
| therapist_payout | double precision | 80% |
| currency | text | |
| status | text | pending/processing/completed/failed/refunded/partially_refunded |
| stripe_payment_intent_id | text | |
| refund_amount | double precision | |
| created_at, updated_at | timestamptz | |

### 14. payment_methods

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK) | Indexed |
| stripe_payment_method_id | text | |
| brand | text | visa, mastercard, etc. |
| last4 | text | |
| expiry_month | integer | |
| expiry_year | integer | |
| is_default | boolean | |
| created_at | timestamptz | |

### 15. user_display_info (VIEW)

```sql
SELECT id, display_name, photo_url, role, city, country FROM public.users;
```

---

## Status Flows

```
therapist_profiles.approval_status:
  draft → pending_review → approved
                         → changes_requested

therapist_profiles.stripe_account_status:
  not_connected → onboarding_pending → active
                                     → restricted

bookings.status:
  pending → confirmed → in_progress → completed
                                    → cancelled
                                    → no_show
         → reschedule_pending

transactions.status:
  pending → processing → completed
                       → failed
                       → refunded
                       → partially_refunded
```

---

## Triggers (11)

| Trigger | Table | Event | Purpose |
|---|---|---|---|
| on_auth_user_created | auth.users | INSERT | Auto-create public.users row |
| set_users_updated_at | users | UPDATE | Auto-update updated_at |
| set_therapist_profiles_updated_at | therapist_profiles | UPDATE | Auto-update updated_at |
| set_bookings_updated_at | bookings | UPDATE | Auto-update updated_at |
| set_conversations_updated_at | conversations | UPDATE | Auto-update updated_at |
| set_transactions_updated_at | transactions | UPDATE | Auto-update updated_at |
| on_review_inserted | reviews | INSERT | Recalculate therapist rating |
| on_review_updated | reviews | UPDATE | Recalculate therapist rating |
| protect_therapist_admin_columns_trigger | therapist_profiles | UPDATE | Block non-admin edits |
| protect_review_columns_trigger | reviews | UPDATE | Block therapist from editing reviews |
| send_push_on_notification_insert | notifications | INSERT | Call push Edge Function via pg_net |

---

## Extensions Required
- `uuid-ossp` — UUID generation
- `pg_net` — HTTP requests from database triggers

---

## Storage Buckets (4)

| Bucket | Public | Purpose |
|---|---|---|
| profile-photos | Yes | User profile images |
| certificates | Yes | Therapist certification docs |
| chat-media | No | Chat images, voice messages |
| video-intros | Yes | Therapist intro videos |
