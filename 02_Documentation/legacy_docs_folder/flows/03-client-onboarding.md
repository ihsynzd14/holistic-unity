# 03 — Client Onboarding (iOS)

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

After a client signs up (email or SSO), they go through a multi-step onboarding to populate `clients` (part of `users` table) with preferences that feed the recommendation algorithm.

## Preconditions

- User authenticated via `AuthManager` with `role = "client"` and `authState = .needsOnboarding(.client)`
- Supabase `users` row exists with minimum fields (id, email, role)

## Happy path

Entry: `Features/Onboarding/ClientOnboarding/ClientOnboardingFlow.swift:207` renders `ClientOnboardingFlow`.

Steps (dynamic based on interests) — driven by `ClientOnboardingViewModel` at lines 9–86:

1. **Personal info** — displayName (+ optional profile photo)
2. **Experience level** — new to holistic / some / experienced
3. **Interests** — multi-select `TherapyCategory` enum
4. **Goals + preferred languages** — multi-select `WellnessGoal` + languages
5. **Birth details** (conditional at `ClientOnboardingFlow.swift:45-48`) — only if interests include astrology / Human Design / numerology
6. **Intention** — why are you here (stress relief, growth, etc.)
7. **Notifications** — push permission request (`ClientOnboardingFlow.swift:111`)

Save path at `ClientOnboardingFlow.swift:166`:

```
SupabaseConfig.client.from("users").update({
  display_name, preferred_languages, experience_level,
  birth_date (if step 5 shown), intention, marketing_consent
}).eq("id", userId).execute()
```

After save: `AppState.appRoute = .main` → user lands on `ClientTabView`.

## Invariants

- Birth data (birth_date, birth_time, birth_city) is ONLY collected if user selected birth-chart-related categories
- `marketing_consent` defaults to `false` unless explicitly toggled
- `preferred_languages` has at least 1 entry (default `["Italian"]` or device locale)
- Onboarding can be skipped (future releases should block if too minimal)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Network fails on save | Step 7 final save | Error banner, user can retry; no partial row updates (single UPDATE) |
| Push permission denied | Step 7 | Continues; notifications section in Settings shows "Enable" CTA |
| Photo upload fails | Step 1 | Skip upload, save rest; retry via Settings |

## Test checklist

- [ ] New Google signup → onboarding starts at step 1
- [ ] Select "Astrology" as interest → birth details step appears
- [ ] Select "Naturopathy" only → birth details step skipped
- [ ] Complete all steps → `users` row updated with all fields
- [ ] Deny push permission → no crash, land on main tab
- [ ] Restart app mid-onboarding → resumes at same step (state persisted? currently NO — TODO)

## Related

- `01-auth.md` (where onboarding is triggered)
- `04-therapist-discovery.md` (uses `interests`, `preferredLanguages`, `budgetTier` for recommendations)
- `platform/data-model.md` (users table columns)

## Known gaps

- No progress persistence — if user closes app mid-onboarding, starts from scratch
- Budget tier is not asked in V1 onboarding (uses default `medium`). SessionFormat preference was removed in April 2026 — platform is virtual-only.
- Birth time is optional; without it astrology accuracy is reduced (no UX warning)
