# App Review Information — Holistic Unity

> Paste this into App Store Connect → App Review Information → Notes

---

## Notes for Reviewer

```
Holistic Unity is a marketplace connecting clients with verified holistic wellness
practitioners (ThetaHealing, Family Constellation, Reiki, Ayurveda, Astrology,
Human Design, Numerology, Naturopathy, Shamanism). Sessions are real-world
services delivered by humans via video call (LiveKit). All practitioners are
identity-verified and review-moderated by our team.

== HOW TO TEST ==

Sign in with the demo credentials below. The account is pre-confirmed (no email
verification needed) and has already completed TOS + onboarding, so you'll land
directly on the Home dashboard.

1. HOME — see personalized hero greeting, recommended practitioners, upcoming
   sessions (if any), and the pull-quote footer.
2. EXPLORE TAB — browse all certified practitioners. Tap the painted category
   tiles to filter by practice (ThetaHealing, Reiki, etc.). Use the magenta
   filter button for sort/language/distance/price filters.
3. PRACTITIONER PROFILE — tap any practitioner card. View their bio, services,
   presentation video, gallery, reviews. Notice the "Report" icon — fully
   functional content-moderation flow.
4. BOOK A SESSION — tap "Prenota sessione". For a no-cost test, select the
   "Free Introductory Call" service (15 min, €0). Pick any future date/time.
   On Review & Pay tap "Confirm Booking" — no payment required for €0.
5. BOOKINGS TAB — your new booking appears under "In arrivo".
6. MESSAGES TAB — Stream Chat-powered DM with practitioners.
7. ACCOUNT TAB — profile, payment methods, privacy & security settings.
   The mailto:support@holisticunity.app link in "Contattaci" opens Mail.

== REGARDING APPLE GUIDELINES ==

- Guideline 3.1.5(a) (Physical goods/services): Sessions are real-world
  human-delivered consultations via video call OR in-person. Payments use
  Stripe (not IAP) because the service is delivered outside the app by a
  human practitioner.
- Guideline 1.2 (User-Generated Content): All practitioner profiles and chat
  messages can be reported via the Report flow. Block-user is available from
  the Profile screen + from inside the Messages tab.
- Guideline 5.1.1(i) (Sensitive data): App handles wellness-adjacent content.
  Email verification (hard gate) + four-checkbox TOS acceptance (including
  GDPR Art. 9 health-data consent) required before any feature access.
- Guideline 5.1.1(v) (Account deletion): Available in Settings → "Elimina
  account". Cascades to Stripe Connect, Stream Chat, and our DB.
- Guideline 4.5.4 (Push notifications): Permission requested post-onboarding,
  never at launch. Marketing notifications are opt-in only.
- Apple-published Privacy Manifest declares all collected data types,
  required-reason APIs (UserDefaults, FileTimestamp, SystemBootTime, DiskSpace),
  and tracking=false (we do not track users, no ATT prompt).

If anything is unclear, please contact Armand at the email below — happy to
provide additional context or another demo account if needed.
```

---

## Demo Account Credentials

| Field | Value |
|---|---|
| **Email** | `reviewer@holisticunity.app` |
| **Password** | `AppleReviewer2026!` |
| **Account state** | Pre-confirmed, onboarding completed, TOS accepted. Lands directly on Home dashboard. |
| **Created via** | Supabase Auth Admin API on 2026-05-18 with `email_confirm=true` |
| **Account ID (internal)** | `2ab46803-3c08-494e-a049-f4f6d29c2981` |

> Free Introductory Call (€0) bookings are available for testing the payment
> flow end-to-end without any real-money transaction.

---

## Contact Information for Review Team

| Field | Value |
|---|---|
| **First Name** | Armand |
| **Last Name** | _[add yours]_ |
| **Phone Number** | _[add yours]_ |
| **Email** | Armand@stormxdigital.com |
| **Support email** | support@holisticunity.app |
| **Response time** | < 24h business days |
