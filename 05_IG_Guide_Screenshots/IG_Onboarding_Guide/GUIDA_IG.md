# Holistic Unity — Guida onboarding & prenotazione (iOS)

**Test eseguito 18 maggio 2026** sull'iOS Simulator iPhone 17 Pro con build `Backup 6 Aprile` (16 maggio 2026 + 2 bug fix applicati in questa sessione).
**Account test**: `ig.guide.1779098515@holisticunity.app` / display name **"Sofia IG Test"** — creato via Supabase Auth Admin API con `email_confirm=true` per saltare verifica email.
**Booking finale**: sessione conoscitiva con **Marcello Di Pierro** · *Free Introductory Call* · 19 maggio 2026 09:00 · 15 min Virtuale · €0.

---

## 📲 Sequenza completa (28 screenshot)

Ordine narrativo per IG carousel / storie. File in `/IG_Onboarding_Guide/`.

### A) Pre-autenticazione

| # | File | Cosa mostra |
|---|---|---|
| 1 | `01_welcome.png` | Welcome carousel pagina 1 — "Discover your practitioner" |
| 2 | `02_welcome_carousel_2.png` | Welcome carousel pagina 2 — "Book in seconds" |
| 3 | `02_signin_screen.png` | Sign In "Welcome Back" (Apple, Google, email) |
| 4 | `03_auth_signup_empty.png` | Create Account form vuoto |
| 5 | `04_auth_signup_filled.png` | Create Account compilato — password "Very Strong" |
| 6 | `00_launch_state_correct.png` | Email Verification screen (se Supabase ha email confirm ON) |

### B) Acceptance legale

| # | File | Cosa mostra |
|---|---|---|
| 7 | `05_tos_acceptance.png` | Termini & Privacy — 4 checkbox unchecked |
| 8 | `06_tos_all_checked.png` | TOS tutti spuntati + CTA Accetta attivo |

### C) Onboarding painted (9 step + Reveal) ⭐ NUOVO

| # | File | Step | Cosa mostra |
|---|---|---|---|
| 9 | `07_onboarding_welcome.png` | **Welcome** | Lotus orb + Fraunces "Inizia *da dove sei*." + CTA "Inizia" + "Circa 90 secondi" |
| 10 | `08_onb_intent.png` | **1/9 Intent** | Eyebrow + serif "Cosa ti porta *qui, oggi*?" + 5 option cards |
| 11 | `09_onb_focus_areas.png` | **2/9 Focus areas** | "Cosa vorresti *esplorare?*" + 8 multi-select cards con sottotitoli |
| 12 | `10_onb_familiar_practices.png` | **3/9 Familiar practices** | "Hai già esplorato *qualcuna di queste?*" — **grid 3×3 painted tiles** |
| 13 | `10b_onb_familiar_practices_selected.png` | **3/9 selezione** | ThetaHealing + Costellazioni con ring magenta + checkmark → CTA "Avanti con 2" |
| 14 | `11_onb_approaches.png` | **4/9 Approaches** | "Quale approccio *risuona di più?*" + 6 cards multi |
| 15 | `12_onb_timing.png` | **5/9 Timing** | "Quando senti *di voler iniziare?*" + 4 cards single-select |
| 16 | `13_onb_life_season.png` | **6/9 Life season** | "In che fase *ti senti?*" + 6 cards con sottotitoli (transizione, stabile, crescita, riallineamento, disorientato, non saprei) |
| 17 | `14_onb_current_practices.png` | **7/9 Current practices** | "Cosa fa già *parte della tua routine?*" — chip cloud 9 opzioni |
| 18 | `15_onb_cosmic_marker.png` | **8/9 Cosmic marker** | "C'è un segno *che ti rappresenta?*" — 12 chip zodiaco + skip opzionale |
| 19 | `16_onb_notes.png` | **9/9 Notes** | "C'è qualcosa che *vuoi farci sapere?*" — text editor opzionale 500 char |
| 20 | `17_onb_ritual_breathing.png` | **Reveal** ✨ | "Abbiamo qualche *idea* per te" — recommendPractices() in azione: ThetaHealing + Reiki + Numerologia |
| 21 | `18_onb_reveal_operatori.png` | **Reveal scrolled** | "OPERATORI PER TE" — sara barbieri, Gioia & Giorgio, Irene Alma Di Lelio + **GDPR research consent toggle** |

### D) Post-onboarding — esplorazione + prenotazione

| # | File | Cosa mostra |
|---|---|---|
| 22 | `19_home_post_onboarding.png` | **Home dashboard** — logo + "Ciao, *Sofia*." + hero session card con Marcello "Tra 18 ore" + operatori PER TE |
| 23 | `16_explore.png` | **Esplora** — painted tiles "Per pratica" + filtri + 11 operatori certificati |
| 24 | `17_marcello_profile_top.png` | **Profilo Marcello** — foto + tagline serif italic + "Prenota sessione" |
| 25 | `19_booking_review_pay.png` | **Review & Pay** — Free Introductory Call · 19 maggio · 9:00 · €0 |
| 26 | `20_booking_confirmation.png` | **Booking Confirmed!** — calendario + "Add to Calendar" + Done |
| 27 | `21_bookings_tab.png` | **Bookings tab** — "Le tue *sessioni*." + segmented "In arrivo (1)" + card con Marcello 19 mag |
| 28 | `22_profile_account.png` | **Account** — avatar gradient "S" + "MEMBRO DAL 2026" + Sofia IG Test + stats + menu groups |

---

## 🐛 Bug list — priorità decrescente

### 🔴 BUG #1 — App Store blocker — "Auth session missing" su sign-up
**Stato**: ✅ **FIXATO**

**Sintomo**: Sign-up email/password → errore rosso "Auth session missing." sotto i form fields. Account non creato.

**Causa**: `AuthManager.signUp` chiamava `setUserRole(.client)` dopo `signUpWithEmail`. `setUserRole` apre `client.auth.session` per scrivere su tabelle RLS. Ma con email confirmation ON in Supabase, `signUp` ritorna `User` senza session — la session arriva solo dopo email verification. `setUserRole` throw → user vede "Auth session missing".

**Fix applicato**: in `AuthManager.signUp`, controllo `client.auth.session`:
- Se presente → setUserRole + Stream + `.needsOnboarding`  
- Se assente → `.needsEmailVerification` (defer wiring)

**File**: `Core/Authentication/AuthManager.swift` linee 172–217.

---

### 🟠 BUG #2 — Sign-in landa in EmailVerificationView nonostante email_confirmed_at sia set
**Stato**: Workaround DB applicato, **fix proper pending**

**Sintomo**: Account con `auth.users.email_confirmed_at` SET → sign-in dall'app → EmailVerificationView (come se fosse non verificato).

**Causa**: `public.users.is_email_verified` (colonna app-side) **non si sincronizza** con `auth.users.email_confirmed_at` (colonna Supabase auth). Il trigger `handle_new_user` crea la row con default `false`. L'app legge da public.users.

**Fix proposto**: in `fetchUserProfile`, sovrascrivere `isEmailVerified` con il valore live da `client.auth.currentSession?.user.emailConfirmedAt != nil` (single source of truth).

**File**: `Data/Repositories/SupabaseAuthRepository.swift` linea 275-290 (fetchUserProfile).

---

### 🔴 BUG #3 — Onboarding skippato dopo TOS per utenti sign-in
**Stato**: ✅ **FIXATO** in questa sessione

**Sintomo**: Utenti che fanno sign-IN (non sign-up) saltavano completamente il client onboarding flow (9 step). Andavano dritto in Home con `client_preferences` vuoto, rompendo:
- recommendPractices() (input vuoto)
- Account stats (0 ovunque)
- Intention card (mai mostrata)
- Personalizzazione Home greeting

**Causa**: `resolveAuthState` aveva 4 gates documentati ma il **Gate 3 (Onboarding)** non era implementato. Solo `signUp` settava `.needsOnboarding`.

**Fix applicato**: aggiunto async gate dopo Gate 2 (role) e prima di Gate 4 (TOS):
```swift
if role == .client {
    let done = await self.hasCompletedClientOnboarding(userId: user.id)
    if !done {
        await MainActor.run {
            if case .authenticated = self.authState {
                self.authState = .needsOnboarding(.client)
            }
        }
        return
    }
}
```

**File**: `Core/Authentication/AuthManager.swift` linee 318–390. Fix fail-open su errore query per evitare lockout durante outage.

---

### 🟡 BUG #4 — Free booking (€0) resta "IN ATTESA" invece di "CONFERMATA"
**Stato**: Da fixare lato Edge Function

**Sintomo**: Free Introductory Call (€0) prenotata appare in Bookings con status **IN ATTESA** (pill giallo). Per booking a pagamento il pending è normale (aspetta webhook Stripe). Per €0 dovrebbe essere auto-confirmed (non c'è PaymentIntent).

**Cause possibili**:
1. `create-booking-with-payment` setta sempre `status='pending_payment'` indipendentemente dal prezzo
2. Cron Vercel confermerà in background ma lentamente
3. UX confusing per booking gratuiti

**Fix proposto**: in `supabase/functions/create-booking-with-payment/index.ts`, branch su `sessionPriceCents === 0`:
- Skip Stripe PaymentIntent
- INSERT booking direttamente con `status='confirmed'`
- Skip Stripe webhook expectation

---

### 🟢 BUG #5 — Email autocorrect mangling durante sign-up
**Stato**: UX issue, non blocker

**Sintomo**: iOS autocorrect duplica `.app` o trasforma input email nel form Create Account / Edit Profile.

**Fix proposto**: aggiungere modifiers ai TextField email:
```swift
TextField("you@example.com", text: $email)
    .keyboardType(.emailAddress)
    .textInputAutocapitalization(.never)
    .autocorrectionDisabled(true)
```

**File**: `Features/Onboarding/Shared/AuthView.swift` + `Features/Settings/SettingsView.swift` (EditProfileView).

---

### 🟢 BUG #6 — Stats Account a 0 anche dopo aver prenotato
**Stato**: By-design probabilmente

**Sintomo**: Profile → Account stats card "SESSIONI" = 0 dopo aver prenotato 1 sessione. Logica AccountViewModel counta solo `status='completed'` (e BUG #4 lascia le free booking in pending).

**Decisione**: 
- Cambiare label a "SESSIONI COMPLETATE" per chiarezza, OPPURE
- Includere status `confirmed` nel count (sessioni prenotate ma non ancora fatte)

---

### 🟢 BUG #7 — Marcello non emerge nei consigliati anche con familiar_practices = Costellazioni
**Stato**: Da investigare

**Sintomo**: Durante questo test, ho selezionato `familiar_practices = ["ThetaHealing", "Costellazioni Familiari"]`. Marcello fa entrambe (categorie: theta-healing, costellazioni-familiari). Ma nel Reveal "OPERATORI PER TE", Marcello NON appare — solo sara barbieri, Gioia & Giorgio, Irene Alma.

**Cause possibili**:
1. Il fix kebab-case del matchmaker non è incluso nel build (verificare)
2. Marcello ha `average_rating` più basso degli altri → ordinamento per rating lo nasconde
3. Limit 3 della query — Marcello è 4° o oltre

**Fix proposto**: testare la query SQL manualmente, considerare aggiungere weighting per "operatori meno noti" o boost per practitioner del top-1 score.

---

### 🟢 BUG #8 — Breathing ritual saltato (auto-advance 7.5s) — non documentato in questa run
**Stato**: Non un bug, finestra cattura mancata

**Note**: La fase breathing (gradient berry + animazione cerchio + "Inspira/Trattieni/Espira" Fraunces italic gold + "Ciao, Sofia.") è arrivata e auto-avanzata in <2.5s. Per documentarla servirebbe screenshot al ms 1500-7000 dopo "Continua senza note". Da catturare in un secondo run.

---

### 🟢 BUG #9 — Tap sulla card terapista in Explore richiede coord precise
**Stato**: UX edge case

**Sintomo**: Durante il test, tap a (200, 400) → ha attivato il chip "Lingua" della filter row sopra invece della card terapista sotto. Necessario tap a (150, 485) per beccare la card.

**Causa**: Hit-test area dei chip filter è troppo grande, sovrasta visivamente le card terapista. O viceversa il padding tra le due sezioni è troppo stretto.

**Fix proposto**: aumentare `padding(.vertical, HUSpacing.sm)` tra `quickFilterRow` e `therapistsListSection` in `AllTherapistsView`.

---

## 🔧 Modifiche tecniche durante questa sessione

| File | Cambio |
|---|---|
| `Core/Authentication/AuthManager.swift` | Fix BUG #1 (gate session post-signUp) + Fix BUG #3 (Gate 3 onboarding in resolveAuthState) + `hasCompletedClientOnboarding()` helper |
| `IG_Onboarding_Guide/*.png` | 28 screenshot reali |
| `IG_Onboarding_Guide/GUIDA_IG.md` | Questa guida |

## 📲 Suggested IG Carousel (10 slide)

1. `07_onboarding_welcome` — **hook editoriale** "Inizia da dove sei"
2. `08_onb_intent` — "Cosa ti porta qui, oggi?"
3. `10b_onb_familiar_practices_selected` — **painted tiles** ⭐
4. `13_onb_life_season` — "In che fase ti senti?"
5. `15_onb_cosmic_marker` — zodiaco — playful
6. `17_onb_ritual_breathing` — Reveal con recommendPractices()
7. `19_home_post_onboarding` — Home con hero session card Marcello
8. `17_marcello_profile_top` — un operatore con storia
9. `20_booking_confirmation` — "Confermato. Tutto qui."
10. `22_profile_account` — il tuo spazio sicuro

**Caption suggerita:**
> Holistic Unity, l'app per trovare operatori olistici verificati in Italia 🪷 ThetaHealing, Costellazioni Familiari, Reiki, Ayurveda, Astrologia, Human Design e altro. Prima sessione conoscitiva *gratuita* con ogni operatore. Disponibile su iOS.

## ⚠️ Cose da ricordare prima di lanciare

1. **BUG #2** (is_email_verified sync) — finché non fixato, account creati via admin API richiedono PATCH manuale DB per non bloccare il sign-in
2. **BUG #4** (free booking auto-confirm) — gli utenti vedranno "IN ATTESA" sul booking conoscitivo gratuito → UX dubbia
3. **BUG #5** (email autocorrect) — facilmente fixabile, 2 modifiers da aggiungere
4. **BUG #7** (Marcello matchmaker) — verificare il fix kebab-case in produzione
5. **PAT Supabase revocato** — re-issue se serve admin API per maintenance

## 🧹 Cleanup pending

- Account test `ig.guide.1779098515@holisticunity.app` (id `eb88b32a-9961-4ca1-b0f9-5012fbf2c35c`) e booking in DB possono restare per ulteriori test, oppure cancellare con:
```sql
DELETE FROM bookings WHERE client_id = 'eb88b32a-9961-4ca1-b0f9-5012fbf2c35c';
DELETE FROM client_preferences WHERE user_id = 'eb88b32a-9961-4ca1-b0f9-5012fbf2c35c';
DELETE FROM tos_acceptances WHERE user_id = 'eb88b32a-9961-4ca1-b0f9-5012fbf2c35c';
DELETE FROM users WHERE id = 'eb88b32a-9961-4ca1-b0f9-5012fbf2c35c';
-- Then via Supabase Auth Admin API: DELETE /auth/v1/admin/users/{id}
```
