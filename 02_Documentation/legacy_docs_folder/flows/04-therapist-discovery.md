# 04 — Therapist Discovery (Search, Featured, Nearby, Recommended)

**Last verified:** 2026-04-16 by Marcello (categories invariant added 2026-05-05)
**Status:** ✅ Production
**Owner:** Marcello

> **Practices listing categories invariant (2026-05-05):** `therapist_profiles.categories[]` stores `practices.slug` values (language-neutral: `theta-healing`, `naturopatia`, etc.). The `/dashboard/pratiche` page groups practices into "Disponibile ora" vs "In arrivo" by counting therapists whose `categories[]` contains `practices.slug`. The therapist webapp profile editor (`/dashboard/profile`) uses `slug` as the dropdown `value` and a locale-dependent `label` for display. Multilingual readiness: when EN/PT UIs ship, the dropdown labels translate but the underlying slug submitted to DB stays stable. Validation: the `validate_therapist_categories` trigger rejects any value not in `practices.slug` with a 23514 error. Migration history: a previous bug had categories stored as Italian-flavored display strings (`"Naturopatia"`) which clashed with English values (`"Naturopathy"`) sent by the therapist editor — both were normalized to slugs on 2026-05-05. SQL: `client-webapp/supabase_therapist_categories_validation.sql`.

## Purpose

Clients browse therapists on iOS via 4 surfaces:
- **Search** — full-text + filters (category, language, min rating, price range)
- **Featured** — 4.0+ average rating, shown on home
- **Recommended** — based on client's interests + preferred languages
- **Nearby** — lat/lon bounding box

All surfaces ultimately call `SupabaseTherapistRepository`.

## Preconditions

- Client authenticated
- Therapist profiles have `is_approved = true` (filter applied server-side)
- Services have `is_active = true` (filter applied in 3 queries)
- At least one profile matches filter criteria (otherwise empty state)

## Happy path

### Search
1. User enters query or applies filters in `TherapistSearchView`
2. `searchTherapists(query:categories:languages:minRating:priceRange:sortBy:page:pageSize:)` at `Data/Repositories/SupabaseTherapistRepository.swift` (line ~197)
3. Query chains `.eq("is_approved", true)`, optional `.contains("categories", [...])`, `.contains("languages", [...])`, `.gte("average_rating", min)`, `.order(...)`
4. **Batch fetch** services + certs for all returned therapists in 2 queries (not N×2) at `SupabaseTherapistRepository.swift:278-290`
5. Client-side: filter by price range (needs services), sort by price
6. Returns `[TherapistProfile]` paginated

### Featured
- `getFeaturedTherapists()` at `SupabaseTherapistRepository.swift:322` — hardcoded `minRating: 4.0`, `sortBy: .rating`, limit 10

### Recommended
- `getRecommendedTherapists(for:)` at `SupabaseTherapistRepository.swift:336` — uses `clientProfile.interests` and `preferredLanguages`

### Nearby
- `getNearbyTherapists(latitude:longitude:radiusKm:)` at `SupabaseTherapistRepository.swift:350`
- Bounding box (lat/lon ± delta), not PostGIS (future improvement)

## Invariants

- All 4 surfaces filter `is_approved = true`
- All 4 surfaces filter `is_active = true` on services (enforced at migration `20260416100000`)
- Profile photos are public URLs in `profile-photos` bucket
- `startingPrice` is computed client-side as min across services (NOT stored)
- Pagination is 20 per page by default

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Supabase unreachable | Any query | iOS shows generic error; retry button |
| Zero results | Search with too many filters | Empty state with "Clear filters" CTA |
| Partial fetch (services fail) | Step 4 | Therapist still shown, services list may be empty |

## Test checklist

- [ ] Search "ThetaHealing" → see therapists with that category
- [ ] Filter by language "English" → only therapists speaking English
- [ ] Filter by min rating 4.5 → only high-rated
- [ ] Filter by price range 50-100 → only services in that range
- [ ] Featured tab → therapists sorted by rating desc, all ≥ 4.0
- [ ] Toggle therapist's service `is_active = false` in dashboard → service DISAPPEARS from iOS card within next fetch
- [ ] Toggle therapist `is_approved = false` in admin → therapist DISAPPEARS from search

## Related

- `02-therapist-onboarding.md` (what makes a therapist visible)
- `05-booking-single.md` (next step after discovery)
- `platform/data-model.md` (indices on `average_rating`, `total_reviews`)

## Known gaps

- Distance-based sort uses bounding box, not true distance (future: PostGIS)
- No full-text search on bio/tagline (only exact column match)
- No pagination UI in iOS for > 20 results (just first page)
