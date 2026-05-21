# Holistic Unity — Opportunità di miglioramento

Backlog di miglioramenti raccolto da analisi esplorativa dei 25 flussi documentati in `FLOWS.md`. Non sono bug — sono interventi che alzano la qualità di UX, conversione, performance, affidabilità, accessibilità, trust e i18n.

Ordinato per **impatto/effort ratio**. Aggiornato 2026-04-27.

---

## 🔥 Quick wins (alto impatto, basso effort) — fai prima

| Categoria | ID | Cosa | File:line | Effort |
|---|---|---|---|---|
| UX | UX-1 | Sostituire `window.prompt()` cancel con modal stilizzato (mobile blocca) | client `dashboard/bookings/page.tsx:185` | 1h |
| UX | UX-2 | Sostituire `window.confirm()` reschedule reject con modal | client `dashboard/bookings/page.tsx:137` | 30min |
| Trust | T-1 | Mostrare politica refund 3-tier (48h/24h/0%) come tooltip su badge "Annullabile" | client `therapists/[id]/page.tsx:940-946` | 30min |
| Trust | T-2 | Tooltip su badge "Verificato" che spiega cosa significa | client `therapists/[id]/page.tsx:405-409` | 10min |
| CR | CR-4 | Progress bar 7-step nell'onboarding `/welcome` | client `welcome/page.tsx:23` | 30min |
| UX | UX-6 | Etichetta dedicata "Pagamento in elaborazione" per `pending_payment` | client `dashboard/bookings/page.tsx:61-68` | 10min |
| UX | UX-4 | Promise.all sulla dashboard home cliente (4 query in waterfall) | client `dashboard/page.tsx:37-95` | 30min |
| Mobile | M-1 | Sticky CTA "Procedi al pagamento" anche con slot selezionato | client `therapists/[id]/page.tsx:955` | 30min |
| Perf | P-1 | Pause polling earnings quando tab in background (visibilitychange) | therapist `dashboard/earnings/page.tsx:175,213` | 30min |

**Totale stimato**: 4-5h. Tutti questi insieme.

---

## 🎯 High-impact (alto impatto, effort medio)

### Conversione & Retention

**CR-1** — Algoritmo di sort terapisti: i nuovi (rating null) sono in fondo, non vengono mai mostrati → retention killer
*client `dashboard/therapists/page.tsx:42-46`* — **1h**
Mix: nuovi + has_free_intro boost in top N, poi rating DESC.

**CR-2** — Success page checkout senza CTA di follow-up booking. Massimo intent perso.
*client `checkout/success/page.tsx:190-214`* — **1h**
Aggiungere "Esplora altri servizi di [firstName]" dopo il primary CTA.

**CR-5** — SlotPicker finestra 14gg fissa. Se terapista ha poca disponibilità → tutti slot vuoti → abbandono.
*client `components/booking/SlotPicker.tsx:39-44`* — **1h**
Estendere a 21gg + messaggio "prossimo slot disponibile il…" se zero risultati nei primi 14.

**CR-3** — Open Graph dinamica per profili terapista (link condivisi WhatsApp/social mostrano titolo generico, no price).
*client `dashboard/therapists/[id]/page.tsx`* — **4h**
Next.js dynamic metadata per la route, includere prezzo minimo + `display_name` + foto.

### UX

**UX-3** — Recensioni renderizzate (oggi solo placeholder "Recensioni in arrivo"). Una sola review è già social proof critico.
*client `therapists/[id]/page.tsx:641`* — **4h**
Query `reviews` + cards con avatar + rating + testo + data.

### Affidabilità

**R-2** — Polling success page si arrende a 12s. Se webhook arriva al 13°s, cliente vede "in elaborazione" per booking già confermato.
*client `checkout/success/page.tsx:106-117`* — **30min**
Estendere a 12 tentativi (18s) o sostituire con Supabase Realtime puntuale sulla riga.

**R-3** — `ReviewModal` insert client-side include `client_photo_url` non sanitizzata. Pattern fragile se RLS cambia.
*client `dashboard/bookings/page.tsx:544-552`* — **1h**
API route `POST /api/reviews` con sanitization + cross-check booking ownership.

---

## 🌐 Internationalisation (impatto alto, effort 4-8h)

**I-1** — 20+ `toLocaleDateString("it-IT", ...)` hardcoded → utenti EN vedono date italiane
*Multipli file client-webapp* — **4h**
Helper `formatDate(date, locale)` in `lib/i18n/format.ts`, sostituire dovunque.

**I-2** — Pagina profilo terapista con 30+ stringhe italiane hardcoded fuori da `t.*`
*client `therapists/[id]/page.tsx`* — **4h**
Estrarre tutte le label nel file `lib/i18n/translations/{it,en}.ts`.

**I-3** — Stesso problema su therapist-webapp (21 occorrenze)
*therapist `dashboard/{bookings,earnings,sessions,billing}/page.tsx`* — **2h**
Stesso pattern.

**I-4** — `CATEGORY_TO_PRACTICE_SLUG` con chiavi italiane fragili a rinaming DB
*client `therapists/[id]/page.tsx:33-43`* — **30min**
Solo commento + ticket per futuro.

---

## ♿ Accessibilità (impatto medio, effort basso)

| ID | Cosa | File:line | Effort |
|---|---|---|---|
| A-1 | aria-label completo su day button SlotPicker disabled | client `components/booking/SlotPicker.tsx:86-106` | 10min |
| A-2 | Focus management su video modal apertura | client `therapists/[id]/page.tsx:981-1010` | 30min |
| A-3 | `aria-pressed` su stelle ReviewModal | client `dashboard/bookings/page.tsx:602-610` | 10min |
| UX-5 | aria-label con data completa su day button SlotPicker | client `components/booking/SlotPicker.tsx:86-106` | 10min |

**Totale**: 1h. Da fare in batch unico.

---

## ⚡ Performance (effort medio, impatto medio)

**P-2** — Browse terapisti: 2 query sequenziali (profili + servizi intro). View materializzata con `has_free_intro` colonna calcolata.
*client `dashboard/therapists/page.tsx:51-61`* — **1gg** (DB migration + view update)

**P-3** — Therapist bookings: query bookings + 2nd query per `user_contact_info`. JOIN server-side.
*therapist `dashboard/bookings/page.tsx:130-157`* — **1h**

**P-4** — Earnings carica `transactions.limit(200)` e filtra client-side per periodo.
*therapist `dashboard/earnings/page.tsx:118-121`* — **2h**
Filtraggio DB per `created_at` range del periodo selezionato.

---

## 📱 Mobile-specific (impatto basso, fix rapidi)

| ID | Cosa | File:line | Effort |
|---|---|---|---|
| M-2 | `grid-cols-2` su xs, `grid-cols-3` da sm in poi sui time slot | client `components/booking/SlotPicker.tsx:134` | 10min |
| M-3 | `max-h` + `overflow-y-auto` sulla lista servizi sticky sidebar | client `therapists/[id]/page.tsx:880` | 10min |

---

## 🛡 Trust signals (impatto alto, effort variabile)

**T-3** — Contatore "X sessioni completate" sulla sidebar profilo terapista (social proof).
*client `therapists/[id]/page.tsx:839-950`* — **1h**
Aggiungere `total_sessions_completed` come query/colonna calcolata, render condizionale (>10).

---

## Riepilogo prioritizzato

### Sprint 1 (4-5h) — Quick wins
Tutti i 9 quick wins (modal cancel, tooltip refund, progress bar onboarding, etichetta pending_payment, Promise.all dashboard, sticky CTA mobile, polling earnings background-aware, tooltip "Verificato").

**Impatto**: -10/15% drop-off nelle azioni cancel/reschedule mobile, +trust signals visibili nella conversione, -costi API Stripe da polling.

### Sprint 2 (8-10h) — High-impact UX/Conversion
- Algoritmo sort terapisti misto (CR-1)
- CTA follow-up checkout success (CR-2)
- SlotPicker estensione 21gg + fallback message (CR-5)
- Recensioni renderizzate (UX-3)
- Polling success page allungato (R-2)

**Impatto**: +5-10% retention terapisti nuovi, +3-5% repeat booking rate, +chiarezza al cliente nei flussi denaro.

### Sprint 3 (1-2 giorni) — i18n + accessibilità
- I-1 + I-2 + I-3: localizzazione date e label terapisti
- Tutti gli A-* + UX-5: a11y batch fix

**Impatto**: utenti EN finalmente con UI in inglese, score Lighthouse a11y +10-15 punti.

### Sprint 4 (3-4 giorni) — Perf + Open Graph
- P-2 (view materializzata terapisti)
- P-3 (JOIN bookings + contact)
- P-4 (filtraggio DB earnings)
- CR-3 (Open Graph dinamica)

**Impatto**: latenze pagine -50% sui dataset >100 righe, CTR organico social link migliorato.

---

## File chiave (cross-reference)

- [`client-webapp/src/app/dashboard/therapists/[id]/page.tsx`](client-webapp/src/app/dashboard/therapists/[id]/page.tsx) — pagina con più miglioramenti suggeriti
- [`client-webapp/src/components/booking/SlotPicker.tsx`](client-webapp/src/components/booking/SlotPicker.tsx) — accessibilità + extension finestra
- [`client-webapp/src/app/dashboard/bookings/page.tsx`](client-webapp/src/app/dashboard/bookings/page.tsx) — UX modali + i18n
- [`client-webapp/src/app/checkout/success/page.tsx`](client-webapp/src/app/checkout/success/page.tsx) — polling + CTA follow-up
- [`therapist-webapp/src/app/dashboard/earnings/page.tsx`](therapist-webapp/src/app/dashboard/earnings/page.tsx) — polling + filtraggio DB
- [`therapist-webapp/src/app/dashboard/bookings/page.tsx`](therapist-webapp/src/app/dashboard/bookings/page.tsx) — i18n + JOIN
