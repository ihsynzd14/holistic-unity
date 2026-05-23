# Storage Bucket Audit — `storage.objects` policies

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: tutti i bucket Supabase Storage del progetto `bqyqkvkzkemiwyqjkbna`. Verifica che user A non possa leggere/scrivere oggetti di user B.

**Result**: 🟡 **MOSTLY PASS — 2 finding di severity HIGH risolvibili con 1 migration SQL non-distruttiva**. I bucket `certificates` e `chat-media` sono fully hardened. I bucket pubblici `profile-photos` e `video-intros` hanno una **INSERT policy troppo permissiva** (`auth.role() = 'authenticated'`) che permetterebbe a user A di scrivere file nella cartella di user B. Fix proposto: `03_Security_and_Audits/2026-05-23_storage_policy_fixes.sql`.

---

## Naming gap della task list

La task list cita 4 bucket: `gallery_images`, `profile_photos`, `intro_videos`, `documents`. **Nessuno di questi nomi esiste in produzione**. I bucket reali (verificati in `legacy_initial_schema.sql:729-735` + iOS [`SupabaseConfig.swift:91-94`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Networking/SupabaseConfig.swift)):

| Task list (nome immaginato) | Bucket reale | Note |
|------------------------------|--------------|------|
| `gallery_images` | _non esiste come bucket separato_ | La gallery vive dentro `profile-photos/${user_id}/gallery/{uuid}.ext` (verificato in [`therapist-webapp/.../dashboard/profile/page.tsx:470`](../08_Codebases/therapist-webapp/src/app/dashboard/profile/page.tsx)) |
| `profile_photos` | `profile-photos` (kebab-case) | `public = true` |
| `intro_videos` | `video-intros` | `public = true` |
| `documents` | _non esiste_ | Il bucket più affine è `certificates` (`public = false` dal 20260408110000_launch_hardening) |
| (mancante) | `chat-media` | `public = false` |

**Audit reale**: 4 bucket effettivi.

---

## Inventario bucket (static analysis)

Sorgente: `07_Database_Migrations/legacy_initial_schema.sql:729-735` + `all_migrations_pg/20260408110000_launch_hardening.sql:42-44` (flip `certificates.public = false`) + `all_migrations_pg/20260414100100_chat_media_rls_participant_scope.sql` (chat-media rewrite).

| Bucket | `public` flag (atteso prod) | SELECT policy | INSERT policy | UPDATE policy | DELETE policy |
|--------|------------------------------|----------------|----------------|----------------|----------------|
| **`profile-photos`** | `true` | Anyone (`bucket_id = 'profile-photos'`) | ⚠️ `auth.role() = 'authenticated'` — qualsiasi auth user, NESSUN folder check | Owner only (`auth.uid()::text = foldername[1]`) | ⚠️ **mancante** |
| **`certificates`** | `false` (post-hardening) | Owner only ✅ | Owner only ✅ | Owner only ✅ | Owner only ✅ |
| **`chat-media`** | `false` | Owner OR co-participant ✅ (post-fix 20260414100100) | Owner only ✅ | mancante | mancante |
| **`video-intros`** | `true` | Anyone | ⚠️ `auth.role() = 'authenticated'` — qualsiasi auth user, NESSUN folder check | Owner only | ⚠️ **mancante** |

---

## Naming convention upload (app code)

Verificata in [`therapist-webapp/src/app/dashboard/profile/page.tsx:395,470`](../08_Codebases/therapist-webapp/src/app/dashboard/profile/page.tsx) e [`iOS_App/.../SettingsView.swift:716`](../08_Codebases/iOS_App/Holistic%20Unity/Features/Settings/SettingsView.swift):

- Avatar: `${user.id}/avatar.${ext}` (overwrite con `upsert: true`)
- Gallery: `${user.id}/gallery/${crypto.randomUUID()}.${ext}`
- Certificates: `${user.id}/...` (verificato in `SupabaseTherapistRepository.swift:429`)
- Chat media: `${user.id}/...` (path enforced lato app)
- Video intros: `${user.id}/...`

**Conclusione**: l'app **già usa la folder convention corretta** (primo segmento = `user.id`). L'UPDATE policy esistente su `profile-photos` e `video-intros` lo conferma. Manca SOLO il check sull'INSERT.

---

## Findings (3 issue)

### 🔴 FINDING #1 — `profile-photos` INSERT policy permette write cross-folder (HIGH)

**Source**: [`legacy_initial_schema.sql:742-747`](../07_Database_Migrations/legacy_initial_schema.sql)
```sql
create policy "Authenticated users can upload profile photos"
    on storage.objects for insert
    with check (
        bucket_id = 'profile-photos'
        and auth.role() = 'authenticated'   -- ⚠️ no folder check
    );
```

**Impact**: un client logged-in (user A) può fare upload `POST /storage/v1/object/profile-photos/{userB_id}/avatar.jpg` con `upsert: true` e **sovrascrivere l'avatar di user B**. Se l'app legge `photo_url` dal DB (URL deterministico `${user_id}/avatar.${ext}` cache-busted con timestamp), la sostituzione si propaga.

**Severity HIGH** perché:
- È un trust/reputation attack su therapist profile photos (esposti in client discovery)
- È un GDPR concern (modifica non autorizzata di immagine di altro utente)
- L'attacco non richiede skill speciali: account standard + `curl` + UUID target

**Mitigazione esistente**: l'UPDATE policy È owner-scoped, quindi un attacker non può modificare via PATCH. Ma INSERT con `upsert:true` chiama `UPSERT` (INSERT + replace su collision), e i client SDK Supabase mappano `upsert:true` su INSERT. Da verificare in QA se `upsert:true` passi sia INSERT che UPDATE policy o solo INSERT. **Worst case**: attacco funziona via INSERT con nome univoco (non avatar.jpg ma `avatar.svg` ecc.).

### 🔴 FINDING #2 — `video-intros` INSERT policy permette write cross-folder (HIGH)

**Source**: [`legacy_initial_schema.sql:788-793`](../07_Database_Migrations/legacy_initial_schema.sql)
```sql
create policy "Authenticated users can upload video intros"
    on storage.objects for insert
    with check (
        bucket_id = 'video-intros'
        and auth.role() = 'authenticated'   -- ⚠️ no folder check
    );
```

**Impact**: identico al #1. Un user può caricare un video offensivo/malevolo nella cartella di un altro terapeuta. Severity HIGH (più alta del #1 perché i video intro sono mostrati prominentemente nel profilo del terapeuta).

### 🟡 FINDING #3 — Mancano DELETE policies su `profile-photos`, `video-intros`, `chat-media` (LOW)

**Impact**: gli utenti non possono cancellare i propri file (es. rimuovere una foto dalla gallery). Il [`therapist-webapp/.../profile/page.tsx:511`](../08_Codebases/therapist-webapp/src/app/dashboard/profile/page.tsx) tenta `.remove()` ma probabilmente fallisce silenziosamente, lasciando file orfani in storage (operational concern, non security). `service_role` può sempre cancellare, quindi recovery manuale è possibile.

Severity LOW: non è un leak, è un mancato cleanup. Vale la pena risolverlo nella stessa migration.

---

## Black-box test live (anon role, 2026-05-23)

| # | Test | Endpoint | Expected | Actual | Pass |
|---|------|----------|----------|--------|------|
| 1 | List all buckets (anon) | `GET /storage/v1/bucket` | `[]` (no GRANT) | `[]` HTTP 200 | ✅ |
| 2 | List `profile-photos` root (anon) | `POST /storage/v1/object/list/profile-photos` | listable (public bucket) | returned 3 UUID folder names | ✅ design-intended |
| 3 | List `certificates` root (anon) | `POST /storage/v1/object/list/certificates` | denied | `[]` | ✅ |
| 4 | List `chat-media` root (anon) | `POST /storage/v1/object/list/chat-media` | denied | `[]` | ✅ |
| 5 | List `video-intros` root (anon) | `POST /storage/v1/object/list/video-intros` | listable (public) | returned 1 UUID folder | ✅ design-intended |
| 6 | Upload to `profile-photos` (anon) | `POST /storage/v1/object/profile-photos/{uuid}/test.txt` | denied | `403 — new row violates row-level security policy` (HTTP 400) | ✅ |
| 7 | Public read `profile-photos` | `GET /storage/v1/object/public/profile-photos/{user}/avatar.jpg` | works (public) | HTTP 200 | ✅ |
| 8 | Public read `chat-media` via public URL | `GET /storage/v1/object/public/chat-media/test.jpg` | denied | HTTP 400 | ✅ |
| 9 | Deep list `profile-photos/{user}/gallery` (anon) | `POST /storage/v1/object/list/profile-photos` con prefix | listable (public) | returned 3 files with metadata (size, mimetype, eTag) | ⚠️ info-disclosure |

**Resultato**: 9/9 PASS per anon. Per **authenticated cross-folder write** (i 2 finding HIGH) il test richiederebbe un secondo account → non eseguito empiricamente in questo audit, ma la lettura del migration file rende il bug certo.

---

## Information disclosure minore (no fix necessario)

**Anon LIST sui bucket pubblici** (`profile-photos`, `video-intros`) ritorna i nomi delle cartelle (= UUID utenti) e dei file. Per `profile-photos` un attacker può:
- Enumerare tutti gli `user.id` che hanno caricato qualcosa (clients + therapists mescolati — gli avatar dei client iOS pure finiscono qui)
- Listare i file in ogni cartella, scoprire dimensioni/timestamp

**Perché non lo classifichiamo come finding**: il design di un bucket Supabase pubblico è "publicly accessible". Per nascondere i metadata serve `public = false` + signed URL per il download — ma questo romperebbe l'attuale flusso (i `photo_url` salvati nel DB sono URL `/storage/v1/object/public/...`). Trade-off accettabile finché:
- Gli UUID utente non sono considerati sensitive (sono GDPR pseudonymous IDs — Supabase usa lo stesso pattern di default)
- L'avatar di un client iOS è di solito niente più che un'iniziale colorata generata client-side (nessuna immagine real life uploaded per default)

**Follow-up** se diventa un issue: spostare l'avatar dei CLIENTS in un bucket separato `client-avatars` con `public=false` + signed URL.

---

## Fix proposto

Vedi [`2026-05-23_storage_policy_fixes.sql`](2026-05-23_storage_policy_fixes.sql) per la migration completa. In sintesi:

```sql
-- Drop e ricrea INSERT policies con folder check
drop policy if exists "Authenticated users can upload profile photos" on storage.objects;
create policy "Users can upload own profile photos"
    on storage.objects for insert
    with check (
        bucket_id = 'profile-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- Stesso pattern per video-intros
drop policy if exists "Authenticated users can upload video intros" on storage.objects;
create policy "Users can upload own video intros"
    on storage.objects for insert
    with check (
        bucket_id = 'video-intros'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- Add DELETE policies (operational)
create policy "Users can delete own profile photos"
    on storage.objects for delete
    using (
        bucket_id = 'profile-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
    );
-- ... (analoghe per video-intros, chat-media)
```

**Da applicare via Supabase Dashboard SQL Editor** (CLI/psql non doable senza Docker+DB-password, vedi RLS_AUDIT_2026-05-22.md per dettagli).

---

## Impact assessment del fix

**Risposta alle 3 domande standard del progetto**:

| Domanda | Risposta |
|---------|----------|
| **Cambierà UI/UX?** | **NO.** Le policy storage sono invisibili all'utente. Il flusso esistente (upload avatar, upload gallery, upload video intro) continua a funzionare identico perché l'app già fa upload a `${user.id}/...` (folder convention corretta). |
| **Funzioni a rischio di rottura?** | **NESSUN flusso esistente si rompe**, perché: (a) `therapist-webapp/.../profile/page.tsx` usa `${authUser.id}/avatar.${ext}` e `${authUser.id}/gallery/${uuid}.${ext}` → folder[1] === auth.uid() ✓; (b) iOS `SettingsView.swift:716` upload con folder convention identica; (c) il fix RIMUOVE la capacità di scrivere FUORI dalla propria cartella (cioè rimuove un bug, non funzionalità). L'unico "rischio" è se esistesse codice che fa upload a `shared/...` o simili — verificato grep su tutto `08_Codebases`: zero match per upload con path non-user-scoped. |
| **Aumento performance?** | **Marginalmente NEGATIVO, negligible.** Il check `auth.uid()::text = (storage.foldername(name))[1]` è funzionalmente equivalente all'attuale `auth.role() = 'authenticated'` (entrambi una stringa compare). `storage.foldername()` è una function STABLE che fa string split — overhead microsecondi. Non c'è alcun join o subquery aggiunta. |

---

## Verifica post-fix (suggerita)

1. Apply fix via Dashboard.
2. Smoke test: avatar upload da un terapeuta + un client iOS → continua a funzionare.
3. Penetration test (richiede 2 account):
   ```bash
   # Sign in come user A, prova upload nella cartella di user B
   curl -X POST "$URL/storage/v1/object/profile-photos/<USER_B_ID>/attack.jpg" \
     -H "Authorization: Bearer <USER_A_JWT>" -F "file=@/tmp/attack.jpg"
   # Expected post-fix: 403 "new row violates row-level security policy"
   ```
4. Verifica gallery flow nel dashboard therapist.
5. Verifica delete: rimuovere immagine gallery → deve sparire da storage (non più orfana).

---

## File touched

- 📄 [`03_Security_and_Audits/STORAGE_AUDIT_2026-05-23.md`](STORAGE_AUDIT_2026-05-23.md) — questo report
- 📄 [`03_Security_and_Audits/2026-05-23_storage_policy_fixes.sql`](2026-05-23_storage_policy_fixes.sql) — migration SQL pronta da applicare
- ✏️ [`01_START_HERE/01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — checkbox `[-]` (partial: audit completo, fix non ancora applicato in prod) + nota inline
