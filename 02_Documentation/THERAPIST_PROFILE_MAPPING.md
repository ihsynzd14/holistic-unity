# Holistic Unity — Therapist Profile Mapping (iOS ↔ Dashboard)

**Data:** 16 Aprile 2026
**Scopo:** Mappare ogni campo del profilo terapista tra **dashboard webapp** (dove il terapista configura) e **app iOS** (dove il cliente vede). Identificare gap e disconnessioni.

---

## Legenda

| Simbolo | Significato |
|---------|-------------|
| ✅ | Allineato: configurabile E visibile |
| ⚠️ | Parziale: visibile ma con gap (dato mancante, UI incompleta, ecc.) |
| ❌ | Disconnesso: configurato lato terapista ma NON mostrato al cliente (o viceversa) |
| 🔒 | Read-only (controllato da sistema/admin) |
| 📋 | Solo lato dashboard (non pertinente al cliente) |

---

## 1. Informazioni personali

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Nome** | `users.display_name`, `therapist_profiles.display_name` | ✏️ Profilo | ✅ Card + header profilo | ✅ | Sincronizzato tra 2 tabelle — verificare trigger |
| **Tagline** | `therapist_profiles.tagline` | ✏️ Profilo | ✅ Card + header profilo | ✅ | |
| **Bio** | `therapist_profiles.bio` | ✏️ Profilo (max 500 char) | ✅ Sezione "About Me" | ✅ | |
| **Foto profilo** | `therapist_profiles.photo_url` | ✏️ Profilo (upload) | ✅ Card 60x60, header 100x100 | ✅ | |
| **Città** | `users.city`, `therapist_profiles.city` | ✏️ Profilo | ✅ Header "Città, Paese" | ⚠️ | iOS legge `location.city + location.country`, dashboard salva solo `city` → **country manca** |
| **Paese** | N/A nel DB | ❌ Non nella dashboard | ✅ Mostrato `location.country` | ❌ | **GAP**: il cliente vede il paese ma il terapista non lo può impostare |
| **Telefono** | `users.phone_number` | ✏️ Profilo | ❌ Non mostrato | 📋 | Solo uso interno/contatto |
| **Anni di esperienza** | `therapist_profiles.years_experience` | ✏️ Profilo (0-50) | ✅ Header "5 years exp." | ✅ | |
| **Email** | `users.email` | 🔒 Read-only | ❌ Non mostrato al cliente | 📋 | Privato |

---

## 2. Specializzazioni e categorie

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Categorie terapia** | `therapist_profiles.categories[]` | ✏️ Multi-select da lista predefinita | ✅ Pill su card (max 2) + sezione dedicata | ✅ | Lista enum: ThetaHealing, Reiki, Family/Systemic Constellation, Naturopathy, Ayurveda, Astrology, Human Design, Numerology |
| **Lingue parlate** | `therapist_profiles.languages[]` | ✏️ Multi-select (IT, EN, FR, ES, DE, PT, Other) | ✅ Sezione "About Me" ("Speaks: ...") | ✅ | |

---

## 3. Certificazioni

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Nome certificato** | `certifications.name` | ✏️ Aggiungi/rimuovi | ✅ Sezione Certifications | ✅ | |
| **Organizzazione emittente** | `certifications.issuing_organization` | ✏️ Opzionale | ✅ Sottotitolo 11pt grigio | ✅ | |
| **Anno ottenimento** | `certifications.year_obtained` | ✏️ Min 1970, max anno corrente | ✅ "Obtained YYYY" | ✅ | |
| **Verificato** | `certifications.is_verified` | 🔒 Admin-only | ✅ Checkmark blu sul certificato | 🔒 | Il terapista non può auto-verificarsi |

---

## 4. Video intro e gallery

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Video intro URL** | `therapist_profiles.video_intro_url` | ✏️ Solo URL nel form | ✅ Sezione "Presentation Video" (embed/play) | ⚠️ | Nessun upload nativo — solo URL esterno (YouTube/Vimeo). Considerare upload diretto. |
| **Gallery immagini** | `therapist_profiles.gallery_image_urls[]` | ❌ Non editabile in dashboard | ✅ Horizontal scroll 160x120 | ❌ | **GAP CRITICO**: il cliente vede una gallery ma il terapista non può caricarne |

---

## 5. Servizi offerti

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Nome servizio** | `therapist_services.name` | ✏️ Aggiungi/modifica | ✅ Lista servizi in profilo | ✅ | |
| **Descrizione** | `therapist_services.description` | ✏️ Testo libero | ⚠️ Non mostrata nella lista servizi | ⚠️ | Valutare se aggiungere expandable description |
| **Categoria** | `therapist_services.category` | ✏️ Enum categorie | ⚠️ Non mostrata sul servizio | ⚠️ | La categoria del servizio specifico non appare (solo categorie del terapista) |
| **Durata** | `therapist_services.duration` | ✏️ 15/30/45/60/75/90/120 min | ✅ "60 min" | ✅ | |
| **Prezzo** | `therapist_services.price` | ✏️ Double, min 0 | ✅ "$100" bold | ✅ | |
| **Chiamata conoscitiva** | `therapist_services.is_intro_call` | ✏️ Toggle (price auto 0) | ✅ Badge "FREE" verde | ✅ | |
| **Attivo/Inattivo** | `therapist_services.is_active` | ✏️ Toggle | ⚠️ Non chiaro se servizi inattivi sono nascosti al cliente | ⚠️ | **Da verificare**: filtrare `is_active = true` nelle query iOS |
| ~~**Formato**~~ | ~~`therapist_services.format`~~ | ❌ **RIMOSSO V1** | ❌ **RIMOSSO V1** | ✅ | Colonna DROP col 2026-04-16. Piattaforma solo virtual. Vedi `docs/flows/09-video-call.md` |
| **Pack size** | `therapist_services.pack_size` | ✏️ 4/6/8/10 o null | ✅ "Pack of 4" | ✅ | |
| **Pack price** | `therapist_services.pack_price` | ✏️ Prezzo per sessione nel pack | ✅ "Pack of 4: $80/session" | ✅ | |

---

## 6. Disponibilità e calendario

| Campo | DB column (JSONB) | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-------------------|--------------------|--------------------|--------|------|
| **Fuso orario** | `availability.timezone` | ✏️ Select IANA (Europe/Rome, ecc.) | ✅ Usato server-side per gli slot | ✅ | Non mostrato al cliente ma usato per calcolo slot |
| **Preavviso minimo** | `availability.minNoticeHours` | ✏️ 1/2/3/4/6/8/12/24/48 ore | ✅ Applicato ai slot disponibili | ✅ | |
| **Buffer tra sessioni** | `availability.bufferMinutes` | ✏️ 0/5/10/15/20/30/45/60 min | ✅ Applicato ai slot disponibili | ✅ | |
| **Schedule ricorrente** | `availability.recurring.{day}[]` | ✏️ Range orari per giorno | ✅ Weekly availability preview (dots M-S) + booking flow | ✅ | |
| **Eccezioni (ferie/orari speciali)** | `availability.exceptions[]` | ✏️ Date custom | ✅ Applicato ai slot disponibili | ✅ | |
| **Google Calendar sync** | `therapist_calendar_integrations` | ✏️ OAuth connect | ✅ Slot bloccati se occupato | ✅ | |
| **Outlook sync** | `therapist_calendar_integrations` | ⚠️ OAuth connect (bug 401 attivo) | ✅ Slot bloccati se occupato | ⚠️ | **Bug aperto**: Microsoft client secret scaduto |

---

## 7. Valuta e pagamenti

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Valuta** | `therapist_profiles.currency` | ✏️ EUR/USD/GBP/BRL | ✅ Simbolo in prezzi servizi | ✅ | |
| **Stripe Connect account** | `therapist_profiles.stripe_connected_account_id` | 🔒 Auto (Stripe onboarding) | ❌ Non mostrato | 📋 | Interno |
| **Stripe status** | `therapist_profiles.stripe_account_status` | 🔒 Auto | ❌ Non mostrato al cliente | 📋 | Ma blocca pagamenti se non `active` |
| **VAT number** | `therapist_profiles.vat_number` | ✏️ Se EU/UK, validato via VIES | ❌ Non mostrato | 📋 | Per fatturazione |

---

## 8. Rating e recensioni

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Media stelle** | `therapist_profiles.average_rating` | 🔒 Auto-calcolato | ✅ Card + header + sezione reviews | 🔒 | |
| **Totale recensioni** | `therapist_profiles.total_reviews` | 🔒 Auto-calcolato | ✅ "(42 reviews)" | 🔒 | |
| **Recensioni individuali** | `reviews` table | ⚠️ Dashboard `/reviews` (da verificare possibilità risposta) | ✅ Lista completa con risposta terapista | ⚠️ | Verificare che il terapista possa rispondere |

---

## 9. Verification e approval

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Is verified** | `therapist_profiles.is_verified` | 🔒 Admin | ✅ Checkmark blu su card/profilo | 🔒 | |
| **Is approved** | `therapist_profiles.is_approved` | 🔒 Admin | ❌ Non mostrato (filtra solo approvati) | 🔒 | |
| **Approval status** | `therapist_profiles.approval_status` | ✅ Dashboard mostra lo stato (draft/pending/approved/changes_requested) | ❌ Non mostrato al cliente | 🔒 | |
| **Profile completeness** | `therapist_profiles.profile_completeness` | ✏️ Auto-calcolato (0-100%) | ❌ Non mostrato al cliente | 📋 | Solo dashboard, per guidare il terapista |

---

## 10. Notifiche (solo terapista)

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Email bookings** | `email_notifications.email_bookings` | ✏️ Toggle | N/A | 📋 | Solo terapista |
| **Email messages** | `email_notifications.email_messages` | ✏️ Toggle | N/A | 📋 | Solo terapista |
| **Email payments** | `email_notifications.email_payments` | ✏️ Toggle | N/A | 📋 | Solo terapista |
| **Email reminders** | `email_notifications.email_reminders` | ✏️ Toggle | N/A | 📋 | Solo terapista |

---

## 11. Cancellation policy

| Campo | DB column | Dashboard (webapp) | App iOS (cliente) | Status | Note |
|-------|-----------|--------------------|--------------------|--------|------|
| **Cancellation policy** | `therapist_profiles.cancellation_policy` | ❌ Non editabile nella dashboard | ✅ Sezione "Refund Policy" | ❌ | **GAP**: Attualmente policy unica globale (48h/100%). Se in futuro si vuole personalizzare per terapista, aggiungere controllo |

---

## 🚨 Gap critici identificati

### GAP 1 — Gallery immagini non editabile
- **Problema:** Il cliente vede una sezione "Gallery" con scroll orizzontale (`galleryImageURLs[]`) ma il terapista non può caricare immagini dalla dashboard
- **Impatto:** Campo sempre vuoto → sezione gallery appare vuota o nascosta nell'app
- **Fix necessario:** Aggiungere nella dashboard `/dashboard/profile` una sezione "Gallery" con upload multi-file (Supabase Storage bucket `profile-photos` o nuovo `gallery`)
- **Severità:** MEDIA

### GAP 2 — Country del terapista non configurabile
- **Problema:** iOS mostra `location.city, location.country` nell'header ma la dashboard salva solo `city` (no country)
- **Impatto:** Il cliente vede "Città, (vuoto)" o "Città, undefined"
- **Fix necessario:**
  - Aggiungere campo "Country" nella dashboard profile (dropdown ISO 3166)
  - Mapping `therapist_profiles.country` → `location.country`
- **Severità:** MEDIA

### GAP 3 — Format del servizio — **RISOLTO 2026-04-16** (rimosso)
- **Decisione V1:** piattaforma solo virtual. Campo `format` rimosso completamente da DB, iOS, webapp ed edge functions.
- **Migrazione:** `supabase/migrations/20260416120000_remove_session_format.sql`

### GAP 4 — Servizi inattivi non filtrati
- **Problema:** `therapist_services.is_active = false` esiste ma non è chiaro se la query iOS filtra
- **Impatto:** Possibile che servizi "disattivati" dal terapista siano ancora visibili/bookabili
- **Fix necessario:** Verificare query `SupabaseTherapistRepository` e aggiungere `.eq("is_active", true)` se manca
- **Severità:** ALTA (bookings su servizi disattivati)

### GAP 5 — Descrizione servizio non visibile
- **Problema:** Il terapista può scrivere una `description` per ogni servizio ma il cliente non la vede
- **Impatto:** Contesto/differenziazione persa
- **Fix necessario:** Aggiungere expandable description nel profile iOS (tap per espandere)
- **Severità:** BASSA

### GAP 6 — Categoria del servizio non visibile
- **Problema:** Il servizio ha una sua categoria (`therapist_services.category`) ma il cliente vede solo le categorie globali del terapista
- **Impatto:** Un terapista multi-disciplina non può chiarire quale servizio è di che tipo
- **Fix necessario:** Mostrare tag/pill categoria accanto al nome servizio nella lista
- **Severità:** MEDIA

### GAP 7 — Risposta alle recensioni
- **Problema:** iOS mostra `review.therapistReply` ma non è chiaro se la dashboard consente di rispondere
- **Impatto:** Il terapista non può rispondere alle recensioni → campo sempre vuoto
- **Fix necessario:** Verificare se `/dashboard/reviews` ha textarea + submit per rispondere; se no, implementare
- **Severità:** MEDIA

### GAP 8 — Outlook Calendar error 401
- **Problema:** Client secret Microsoft scaduto → errore `Failed to fetch Microsoft profile: 401`
- **Fix necessario:** Rigenerare secret su Azure Portal, aggiornare `.env.local` e Vercel
- **Severità:** ALTA (feature non funzionante)

---

## ✅ Checklist di verifica per V1

- [x] **GAP 1** — Upload gallery immagini nella dashboard (max 6 foto, bucket `profile-photos/${userId}/gallery/`) + upload foto profilo
- [x] **GAP 2** — Campo `country` dropdown nella dashboard (31 paesi launch) + mapping `users.country` + `therapist_profiles.country`
- [x] **GAP 3** — Selettore formato virtual/in-person/both nella dashboard services (form + lista)
- [x] **GAP 4** — Migrazione SQL `is_active BOOLEAN DEFAULT true` + filtro `.eq("is_active", true)` in 3 query iOS (getProfile, searchTherapists, getNearbyTherapists)
- [x] **GAP 5** — Description servizio mostrata nel profile iOS (line-limited a 2 righe)
- [x] **GAP 6** — Pill categoria per singolo servizio nella lista iOS + format label reale (non più "Virtual" hardcoded)
- [x] **GAP 7** — Review reply flow già implementato in `/dashboard/reviews` (textarea + submit + display risposta)
- [ ] **GAP 8** — Fix Microsoft Outlook 401 — **richiede azione manuale Azure Portal**, vedi `MICROSOFT_OUTLOOK_SECRET_REGEN.md`
- [ ] Validare sincronizzazione `users.display_name` ↔ `therapist_profiles.display_name` (trigger DB?)
- [x] Documentato che `cancellation_policy` è globale V1 (48h/100%)

### Robustezza aggiunta (non in scope originale)

- **Fix silente:** il DTO iOS `TherapistServiceDTO.toDomain()` ora tollera sia i raw snake_case (`"theta_healing"`) sia le label usate dalla dashboard (`"ThetaHealing"`, `"Reiki a Distanza"`, ecc.), evitando il fallback silenzioso a `.naturopathy`.
- **Completezza upload:** la dashboard profile ora carica anche la foto profilo (prima il bottone camera era decorativo non-funzionale).

---

## File sorgenti di riferimento

### Dashboard webapp (configurazione terapista)
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/src/app/dashboard/profile/page.tsx`
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/src/app/dashboard/services/page.tsx`
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/src/app/dashboard/availability/page.tsx`
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/src/app/dashboard/settings/page.tsx`
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/src/app/dashboard/reviews/page.tsx`

### iOS app (visualizzazione cliente)
- `.../Holistic Unity/Features/TherapistProfile/TherapistProfileView.swift`
- `.../Holistic Unity/Features/ClientDashboard/ClientTabView.swift` (cards)
- `.../Holistic Unity/Features/Booking/BookingFlowView.swift` (booking)
- `.../Holistic Unity/Domain/Models/Therapist.swift` (model TherapistProfile)
- `.../Holistic Unity/Domain/Models/TherapistAvailability.swift`

### Database
- `.../supabase/migrations/` — schema e migrations
- Tabelle coinvolte: `users`, `therapist_profiles`, `therapist_services`, `certifications`, `therapist_calendar_integrations`, `reviews`
