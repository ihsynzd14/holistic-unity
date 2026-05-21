# [Flow Name]

**Last verified:** YYYY-MM-DD by <name>
**Status:** ✅ Production | ⚠️ Beta | ❌ Broken
**Owner:** <person who knows this best>

## Purpose

1–3 sentences describing what the flow does from the user's point of view.

## Preconditions

- User authenticated with role=…
- Resource state = …
- Feature flag / env var / …

## Happy path

Numbered steps with **real file:line references**. Prefer file path + line number to prose.

1. User taps … → `<file>:LINE`
2. ViewModel/controller calls … → `<file>:LINE`
3. Repository / edge function does … → `<file>:LINE`
4. DB change committed in … → `<file>:LINE`

## Invariants

What MUST always be true throughout or after this flow:

- `<column> >= 0`
- `<table>.<column>` is UNIQUE
- Atomic: either A and B both succeed, or neither
- RLS policy: only owner can SELECT

## Error paths

| Error | Where it fails | Expected behavior |
|-------|----------------|-------------------|
| Network timeout | Step 2 | Retry once, then surface error to user |
| 409 conflict | Step 3 | Refetch state, show user-friendly message |
| DB constraint violated | Step 4 | Rollback any earlier side effects |

## Test checklist (manual, pre-release)

- [ ] Happy path end-to-end
- [ ] Error case A
- [ ] Error case B
- [ ] Race condition / concurrent user
- [ ] Observable result in DB / Stripe dashboard / logs

## Related flows

- `05-booking-single.md`
- `platform/security.md`

## Known gaps / TODO

- …
