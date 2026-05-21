# Holistic Unity — Audit completo iOS (2026-05-18)

**Scope**: Performance · Security · App Store readiness.
**Approccio**: 3 audit paralleli (1 agent ciascuno, lettura full codebase + query live Supabase via service_role).
**Outcome**: 2 bug critici fixati + 4 quick wins applicati + roadmap di 12 azioni residue documentate per priorità.

---

## ✅ Fix applicati ORA in questa sessione

| # | Area | File | Cosa |
|---|---|---|---|
| 1 | **Security 🟠** | `DesignSystem/Components/VideoPlayerViews.swift` | XSS stored fix: validazione ID YouTube 11-char + switch a `URLRequest.load` (no più string concat HTML) |
| 2 | **Security 🟠** | `Features/TherapistProfile/TherapistProfileView.swift` | Stesso XSS fix per `videoEmbedURL` (YouTube watch/youtu.be/embed) + switch a `youtube-nocookie.com` |
| 3 | **Security 🟠** | `Core/Authentication/AuthManager.swift` | `signOut()` ora wipe `URLCache.shared` + `UserDefaultsManager.resetAll()` (no più ghost user su shared device) |
| 4 | **Performance 🔴** | `Holistic_UnityApp.swift` | Eliminato blanket `URLCache.removeAllCachedResponses()` cold-launch; ora cache 16MB RAM / 200MB disk per immagini |
| 5 | **Performance 🔴** | `Core/Extensions/URL+SupabaseStorage.swift` (NEW) + `DesignSystem/Components/HUAvatar.swift` | Image thumbnails via Supabase Storage `/render/image/`. Avatar passa da 1-4MB a 6-20KB per foto |
| 6 | **App Store** | `Holistic-Unity-Info.plist` | `ITSAppUsesNonExemptEncryption = false` (richiesto, mancava) |
| 7 | **App Store** | `Holistic Unity/PrivacyInfo.xcprivacy` | Aggiunti required-reason APIs: `FileTimestamp` (C617.1), `SystemBootTime` (35F9.1), `DiskSpace` (E174.1). Aggiunti collected data types: `PreciseLocation`, `CrashData`, `PerformanceData` |
| 8 | **App Store** | `Holistic Unity.xcodeproj/project.pbxproj` | Aggiunto `it` a `knownRegions` + `LSApplicationCategoryType = public.app-category.healthcare-fitness` |

Build verde 18.6s.

---

## 🔴 Richiede TUA azione PRIMA della submission

### 1. **GDPR / Security blocker — leak di PII di tutti i terapisti** ⚠️
File SQL pronto da incollare in **Supabase Dashboard → SQL Editor**:
`/Users/marcello/Desktop/Holistic Unity/Security_Fixes/2026-05-18_critical_security_fixes.sql`

**Cosa fa**:
- Revoca SELECT a `anon` su `therapist_profiles` per le colonne PII (codice_fiscale, p_iva, pec_email, stripe_connected_account_id, ecc.) — lascia accessibili solo le colonne pubbliche
- Revoca SELECT a `anon` su view `tos_acceptances_latest` (leakava user UUIDs + IP addresses)
- Garantisce RLS attiva su `tos_acceptances`

**Perché urgentissimo**: con la SOLA anon key dell'app iOS (pubblica nel bundle) chiunque oggi può:
```bash
curl https://bqyqkvkzkemiwyqjkbna.supabase.co/rest/v1/therapist_profiles \
  -H "apikey: <anon_key>" \
  -H "Authorization: Bearer <anon_key>"
# Restituisce 16 righe con codice_fiscale, p_iva, stripe_connected_account_id, pec_email
```
Sotto GDPR è violazione Art. 32 (security of processing) + Art. 9 se il codice fiscale viene considerato dato salute-adjacent. Il Garante italiano fa multe a 6 cifre per leak come questo.

**Tempo**: 30 secondi. Apri Dashboard → SQL Editor → incolla → Run. Verifica con `curl` riprendendo l'esempio sopra: deve restituire `permission denied`.

### 2. **App Store rejection lock — Demo account mancante** ❌
`App_Review_Notes.md` ha ancora `[CREATE AND INSERT DEMO EMAIL]` placeholder. Reject istantaneo per Guideline 2.1.

**Cosa fare**:
1. Crea account `reviewer@holisticunity.app` / password robusta (es. `HolisticReview2026!`)
2. Login una volta per verificare TOS + onboarding funzionano
3. Riempi i placeholder in `App_Review_Notes.md`

### 3. **App Store rejection risk — Report/Block UGC mancante** ❌
Guideline 1.2: app con UGC (chat + profili terapista) deve avere report **funzionante** + block. Attualmente:
- `TherapistProfileView.swift:172-185` ha sheet Report ma i bottoni settano solo flag locale, **non chiamano backend**
- Niente block user
- Niente report su messaggi Stream Chat

**Fix proposto** (~2h):
- Crea tabella `reports (id, reporter_id, reported_id, reported_type, reason, details, created_at)` con RLS
- POST endpoint da iOS quando user tap "Report"
- Per Stream Chat: usa `channel.muteUser()` o admin ban via Stream API

### 4. **App Store rejection risk — Screenshots wrong size** ❌
Attuali 1206×2622 (iPhone 17 6.3"). App Store richiede:
- **6.9" iPhone Pro Max** (1320×2868) — obbligatorio
- **6.5" iPhone Pro Max** (1242×2688) — raccomandato

**Cosa fare**: ri-cattura su iPhone 17 Pro Max simulator (UDID `5D48BD09-8571-4935-AF4E-84527EF905D3`). Hai già la guida — puoi rifare gli stessi tap.

### 5. **Compliance — App icon 1024px broken** ❌
`App Store Screenshots/AppIcon_1024x1024.png` è in realtà 192×197. Apple lo rifiuterà.
**Fix**: re-esporta il logo a 1024×1024 PNG senza alpha.

---

## 🟠 Da fare PRIMA della submission (medium priority)

### 6. **Refactor TherapistRepository → usa `therapist_profiles_public` view**
Anche dopo il GRANT fix #1, è cleaner refactorare le 5 chiamate SELECT in `SupabaseTherapistRepository.swift` (linee 21, 53, 102, 214, 362) per usare il view safe invece della raw table. Garantisce zero possibilità di leak futuro se qualcuno aggiunge una nuova colonna PII.

**Effort**: 2h. Servirebbe anche aggiungere `latitude`/`longitude` al view `therapist_profiles_public` per supportare `getNearbyTherapists`.

### 7. **Fix dual Info.plist source of truth**
`GENERATE_INFOPLIST_FILE = YES` + `INFOPLIST_FILE = "Holistic-Unity-Info.plist"` co-esistono nel pbxproj. Risultato: NSCameraUsageDescription è dichiarato sia nel pbxproj (con copy debole "Camera access is needed for video therapy sessions") sia nel plist standalone (con copy migliore). Apple Reviewer potrebbe vedere quella debole.
**Fix**: rimuovere tutti gli `INFOPLIST_KEY_*` duplicati dal pbxproj OR `GENERATE_INFOPLIST_FILE = NO`. Pick one source.

### 8. **TrustKit pinning attivo (`enforce = true`)**
`Core/Security/TrustKitConfig.swift:63` è in reporting-only mode. Dopo 14 giorni di soak senza falsi positivi, attiva enforce.

### 9. **JailbreakDetector: aggiungi SPM IOSSecuritySuite OR rimuovi il file**
Attualmente è no-op che ritorna sempre `false`. Misleading per reviewer Apple. Decisione: o linka la dipendenza o cancella il file.

### 10. **Edge Functions: standardizza JWT in Authorization header**
8 edge functions hanno `verify_jwt = false` e fanno verifica manuale internamente. Pattern fragile (1 dimenticanza = endpoint pubblico). Idealmente: riattiva `verify_jwt = true` su tutte tranne webhook Stripe.

### 11. **N+1 query fix — Bookings tab**
`ClientTabView.swift:2243-2247` loopa serialmente `getProfile()` per ogni terapista nelle prenotazioni. Sostituire con singola query `.in("id", values: [ids])`. 
**Effort**: 2h. Performance win: 30 query → 1 query, da ~3-5s a ~200ms.

### 12. **Supabase SDK update**
Verifica versione corrente di supabase-swift. Le versioni recenti includono `PrivacyInfo.xcprivacy` che attualmente manca → potenziale Apple flag.

---

## 🟡 Da fare per scalare (architettura)

### 13. **Image CDN strategy** (per 10x → 100x crescita)
Il fix Supabase Storage transforms (#5 sopra) ti porta a ~10x scale. Oltre, considera **Cloudflare Images** ($5/100K storage, auto-AVIF, edge cache globale). Sostituisce Supabase Storage transforms con `https://imagedelivery.net/<account>/<image-id>/<variant>`. ROI evidente sopra 50K utenti attivi.

### 14. **Image loader proper (Kingfisher / Nuke)**
`AsyncImage` SwiftUI è basic: niente memory cache configurabile, niente prefetch, niente cancellation propagata. Per Home dashboard con 10+ cards visibili Nuke darebbe scroll più liscio + meno re-download.

### 15. **HLS video pipeline** (per video presentazione)
Direct MP4 streaming ok per ora, ma a scala convertire in HLS (Mux ~$0.005/min stored, Cloudflare Stream $1/1000 min) dà adaptive bitrate + thumbnail preview gratis.

### 16. **PostGIS + nearby RPC**
`getNearbyTherapists` fa bounding-box scan. Sotto 1000 terapisti ok, sopra serve GIST index su PostGIS geography column. Effort 4h una tantum.

### 17. **Server-side filter/sort su `searchTherapists`**
Attualmente fetch paginato server-side ma filter "Highest Rated" + "Lingua" client-side. A 100x scale i risultati "rated 4+" potrebbero non comparire nelle prime pagine. Spostare WHERE/ORDER lato server.

### 18. **Comprimere asset illustrations**
10 PNG da 700KB-1.4MB ognuno = 12.4 MB di asset bundle. Re-esportare come WebP o PDF vector → -8MB bundle size, app più leggera da scaricare.

---

## 🟢 Quick wins minori (<30 min ciascuno)

| # | Cosa | File |
|---|---|---|
| 19 | Disabilita autocorrect su email fields | `AuthView.swift`, `EditProfileView.swift` |
| 20 | Free booking €0 auto-confirm (BUG #4 della guida IG) | `supabase/functions/create-booking-with-payment/index.ts` |
| 21 | `Locale.current` invece di `it_IT` hardcoded | `ClientTabView.swift` (6 hits), `SettingsView.swift:553` |
| 22 | Sync `is_email_verified` su `auth.users.email_confirmed_at` (BUG #2 della guida IG) | DB trigger o fetchUserProfile override |
| 23 | URLSession.shared → custom session in `SupabasePaymentRepository.swift:295` (perf+security) | Stesso pattern di SupabaseConfig |
| 24 | Rate `is_email_verified` migration backfill | `UPDATE public.users SET is_email_verified = true WHERE id IN (SELECT id FROM auth.users WHERE email_confirmed_at IS NOT NULL)` |

---

## 📋 Pre-submission checklist (ordine consigliato)

1. ⚠️ **CRITICAL**: Esegui SQL `Security_Fixes/2026-05-18_critical_security_fixes.sql` nel Dashboard Supabase
2. ⚠️ **CRITICAL**: Crea account reviewer + riempi `App_Review_Notes.md`
3. ⚠️ **CRITICAL**: Implementa Report + Block (Guideline 1.2)
4. ❌ Ri-cattura screenshots su iPhone 17 Pro Max simulator
5. ❌ Esporta nuovo `AppIcon_1024x1024.png` correttamente
6. 🟠 Refactor TherapistRepository per usare view safe
7. 🟠 Risolvi dual Info.plist source
8. 🟠 Update supabase-swift SDK alla versione più recente
9. 🟠 Translate App Store description + keywords in IT
10. 🟡 Soak TrustKit pinning 14 giorni → attiva enforce
11. 🟡 Verifica Bundle ID `Holistic-Unity-Healing` registrato su App Store Connect
12. ✅ Build + archive + upload via Xcode Organizer

---

## 📊 Performance: confronto prima/dopo (stimato)

| Surface | Prima | Dopo (fix applicati) | Dopo (tutti i fix) |
|---|---|---|---|
| Home dashboard 1st load | ~3.5s (10 immagini × 200-400 KB) | ~0.9s (10 thumb × 15-30 KB) | ~0.4s (CDN + Nuke prefetch) |
| Avatar in lista terapisti | 1-4 MB/card | 6-20 KB/card | 6-20 KB (cached after 1°) |
| Cold launch | 1.2s | 1.2s (no change) | 0.9s |
| Bookings tab load (10 sessions, 5 unique therapists) | 5 query seriali + 5 profile fetches = ~2.5s | Stesso (N+1 non fixato) | 0.3s con .in() batch |
| Bundle size | 35 MB | 35 MB | 27 MB (asset compress) |

---

## 🔐 Risk score post-fix

| Area | Pre-audit | Post-fix sessione | Post-tutti-fix |
|---|---|---|---|
| **GDPR leak** | 🔴 ALTO (anon read PII) | 🟠 MEDIO (fix in SQL pending) | 🟢 BASSO |
| **XSS WebView** | 🟠 MEDIO | 🟢 RISOLTO | 🟢 RISOLTO |
| **Shared device leakage** | 🟠 MEDIO | 🟢 RISOLTO | 🟢 RISOLTO |
| **App Store rejection** | 🔴 ALTO (5 blockers) | 🟠 MEDIO (3 blockers) | 🟢 BASSO |
| **Performance al 100x** | 🔴 ALTO | 🟠 MEDIO | 🟢 BASSO |

---

## File generati in questa sessione

```
/Users/marcello/Desktop/Holistic Unity/Security_Fixes/
├── 2026-05-18_critical_security_fixes.sql   ← DA RUNNARE NEL DASHBOARD
└── AUDIT_REPORT_2026-05-18.md               ← QUESTO FILE
```

Code changes in iOS:
- `Core/Extensions/URL+SupabaseStorage.swift` (NEW)
- `Core/Authentication/AuthManager.swift` (signOut hardening)
- `Holistic_UnityApp.swift` (URLCache strategy)
- `DesignSystem/Components/VideoPlayerViews.swift` (XSS fix)
- `DesignSystem/Components/HUAvatar.swift` (thumbnail)
- `Features/TherapistProfile/TherapistProfileView.swift` (XSS validation)
- `Holistic-Unity-Info.plist` (encryption flag)
- `Holistic Unity/PrivacyInfo.xcprivacy` (required reason APIs + data types)
- `Holistic Unity.xcodeproj/project.pbxproj` (it locale + healthcare category)
