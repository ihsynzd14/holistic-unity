# Isko Tapşırıqları - Holistic Unity İstifadədən Əvvəl (Pre-launch)

**Ümumi təxmini: 75-100 saat**

---

## 1. Təhlükəsizlik (8-12 saat)
- [ ] Supabase Dashboard-da `2026-05-18_critical_security_fixes.sql` işə salmaq (GDPR sızması, terapevtlərin Şəxsi Məlumatları - PII)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §11.5, §13.1
- [ ] `2026-05-18_db_migrations.sql` işə salmaq (`reports` + `blocked_users` cədvəlləri + 2 trigger)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §6.1, §13.1
- [ ] Bütün etimadnamələrin (credentials) fırlanması (Stripe, Supabase, Brevo, LiveKit, Stream Chat, FattureInCloud)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Hər bir `public.*` cədvəlində tam RLS auditi - anon key vasitəsilə heç bir məlumat görünməməlidir
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Storage bucket siyasətinin yoxlanılması (profile-photos, chat-media, video-intros, certificates)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Sürətli pen test (5 hücum: XSS email, booking cross-user, mənfi qiymət, rate limit reports, `auth.users` oxunması)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Bütün veb-tətbiqlərdə security header-lərin yoxlanılması və əlavə edilməsi - hədəf securityheaders.com = A
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] TrustKit certificate pinning üçün qərar: `reporting mode` → `enforce mode` (hə/yox səbəblə)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §11.3

---

## 2. QA - Bütün axınların (flows) test edilməsi (10-15 saat)
- [ ] F1-F20: müştərinin bütün axınları (sign-up email/Apple/Google, booking, ödəniş, ləğv etmə, video, chat, rəy, report, block, hesabın silinməsi)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] F21-F35: terapevtin bütün axınları (qeydiyyat, Stripe Connect, profil, mövcudluq, FattureInCloud, payout, video)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] F36-F42: cron job və webhook-lar Stripe (payment_intent.succeeded, charge.refunded, reminder 24h/1h, invoice FIC)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] `QA_MATRIX_2026-XX-XX.md` hazırlamaq - vəziyyəti ❓/✅ göstərən 42 sətir + skrinşot (screenshot)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4

---

## 3. Performans (15-20 saat)
- [ ] iOS tətbiqində hər bir `AsyncImage`-in auditi - hər istifadə üçün düzgün ölçülü `.supabaseThumbnail(size:)` tətbiq etmək
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Əvvəl və sonra Instruments ilə iOS cold start ölçmək (hədəf < 1.5s)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Supabase-dəki bütün `select("*")` sorğularını yalnız istifadə olunan sahələri aydın göstərən select ilə əvəz etmək
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] 4 əsas client-webapp səhifəsində Lighthouse auditi (hədəf Performance = 85, Accessibility = 90)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Hər yerdə `next/image` istifadəsini yoxlamaq (src/ içində sıfır `<img>`)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Supabase-də yavaş sorğuların auditi (Dashboard → Reports → Slow queries) - `getNearbyTherapists`, `getBookingsForUser`, `searchTherapists` üzərində Index Scan yoxlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Əvvəl/sonra cədvəli ilə `PERFORMANCE_REPORT_2026-XX-XX.md` hazırlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3

---

## 4. Sentry Quraşdırılması (6-8 saat)
- [ ] 4 Sentry layihəsi yaratmaq: iOS, client-web, therapist-web, admin-web
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Vercel env (3 webapp) və `Secrets.xcconfig` (iOS) içində DSN quraşdırmaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Hər deploy üçün source maps avtomatik yüklənməsini (upload) quraşdırmaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Xəbərdarlıq quraşdırmaq: hər yeni Error severity xətası və tezlik > 50/saat olduqda Marcello-ya email
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] `beforeSend` daxilində PII scrubbing (təmizləmə) quraşdırmaq (email, payment intent ID, JWT olmasın)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Hər layihə üçün ən azı 1 test hadisəsinin skrinşotu ilə `SENTRY_RUNBOOK.md` hazırlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5

---

## 5. Gündəlik Səhv Rutini (4-6 saat setup, sonra 15dəq/gün)
- [ ] 5 mənbədən məlumat toplayan skript yaratmaq: Sentry, Vercel logs, Supabase logs, Stripe API, App Store Connect
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6
- [ ] Hər səhər saat 08:00-da GitHub Actions (və ya Vercel Cron) vasitəsilə avtomatik göndərilməsini planlaşdırmaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6
- [ ] Göndərilən ilk hesabatın nümunəsi ilə `MONITORING_RUNBOOK.md` hazırlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6

---

## 6. Email Auditi (8-12 saat)
- [ ] 15 müştəri emailini (C1-C15) yoxlamaq: 60 saniyə ərzində çatır, HTML doğrudur, linklər işləyir
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] 17 terapevt emailini (T1-T17) yoxlamaq: 60 saniyə ərzində çatır, HTML doğrudur, linklər işləyir
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] 4 admin emailini (A1-A4) yoxlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] DNS yoxlamaq: SPF, DKIM (`brevo._domainkey.holisticunity.app`), DMARC - hamısı keçməlidir (pass)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] mail-tester.com üzərində test - hədəf xal = 9/10
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Əskik və ya xətalı Brevo şablonlarını yaratmaq/düzəltmək
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] `EMAIL_AUDIT_2026-XX-XX.md` hazırlamaq - hər bir email üçün vəziyyəti göstərən 36 sətirlik matris
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7

---

## 7. Code review və iOS xətaları (bug) (12-16 saat)
- [ ] iOS: Bütün Repository-lərdə xətaların idarə olunmasını yoxlamaq (kritik əməliyyatlarda `try?` olmaz)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: UI-yə toxunan hər şeydə doğru `@MainActor` olduğunu yoxlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: `LiveKitService` reconnection (yenidən qoşulma) məntiqini yoxlamaq (seans zamanı şəbəkə kəsilərsə)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: `StreamChatService` memory leak (yaddaş sızması) yoxlamaq (controller-lər sərbəst buraxılmır)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Edge Functions: `stripe-webhook` istisna olmaqla hər function `verify_jwt: true` olmalıdır
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1, `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §6.2
- [ ] Webapp: `SUPABASE_SERVICE_ROLE_KEY`-in heç vaxt müştəri (client) kodunda istinad edilmədiyini yoxlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Webapp: Server Actions-da ilk sətir kimi `requireAuth()` olması
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Kateqoriya üzrə xətalarla (Critical / High / Medium / Low) `CODE_REVIEW_2026-XX-XX.md` hazırlamaq
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] BUG #2 iOS: `SupabaseAuthRepository.swift` (`fetchUserProfile`) daxilində, vahid həqiqət mənbəyi kimi (single source of truth) `client.auth.currentSession?.user.emailConfirmedAt != nil` oxuyaraq `isEmailVerified` üzərinə yazmaq (verilənlər bazasındakı `public.users.is_email_verified` köhnə istifadəçilər üçün sinxronlaşdırılmamış ola bilər)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-2
- [ ] BUG #4 Free booking (€0): `create-booking-with-payment/index.ts` daxilində, `sessionPriceCents === 0` halını idarə etmək: Stripe məntiqini atlamaq (skip) və rezervasiyanı birbaşa `status='confirmed'` olaraq daxil etmək (onun `pending_payment` qalmasının qarşısını almaq üçün)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-4

---

## 8. Təhlükəsizlik - auditdən əlavə düzəlişlər (4-6 saat)
- [ ] Price tampering (Qiymət saxtalaşdırılması) düzəlişi: `create-booking-with-payment` server tərəfində bazaya qarşı qiyməti təsdiq etmir - client payload-da istənilən məbləği göndərə bilər
  → ref: `02_Documentation/SECURITY_AUDIT.md` §price-tampering
- [ ] OAuth state-i kriptoqrafik olaraq təsadüfi (random) etmək: `OAUTH_STATE_SECRET` generasiyasını `crypto.getRandomValues` ilə əvəz etmək (hazırda kifayət qədər random deyil)
  → ref: `02_Documentation/SECURITY_AUDIT.md` §oauth-state, `02_Documentation/legacy_docs_folder/INCIDENT_RESPONSE.md` §2.6
- [ ] Fayl yükləməsi (upload) üçün server tərəfində MIME doğrulamasını əlavə etmək (hazırda yalnız client tərəfindədir) - `Storage` edge-də belə icazə verilməyən content-type fayllarını rədd etmək
  → ref: `02_Documentation/SECURITY_AUDIT.md` §file-upload
- [ ] `conversation_participants`, `notifications`, `conversations` cədvəllərində INSERT siyasətini (policy) məhdudlaşdırmaq - hazırda `anon` rolu üçün çox icazə verilir
  → ref: `02_Documentation/SECURITY_RULES.md`
- [ ] `JailbreakDetector.swift` haqqında qərar vermək: `IOSSecuritySuite` (SPM) inteqrasiya etmək və ya faylı silmək - hazırda həmişə `false` qaytarır (Apple rəyçisi üçün yanıldıcıdır)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §9
- [ ] `validate-promo` Edge Function-u deploy etmək və ya iOS rezervasiya axınından promo sahəsini silmək - hazırda `BookingFlowView.swift:142` onu çağırır və səssizcə xəta verir (fails silently)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 9. App Store Submission (Göndərmə) (4-6 saat)
- [ ] Dual `Info.plist` problemini həll etmək: `GENERATE_INFOPLIST_FILE = YES` və ayrıca `Holistic-Unity-Info.plist` faylı eyni vaxtda mövcuddur - Apple doğru plist əvəzinə pbxproj-dan zəif usage description-ları oxuya bilər
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §7
- [ ] supabase-swift SDK-nı ən son versiyaya yeniləmək (son versiyalar daxilində `PrivacyInfo.xcprivacy` var - Apple köhnə versiyaları işarələyir)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §12
- [ ] `SupabaseTherapistRepository.swift` Refactor: `therapist_profiles` üzərindəki 5 birbaşa `SELECT`-i `therapist_profiles_public` view ilə əvəz etmək (sətir 21, 53, 102, 214, 362)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §6
- [ ] App Store Description + Keywords italyancaya tərcümə etmək (hazırda `knownRegions` `it` ehtiva edir, lakin App Store Connect-dəki metadata yalnız EN-dir)
  → ref: `03_Security_and_Audits/FINAL_REPORT_2026-05-18.md` §U5
- [ ] Reviewer account-un (rəyçi hesabının) real cihazda işləməsini yoxlamaq: login `reviewer@holisticunity.app` / `AppleReviewer2026!` → Home → booking €0 → Prenotazioni (Rezervasiyalar) tabı
  → ref: `03_Security_and_Audits/FINAL_REPORT_2026-05-18.md` §U3, `04_App_Store_Submission/App_Review_Notes.md`
- [ ] Submission üçün tələb olunan public URL-ləri əldə etmək məqsədilə `privacy-policy.html` və `support.html` statik fayllarını deploy etmək (məsələn, Netlify Drop və ya Vercel vasitəsilə)
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §1
- [ ] App Store Connect məlumatlarını doldurmaq: 4 skrinşot 1320×2868 (`06_App_Store_Screenshots/`), ikon 1024×1024, IT+EN metadata, Pricing Free, privacy questionnaire, build seçimi yükləmək
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §4
- [ ] Xcode: Archive → Distribute → Upload to App Store Connect → Submit for Review
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §3, §5
- [ ] Apple/Google sign-in axınının 4-cü Maddə (Art. 9) razılıq checkbox-larından (consent) keçdiyini yoxlamaq (hazırda atlanılıb - yalnız email qeydiyyatında var)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 10. Stripe TEST → LIVE Miqrasiyası (1-2 saat, bir dəfəlik)
- [ ] Tam `STRIPE_LIVE_MIGRATION.md` runbook-nu izləmək: 2 LIVE webhook endpoint yaratmaq (client-webapp + Edge Function), Vercel env-dəki bütün Stripe açarlarını (keys) dəyişdirmək, Supabase secrets-də `whsec_*` yeniləmək
  → ref: `02_Documentation/STRIPE_LIVE_MIGRATION.md`
- [ ] Miqrasiyadan sonra ilk real ödənişin end-to-end işləməsini yoxlamaq (€1 real rezervasiya, `payment_intent.succeeded` webhook alınıb, rezervasiya təsdiqlənib, payout planlaşdırılıb)
  → ref: `02_Documentation/STRIPE_LIVE_MIGRATION.md` §verifica-finale
- [ ] `create-connect-account` Edge Function-da `country` (ölkə) dəstəyini yoxlamaq: Braziliya / Malayziya / Tailand / Hindistan ayrıca avtomatik payout tələb edir - `STRIPE_CONNECT_COUNTRIES`-in lazımi ölkələri əhatə etdiyini yoxlamaq
  → ref: `02_Documentation/05_STATUS_TRACKER.md`

---

## 11. Texniki borc (Technical debt) GDPR / hüquqi (8-12 saat)
- [ ] DPIA (Data Protection Impact Assessment) yazmaq (Sağlamlıqla bağlı Art. 9 məlumatları üçün GDPR Art. 35 məcburidir) - ICO və ya CNIL şablonundan istifadə etmək, ~1 iş günü
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Stream Chat, LiveKit, Brevo, Sentry ilə DPA (Data Processing Agreement) tələb etmək və imzalamaq (Stripe + Supabase + Vercel avtomatik qəbul edir)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Cədvəllər üzrə məlumat saxlama (retention) matrisi yaratmaq: chat mesajları, sessiyalar, tranzaksiyalar (vergi öhdəlikləri üçün 10 il), tamamlanmış rezervasiyalar (bookings)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Brevo dashboard-da Brevo double opt-in aktiv olmasını yoxlamaq
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] `charge.dispute.created` idarə etmək: 14 günlük escrow (zəmanət) müddətindəki chargeback, Stripe `disputed` olduğu halda DB-də `payout_status='paid'` saxlayır - webhook handler + `transactions` cədvəlində `'disputed'` statusu əlavə etmək
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] `stripe_webhook_events` üçün cron təmizlənməsi əlavə etmək: cədvəl limitsiz olaraq ~3.600 sətir/ay böyüyür - gündəlik `DELETE WHERE created_at < now() - interval '7 days'` əlavə etmək
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] `health_data_accept` üçün UI re-consent (yenidən razılıq) yaratmaq: serverdən 412 xətası gəldikdə görünən, istifadəçiyə yenidən qeydiyyatdan (re-signup) keçmədən razılıq verməyə imkan verən modal (böyük həcmli buraxılışdan əvvəl lazımdır)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 12. Performans - əlavə düzəlişlər (3-5 saat)
- [ ] Prenotazioni (Rezervasiyalar) tabında N+1 query xətasının düzəldilməsi (iOS): `ClientTabView.swift:2243-2247` hər terapevt üçün serial olaraq `getProfile()` edir → tək `.in("id", values: [ids])` sorğusu ilə əvəz etmək (30 sorğu → 1, ~3-5s → ~200ms)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §11
- [ ] `searchTherapists` filter və sort (çeşidləmə) məntiqini server tərəfinə keçirmək (hazırda fetch serverdə, amma "Highest Rated" + "Lingua" filteri client-side edilir - 100x miqyasda top nəticələr ilk səhifələrdə görünməyəcək)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Dashboard webapp waterfall üzərində `Promise.all`: asılılıq olmayan yerlərdə serial fetch-ləri paralel fetch-lər ilə əvəz etmək
  → ref: `02_Documentation/IMPROVEMENTS.md`

---

## 13. UX - sürətli uğurlar (quick wins) və UI xətaları (4-5 saat)
- [ ] Doğma `window.prompt()` və `window.confirm()`-i custom modallarla əvəz etmək - mobil cihazlarda qeyri-sabit və bloklayıcıdır
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] Ödənişdən əvvəl checkout-da görünən refund policy (geri qaytarma siyasəti) tooltip əlavə etmək (3 səviyyə: 100% / 50% / 0%)
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] Terapevt onboarding zamanı progress bar (irəliləyiş zolağı) əlavə etmək (hazırda cari addım barədə heç bir vizual rəy yoxdur)
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] Terapevt profil səhifəsində mobil üçün sticky "Prenota sessione" (Sessiya rezerv et) CTA (Call To Action)
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] BUG #5 iOS (Email Autocorrect): `AuthView.swift` və `EditProfileView.swift` fayllarında email formalarına `.keyboardType(.emailAddress)`, `.textInputAutocapitalization(.never)` və `.autocorrectionDisabled(true)` əlavə etmək
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-5
- [ ] BUG #6 iOS (Account Stats sıfırdır): Label-i "SESSIONI" əvəzinə "SESSIONI COMPLETATE" (Tamamlanmış Sessiyalar) olaraq dəyişdirmək və ya rezervasiya edib hələ sessiyasını tamamlamamış yeni istifadəçiləri qorxutmamaq üçün sorğuya `confirmed` daxil etmək
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-6
- [ ] BUG #9 iOS (Tap area Explore): Kartlarla hit-test conflict (toqquşma) olmaması üçün `AllTherapistsView`-da `quickFilterRow` və `therapistsListSection` arasında şaquli (vertical) padding-i artırmaq
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-9
- [ ] BUG #7 Matchmaker (RecommendPractices): Matchmaker SQL-in tam hədəfə uyğun terapevtləri niyə gizlətdiyini araşdırmaq (order by rating, limit və ya kebab-case xətalarını yoxlamaq)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-7

---

## 14. Terapevt profili və etimadnamələr - uyğunluq (mapping) boşluqları (3-4 saat)
- [ ] Webapp terapevt dashboard-da profilin redaktə (edit profile) görünüşünə `country` (ölkə) sahəsi əlavə etmək (iOS-da görünür, lakin vebdə redaktə edilə bilmir)
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] `auth.users` və `therapist_profiles` arasında `display_name` sync trigger-ini yoxlamaq - profil yeniləndikdə desync olma ehtimalı var
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] iOS-da göstərilən lakin dashboard-dan redaktə edilə bilməyən sahələri uyğunlaşdırmaq: tam siyahını yoxlamaq və əskik sahələri therapist webapp edit profil formasına əlavə etmək
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] Azure Portal-da Outlook OAuth üçün `MICROSOFT_CLIENT_SECRET`-i yenidən yaratmaq, Vercel `therapist-webapp`-da yeniləmək və redeploy etmək (GAP 8: 401 Failed to fetch Microsoft profile xətasını həll edir)
  → ref: `04_App_Store_Submission/MICROSOFT_OUTLOOK_SECRET_REGEN.md`

---

**Yenilənmiş ümumi təxmin: ~95-129 saat ≈ 3-4 həftə**
