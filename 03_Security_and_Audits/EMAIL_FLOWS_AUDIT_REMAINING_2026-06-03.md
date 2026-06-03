# Email Flows Audit — Remaining 26 (C11–C15, T1–T17, A1–A4) + Brevo template-state

**Date**: 2026-06-03 · **Auditor**: ISKO (via Claude) · **Scope**: the 26 email flows not covered by [EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md](EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md) (which covered C1–C10), plus a live check of Brevo template activation state.

**Method**: code-level trace of every trigger (grep `template_id` / `BREVO_TEMPLATES.*` / `send-brevo-email` / `notify*` across all 3 webapps + edge functions), cross-checked against the live Brevo template list via API.

---

## 🔴 CRITICAL finding — payout templates are INACTIVE in Brevo

Live Brevo template list (`GET /v3/smtp/templates`) shows:

```
 11  active=False  Reserved 11   ← SESSION_REMINDER_1H  (no trigger anyway)
 12  active=False  Reserved 12   ← PAYOUT_SENT          (WIRED, fires in prod)
 13  active=False  Reserved 13   ← PAYOUT_FAILED        (WIRED, fires in prod)
 14  active=False  Reserved 14   ← ADMIN_PAYOUT_FAILED  (WIRED, fires in prod)
```

The code in [stripe-webhook/index.ts:819–864](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts) fires `template_id` 12/13/14 on real Stripe `payout.paid` / `payout.failed` events (T13, T14, A4). **Because templates 12–14 are `active=False`, Brevo rejects the send** → the therapist never gets paid-out / payout-failed emails and the admin never gets the payout-failure alert. Silent production failure.

The 2026-06-03 `push-brevo-templates.mjs` run updated the *HTML* of 11–14 but the script only PUTs `htmlContent` — it cannot flip `isActive` or set a subject. So 11–14 still carry the placeholder name "Reserved N", are inactive, and likely have no usable subject line.

**Fix required (needs human authorization — outward-facing prod change):** in Brevo → Templates, open 12, 13, 14 → set a subject + toggle **Active**. Suggested subjects:
| id | name | subject |
|----|------|---------|
| 12 | Payout Sent | Il tuo compenso è in arrivo |
| 13 | Payout Failed | Problema con il tuo pagamento |
| 14 | Admin Payout Failed | Payout terapista fallito — azione richiesta |
| 11 | Session Reminder 1h | La tua sessione sta per iniziare *(optional — no trigger yet)* |

(Equivalent API call: `PUT /v3/smtp/templates/{id}` with `{ subject, isActive:true, sender }`. The send path already overrides the sender, so only `isActive` + `subject` truly matter.)

---

## Full 36-email matrix

Legend: ✅ WIRED · ⚠️ WIRED-but-issue · 🟥 ORPHANED (template exists, no trigger) · ⬛ MISSING (no template + no trigger)

| ID | Email | Status | Template | Trigger (file:line) |
|----|-------|--------|----------|---------------------|
| C1 | Sign-up verify (client) | ✅ | Supabase `confirmation` | `supabase.auth.signUp` (client register) |
| C2 | Welcome client | ✅ *(fixed; staging test pending)* | 1 | client `auth/callback/route.ts:66` |
| C3 | Reset password | ✅ | Supabase `recovery` | `resetPasswordForEmail` |
| C4 | Booking confirmed (free) | ✅ | 3 | `api/checkout/create` |
| C5 | Booking confirmed (paid) | ✅ | 3 | `api/webhooks/stripe:514` |
| C6 | Reminder T-24h (client) | ✅ | 5 | `send-session-reminders:67` |
| C7 | Reminder T-1h (client) | 🟥 | 11 *(now has HTML, inactive)* | no hourly cron — **defer** |
| C8 | Self-cancel ≥48h | ✅ | 9 | client `cancel/route.ts:353` |
| C9 | Self-cancel <48h | ✅ | 9 | client `cancel/route.ts:353` |
| C10 | Therapist cancel | ✅ *(fixed; staging test pending)* | 9 | therapist `cancel/route.ts:410` |
| C11 | Reschedule proposed by therapist | ✅ | 26 (active) | therapist `reschedule/route.ts:227` |
| C12 | Refund issued | 🟥 | 10 (active) | `charge.refunded` only updates DB ([stripe-webhook:637-698](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts)) — refund msg already in template 9 |
| C13 | Review request (T+24h) | ⬛ | — (21 active but unused) | no cron |
| C14 | Account deletion confirmation | ⬛ | — | `delete-user-account` sends nothing |
| C15 | Marketing consent / newsletter | ⬛ | — | `sync-brevo-contact` adds to list only, no email |
| T1 | Sign-up verify (therapist) | ✅ | Supabase `confirmation` | therapist `register/page.tsx:59` |
| T2 | Welcome therapist | ✅ | 2 | therapist `auth/callback/route.ts:105` |
| T3 | Stripe Connect onboarding complete | 🟥 | — | `account.updated` sets status only ([stripe-webhook:701-741](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts)) |
| T4 | Profile approved | ✅ | 7 | admin `approve/route.ts:46` |
| T5 | Profile rejected | ⚠️ | **8 (reuses changes-requested)** | admin `reject/route.ts:55` — sets status `changes_requested`, no distinct rejection template |
| T6 | Profile changes requested | ✅ | 8 | admin `reject/route.ts:55` (same endpoint as T5) |
| T7 | New booking received (therapist) | ✅ | 4 | `checkout/create:683` + `webhooks/stripe:567` |
| T8 | Reminder T-24h (therapist) | ✅ | 5 | `send-session-reminders:92` |
| T9 | Reminder T-1h (therapist) | 🟥 | 11 | no hourly cron — **defer** |
| T10 | Client cancelled >48h (therapist) | ✅ | 9 | client `cancel/route.ts:396` |
| T11 | Client cancelled <48h (therapist) | ✅ | 9 | client `cancel/route.ts:396` |
| T12 | Client requested reschedule (therapist) | ⬛ | 26 (wired only reverse dir) | `reschedule-request/route.ts` notifies nobody |
| T13 | Payout sent | ⚠️ **BROKEN** | 12 *(inactive!)* | `stripe-webhook:819` |
| T14 | Payout failed | ⚠️ **BROKEN** | 13 *(inactive!)* | `stripe-webhook:837` |
| T15 | Review received (therapist) | ⬛ | — | `api/reviews/route.ts` inserts only |
| T16 | Monthly statement | ⬛ / 🟥 | 25 (orphaned + marketing-gated) | `monthly-invoices` cron issues FIC fiscal invoice, no Brevo email |
| T17 | Document expiring | ⬛ | — | no expiry cron / no schema field |
| A1 | New therapist pending review | ⬛ | — | client-side signup, no admin notify |
| A2 | New report submitted | ⬛ | — | iOS `ReportService` insert only, no trigger |
| A3 | Stripe dispute opened | ⬛ | — | `charge.dispute.created` not handled (Stripe alerts owner directly) |
| A4 | Failed payout (admin) | ⚠️ **BROKEN** | 14 *(inactive!)* | `stripe-webhook:853`, to `ADMIN_ALERT_EMAIL` (env, default support@) |

**Tally**: 21 working ✅ · 3 wired-but-broken-template ⚠️ (T13/T14/A4) · 1 copy caveat (T5) · 4 orphaned 🟥 (C7, C12, T3, T9) · 9 missing ⬛ (C13, C14, C15, T12, T15, T16, T17, A1, A2, A3).

---

## Prioritized fix list

### 🔴 Launch-blocking
1. **Activate Brevo templates 12, 13, 14** (+ set subjects). Without this, all payout emails (T13/T14/A4) silently fail. ~3 min in Brevo dashboard. *(Authorization required — agent was correctly blocked from doing this.)*

### 🟠 Worth doing pre-launch (operational, small)
2. **A1 — New therapist pending alert to admin.** Marcello currently only learns of new therapist signups by manually checking the dashboard. Marketing will drive signups → he needs the ping. Smallest fix: `AFTER INSERT` trigger on `therapist_profiles` (status=pending_review) → `send-brevo-email` to `ADMIN_ALERT_EMAIL` (new template), or notify from a server route (signup is currently client-side).
3. **A2 — New report alert to admin.** Safety/moderation. Smallest fix: `AFTER INSERT` trigger on `reports` → admin email (new template).

### 🟡 Post-launch (low impact or already deferred)
- **C7 / T9** 1-hour reminder — template 11 is ready; just needs an hourly cron. Already deferred (prioritize if no-show >15%).
- **T12** client→therapist reschedule request notifies nobody (template 26 exists, wire it to the reverse direction).
- **T15** review received → therapist; **C13** review request → client (growth).
- **C12** refund-issued email (template 10) — refund is already announced in the cancellation email (template 9), so low value.
- **T3** Connect onboarding-complete confirmation.
- **C14** account-deletion confirmation (GDPR nicety); **C15** marketing opt-in confirmation (no double-opt-in needed for transactional).
- **T16** monthly earnings summary (first month-end is weeks out; template 25 is marketing-gated — needs a transactional template).
- **T17** document-expiry alerts (needs an expiry-date schema field first).
- **A3** Stripe dispute alert — Stripe already emails the account owner directly on disputes, so app-level alert is a nice-to-have.

### ✏️ Copy caveats (not blocking)
- **T5 vs T6**: "Reject" and "Changes requested" are the *same* admin endpoint firing template 8. There is no distinct rejection template — acceptable, but the copy reads as "changes requested," not a hard rejection.
- **Template 6 (Payment Receipt)** is active but appears unused — the paid-booking receipt is folded into the booking-confirmed template (3). Verify before relying on it.

---

## Notes
- Edge functions present (22): `_shared, check-dormant-users, connect-dashboard, connect-redirect, create-booking-with-payment, create-connect-account, create-payment-intent, delete-user-account, detach-payment-method, get-available-slots, livekit-token, process-pending-payouts, request-refund, save-early-access-lead, send-brevo-email, send-push-notification, send-session-reminders, stream-token, stripe-webhook, sync-brevo-contact, validate-promo, validate-vat`.
- Stale comments mislabel template numbers in the reschedule routes (comment says "template 11"; code correctly uses `TPL_RESCHEDULE_PROPOSED = 26`). Cosmetic.
- Brevo templates 15–19 are empty "Reserved" placeholders, unused by code — leave inactive.
