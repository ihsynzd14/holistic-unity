-- ════════════════════════════════════════════════════════════
-- PERFORMANCE FIX 2026-05-23 — index mancanti per le hot query
--
-- Findings da EXPLAIN ANALYZE sulle 3 query del task list:
--   • searchTherapists           → Seq Scan (no index su filtri marketplace)
--   • getNearbyTherapists        → Seq Scan (no index su lat/lon)
--   • getUpcomingBookings client → Seq Scan (no index su client_id)
--   • getPastBookings client     → Seq Scan (no index su client_id)
--
-- Oggi le query sono sub-millisecondo perché le tabelle hanno
-- 19 (therapist_profiles) e 35 (bookings) righe. Postgres sceglie
-- Seq Scan correttamente a queste dimensioni. Ma POST-LANCIO,
-- quando le tabelle cresceranno a 500+ therapist e 5000+ booking,
-- Postgres switcherà a Index Scan SOLO SE GLI INDEX ESISTONO.
--
-- Strategia: partial composite index mirror del pattern già
-- esistente `idx_bookings_therapist_scheduled` — la stessa logica
-- ma adattata ai 3 hot path scoperti. Costo: ~KB su queste
-- dimensioni; tempo creazione: <100ms (no CONCURRENTLY necessario
-- a queste dimensioni — il lock è effettivamente non-blocking).
--
-- NB: niente DROP di index esistenti. Solo ADDITIVE.
-- ════════════════════════════════════════════════════════════


-- ─── INDEX 1 — Marketplace listing ───────────────────────────
-- Copre: searchTherapists (base case) + therapist_profiles_public view
-- Pattern: composite partial — Postgres scansiona l'index in
-- ordine di rating, prende i primi 20, salta del tutto le righe
-- non-approvate/stripe-inactive (sono escluse dal partial).
CREATE INDEX IF NOT EXISTS idx_therapist_profiles_listing
  ON public.therapist_profiles (average_rating DESC NULLS LAST, id)
  WHERE is_approved = true
    AND approval_status = 'approved'
    AND stripe_account_status = 'active';


-- ─── INDEX 2 — Bounding box geo ──────────────────────────────
-- Copre: getNearbyTherapists (filtro bounding box su lat/lon)
-- Pattern: composite (lat, lon) partial — efficiente per range
-- scan su latitudine + filtro su longitudine.
CREATE INDEX IF NOT EXISTS idx_therapist_profiles_location
  ON public.therapist_profiles (latitude, longitude)
  WHERE is_approved = true
    AND approval_status = 'approved'
    AND stripe_account_status = 'active';


-- ─── INDEX 3 — Client upcoming bookings ──────────────────────
-- Copre: getUpcomingBookings(client_id, ...) della home cliente
-- Pattern: mirror esatto del partial composite già esistente per
-- terapista (`idx_bookings_therapist_scheduled`) — stessa filosofia,
-- stessi 4 status, ma su client_id invece che therapist_id.
-- Status 'completed' è escluso (mirror del partial therapist) — la
-- finestra rejoin di 3h è coperta da Seq Scan locale che è veloce
-- anche su tabelle grandi perché è un subset minuscolo (< 1% righe).
CREATE INDEX IF NOT EXISTS idx_bookings_client_scheduled
  ON public.bookings (client_id, scheduled_at)
  WHERE status IN ('pending', 'confirmed', 'in_progress', 'reschedule_pending');


-- ─── INDEX 4 — Client past bookings ──────────────────────────
-- Copre: getPastBookings(client_id, ...) della history cliente
-- Pattern: composite (client_id, scheduled_at DESC) partial sui
-- 3 status terminali. Ordine DESC sull'index allinea l'ordering
-- della query → no sort step necessario.
CREATE INDEX IF NOT EXISTS idx_bookings_client_past
  ON public.bookings (client_id, scheduled_at DESC)
  WHERE status IN ('completed', 'cancelled', 'no_show');


-- ─── VERIFICA POST-DDL ────────────────────────────────────────
-- Run this dopo il CREATE per confermare i nuovi index.
-- Atteso: 4 nuovi index + i 6 esistenti = 10 totali.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('therapist_profiles', 'bookings')
ORDER BY tablename, indexname;
