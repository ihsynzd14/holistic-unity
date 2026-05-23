-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE POLICY FIX 2026-05-23 — chiudere cross-folder write su
-- profile-photos e video-intros, aggiungere DELETE policies mancanti.
--
-- Findings da STORAGE_AUDIT_2026-05-23.md:
--   #1 (HIGH): profile-photos INSERT non controllava il folder → user A
--              poteva sovrascrivere l'avatar di user B
--   #2 (HIGH): video-intros INSERT idem
--   #3 (LOW):  manca DELETE policy su profile-photos, video-intros, chat-media
--              → utenti non possono cancellare i propri file
--
-- Approccio: non distruttivo + IDEMPOTENTE. Ogni CREATE è preceduta da DROP
-- IF EXISTS sia del nome VECCHIO (legacy schema) sia del nome NUOVO che vado
-- a creare. Permette di rieseguire questa migration in caso di errori parziali
-- senza dover pulire manualmente da Dashboard.
--
-- Nota 2026-05-23 (ISKO): la prima esecuzione è fallita con
-- `42710: policy "Users can upload own profile photos" already exists` —
-- significa che il policy name è già in produzione (probabilmente da una
-- migration applicata via Dashboard ma non versionata localmente, oppure da
-- hardening parziale precedente). La versione corrente droppa anche i NUOVI
-- nomi prima di ricrearli, rendendo lo script safe to re-run.
--
-- Da applicare via Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 0 (DIAGNOSTIC, opzionale): mostra lo stato attuale prima del fix.
-- Decommenta ed esegui SEPARATAMENTE per ispezionare cosa c'è già in prod,
-- POI esegui il resto dello script.
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT policyname, cmd,
--        substring(qual::text from 1 for 120) AS using_expr,
--        substring(with_check::text from 1 for 120) AS check_expr
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
-- ORDER BY policyname;

-- ────────────────────────────────────────────────────────────────────────────
-- F1: profile-photos — INSERT folder-scoped + DELETE owner
-- ────────────────────────────────────────────────────────────────────────────

-- Drop sia il nome vecchio (legacy) che il nome nuovo (se già esistente in prod)
drop policy if exists "Authenticated users can upload profile photos" on storage.objects;
drop policy if exists "Users can upload own profile photos" on storage.objects;

create policy "Users can upload own profile photos"
    on storage.objects for insert
    with check (
        bucket_id = 'profile-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- DELETE policy (nuova): permette al proprietario di rimuovere i propri file.
-- Il therapist-webapp/.../profile/page.tsx:511 chiama .remove() per la
-- gallery, e oggi fallisce silenziosamente (nessuna policy DELETE);
-- l'aggiunta lo fa funzionare.
drop policy if exists "Users can delete own profile photos" on storage.objects;
create policy "Users can delete own profile photos"
    on storage.objects for delete
    using (
        bucket_id = 'profile-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- ────────────────────────────────────────────────────────────────────────────
-- F2: video-intros — INSERT folder-scoped + DELETE owner
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Authenticated users can upload video intros" on storage.objects;
drop policy if exists "Users can upload own video intros" on storage.objects;

create policy "Users can upload own video intros"
    on storage.objects for insert
    with check (
        bucket_id = 'video-intros'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

drop policy if exists "Users can delete own video intros" on storage.objects;
create policy "Users can delete own video intros"
    on storage.objects for delete
    using (
        bucket_id = 'video-intros'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- ────────────────────────────────────────────────────────────────────────────
-- F3: chat-media — DELETE owner (SELECT/INSERT già fixed in 20260414100100)
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Users can delete own chat media" on storage.objects;
create policy "Users can delete own chat media"
    on storage.objects for delete
    using (
        bucket_id = 'chat-media'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- ────────────────────────────────────────────────────────────────────────────
-- STEP FINAL (DIAGNOSTIC): verifica post-apply
-- ────────────────────────────────────────────────────────────────────────────
-- Decommenta ed esegui DOPO il resto per confermare lo stato finale.
-- Expected: ogni INSERT/UPDATE/DELETE policy ha un with_check/qual che
-- contiene la stringa `foldername` (cioè è folder-scoped). Nessuna policy
-- con `auth.role() = 'authenticated'` come unico check.
--
-- SELECT policyname, cmd,
--        substring(qual::text from 1 for 120) AS using_expr,
--        substring(with_check::text from 1 for 120) AS check_expr
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
-- ORDER BY policyname;
