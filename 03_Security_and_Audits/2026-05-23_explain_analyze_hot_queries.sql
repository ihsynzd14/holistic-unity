-- ════════════════════════════════════════════════════════════
-- PERFORMANCE AUDIT 2026-05-23 — EXPLAIN ANALYZE delle 3 hot query
--
-- Le 3 funzioni Swift della task list (riga 180) non sono Postgres
-- RPC ma composite query costruite dal client (`SupabaseTherapistRepository.swift`
-- e `SupabaseBookingRepository.swift`). Sotto il SQL effettivo che
-- PostgREST genera per ognuna.
--
-- COSA CERCARE nell'output:
--   ✅ "Index Scan using <name>" o "Bitmap Index Scan" = OK
--   ❌ "Seq Scan on <table>" su > 100 righe = BAD, manca index
--   ⚠️  "Filter: ..." dopo Index Scan = potrebbe esserci un index migliore
--
-- I numeri "actual time" sono in millisecondi. Target: < 50ms per p50.
-- ════════════════════════════════════════════════════════════


-- ─── QUERY 1 — searchTherapists (base, no filtri) ────────────
-- Sorgente: SupabaseTherapistRepository.swift:203 (iOS)
-- Index attesi: idx_therapist_profiles_approved, idx_therapist_profiles_rating

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, display_name, tagline, photo_url, bio, helps_with,
       city, country, latitude, longitude,
       categories, languages, availability,
       average_rating, total_reviews,
       years_experience, has_mfa, is_verified, is_approved,
       profile_completeness, gallery_image_urls,
       video_intro_url, currency, cancellation_policy, approval_status,
       created_at
FROM public.therapist_profiles
WHERE is_approved = true
  AND approval_status = 'approved'
  AND stripe_account_status = 'active'
ORDER BY average_rating DESC NULLS LAST
LIMIT 20;


-- ─── QUERY 1b — searchTherapists via view pubblica (webapp) ──
-- Sorgente: client-webapp/src/app/dashboard/therapists/page.tsx:45
-- Stesso filtro ma il view aggiunge i predicati visibilità.

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM public.therapist_profiles_public
ORDER BY average_rating DESC NULLS LAST
LIMIT 20;


-- ─── QUERY 2 — getNearbyTherapists (bounding box) ────────────
-- Sorgente: SupabaseTherapistRepository.swift:356 (iOS)
-- Coordinate: Roma centro (41.9, 12.5) ± 0.45° (~50km radius)
-- Index atteso: idx_therapist_profiles_location (composite lat,lon)

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, display_name, latitude, longitude
FROM public.therapist_profiles
WHERE is_approved = true
  AND approval_status = 'approved'
  AND stripe_account_status = 'active'
  AND latitude  BETWEEN 41.45 AND 42.35
  AND longitude BETWEEN 12.05 AND 13.05;


-- ─── QUERY 3 — getUpcomingBookings (user-scoped) ─────────────
-- Sorgente: SupabaseBookingRepository.swift:109 (iOS)
-- Sostituisci l'UUID sotto con un user reale per un test rappresentativo
-- (es. un cliente con ≥5 booking storici). Per test "vuoto" usa
-- un UUID casuale — la query torna [] ma il plan resta valido.
-- Index attesi: idx_bookings_client, idx_bookings_scheduled, idx_bookings_status

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, client_id, therapist_id, service_id, service_name,
       scheduled_at, duration, status, price, currency,
       stripe_payment_intent_id, video_room_id, created_at
FROM public.bookings
WHERE client_id = '3ce94c1d-01a7-4365-b82f-2f5abe26212c'  -- ← sostituisci con un client reale se vuoi
  AND scheduled_at >= NOW() - INTERVAL '1 day'  -- "start of today" approx
  AND status IN ('pending','confirmed','in_progress','reschedule_pending','completed')
ORDER BY scheduled_at ASC;


-- ─── BONUS — Lista index esistenti su therapist_profiles + bookings
-- (utile per cross-check rapido del plan)

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('therapist_profiles', 'bookings')
ORDER BY tablename, indexname;
