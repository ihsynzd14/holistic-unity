# Homepage CTA → Self-Serve Registration

**Date:** 2026-04-25
**Author:** Marcello + Claude
**Status:** Approved, ready for implementation
**Repo:** `holistic-unity-website` (static)

## Problem

The homepage's primary CTA ("Prenota call conoscitiva gratuita") submits an
email lead to `support@holisticunity.app` via formsubmit.co. The page then
promises a curated flow: *"Ti scriviamo entro 24 ore con 2-3 profili in linea."*

But the client app (`client-webapp` at `app.holisticunity.app`) **already has
a complete onboarding flow that does the same curation, automatically and
immediately**:

1. `/register` — name, email, phone, password (~1 min)
2. `/welcome` — 6-step questionnaire (intent, focus_areas, familiar_practices,
   approaches, timing, notes)
3. Summary screen calls `recommendPractices(answers, 3)` + Supabase query →
   shows **3 matched practices + 3 matched therapists** (sorted by rating)
4. Saves `client_preferences` → routes to `/dashboard`

The email lead form is therefore **redundant**: it duplicates curation that
the app does better (faster, automated, profiled on real questionnaire
answers vs. only "discipline you're interested in") and adds 24h of avoidable
latency.

## Decision

**A1 — Self-serve total.** Replace the email lead funnel with direct
registration. The CTA points to `https://app.holisticunity.app/register`.
The "Cosa succede dopo" section is rewritten to describe the actual app
onboarding flow.

Curation does not disappear — it moves into the product where it belongs.

### CTA copy

**"Trova il tuo operatore in 5 minuti"**

Reasoning: matches existing hero subtitle ("...in 5 minuti"), brand voice
(calm, anti-hype, no "unlock your potential"), specific time-bound outcome,
addresses the friction-#1 fear ("how long will this take?"), and outcome
is concrete ("an operator") rather than abstract.

## Changes to `index.html`

### 1. Replace 6 CTA links with `/register` URL + new copy

Locations (line numbers per current file):
- **L1597** — Hero primary CTA
- **L1981** — App section CTA
- **L2043** — Pricing card 1 ("Call conoscitiva")
- **L2055** — Pricing card 2 ("Sessione singola")
- **L2066** — Pricing card 3 ("Pacchetto 4 sessioni")
- **L2228+** — Final CTA (this is also the form section — see #4)
- **L2363** — Sticky mobile bar

All change from `href="#cta"` (anchor to email form) → `href="https://app.holisticunity.app/register"`.

Label per location:
- Hero, App section, Pricing cards, Final CTA — **"Trova il tuo operatore in 5 minuti"**
- Sticky mobile bar (limited horizontal space) — **"Inizia ora gratis"**, with the existing strong-line text reframed: *"Crea account · ~1 minuto"* (was *"Call conoscitiva gratuita · ~15 min · Senza carta di credito"*).

### 2. Rewrite "Cosa succede dopo" section (L2182–2220)

Three cards describe the new app flow:

| Card | Time | Title | Body |
|---|---|---|---|
| 1 | "~1 min" | **Crea il tuo account** | Email + password. Senza carta di credito, senza impegno. |
| 2 | "~3 min" | **6 domande per personalizzare** | Cosa cerchi, su cosa vuoi lavorare, quando vuoi iniziare. Risposte salvate, puoi tornare quando vuoi. |
| 3 | "Subito" | **3 operatori + 3 pratiche su misura** | Selezione automatica dalle tue risposte. Profili verificati, recensioni, prezzi chiari. |

Footer line (replaces existing one):
> *"Quando trovi quello giusto, prenoti la call conoscitiva gratuita direttamente dal suo profilo. Senza carta di credito."*

### 3. Update FAQ Q1 answer (L2156)

Current answer talks about "call conoscitiva di ~15 minuti" as the
discovery mechanism. Update to also mention the onboarding questionnaire
("Per questo ti facciamo 6 domande in fase di registrazione e ti suggeriamo
3 operatori e 3 pratiche in linea con te. Poi puoi prenotare una call
conoscitiva gratuita di ~15 minuti...").

### 4. Replace final CTA section (L2222–2281)

Remove:
- Form HTML (`<form id="bookingForm" ...>`)
- Form privacy disclaimer line
- `final-cta-success` div

Replace with:
- H2 — keep "Call conoscitiva gratuita" reframed as: **"Pronto a iniziare?"**
- Subtitle: "Crea il tuo account, rispondi a 6 domande, vedi subito 3 operatori in linea con te. Niente carta di credito."
- Primary button → `/register` with copy **"Trova il tuo operatore in 5 minuti"**
- Secondary link below: "Hai già un account? Accedi" → `/login`
- Trust strip: "✓ Email + password · ✓ ~1 minuto · ✓ Senza carta di credito"

### 5. Remove form-handling JS (L2440–2475)

Delete:
- `bookingForm` event listener + AJAX submit logic
- `bookingSuccess` reference
- The Meta Pixel `Lead` event tracking that fired on form submit

(Meta Pixel `Lead` will now fire from the client-webapp's `/register` page,
which already does this — verified in `client-webapp/src/app/register/page.tsx:55`.)

### 6. Hero reassurance pills (L1602–1606) — keep as-is

Existing pills ("Gratis", "Senza carta di credito", "Ripianifichi fino a
48h prima") still apply to the new flow — registration is free, no card
required, and 48h reschedule policy persists in-app. No change needed.

## Out of scope

- iOS waitlist card (L2284–2303) — keep as-is, separate purpose (notify
  when iOS app launches).
- iOS waitlist email form JS (L2477+) — keep, unchanged.
- All other homepage sections (manifesto, life-situations, how-it-works,
  therapies grid, app section, pricing cards layout, testimonials, FAQ
  except Q1, footer) — unchanged.
- Modality pages (Phase 2) and blog posts (Phase 4) — separate cycles.
- Translation (EN/PT) — homepage is IT-only currently.

## Verification plan

After implementation:
1. **Local preview**: run static-site preview, click each CTA, confirm
   redirect to `https://app.holisticunity.app/register`.
2. **Sticky mobile bar**: scroll past 60% on mobile viewport, confirm bar
   appears and CTA link works.
3. **Form removed**: confirm no `<form id="bookingForm">` in DOM, no JS
   errors on console (Meta Pixel `Lead` should not fire on homepage; only
   in `/register` after submit).
4. **Cosa succede dopo cards**: render correctly with new copy, animations
   intact.
5. **Final CTA section**: button visible, accessible, links work.
6. **Deploy** to Vercel production after verification.
7. **Post-deploy smoke test**: production URL, click CTA, confirm lands on
   `app.holisticunity.app/register`.

## Compliance / brand voice notes

- Brand voice (per `holistic-unity-website/CLAUDE.md`): calm, clear,
  non-hype, anti-mystical-fluff. New CTA copy respects this.
- Lessico L. 4/2013: "operatore" (not "terapeuta") — consistent with the
  Phase 1 IT cleanup deployed 2026-04-25.
- No new tracking added (Meta Pixel `Lead` fires from `/register`, not
  from homepage anymore — net same coverage, fewer touchpoints).
