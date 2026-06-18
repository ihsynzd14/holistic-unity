-- ─────────────────────────────────────────────────────────────────────────
-- Add "Quantum Touch Releasing® (QTR®)" to the practices taxonomy.
--
-- WHY THIS RUNS FIRST: the `validate_therapist_categories` trigger on
-- `therapist_profiles` rejects any category value that isn't a known
-- practice. Until this row exists, a therapist who selects Quantum Touch
-- Releasing in the profile editor (therapist-webapp) gets a 23514
-- "check_violation" save error. So: run this in Supabase → SQL Editor
-- BEFORE deploying the webapp code changes.
--
-- IDENTIFIER MODEL (mirrors supabase_seed_energy_process_practice.sql):
--   • slug         — kebab-case, language-neutral. THIS is the value the
--                    webapps key on: stored in therapist_profiles.categories[],
--                    matched by the practices listing, and mapped to a
--                    display label by the client maps.   → quantum-touch-releasing
--   • category_key — used by the onboarding recommendation engine
--                    (client-webapp/src/lib/onboarding/steps.ts). Kept ASCII
--                    so it matches the steps.ts option value byte-for-byte.
--                    → Quantum Touch Releasing
--   • title        — the display name shown on practice cards.
--
-- STEP 1 — eyeball an existing row first, to confirm the column set and the
-- conventions your live table actually uses (esp. the hero_image_url path
-- and any NOT NULL columns this script doesn't set):
--
--   select slug, category_key, title, tagline, hero_image_url,
--          what_is_it, who_benefits, what_to_expect, duration_typical_min,
--          faq, display_order, is_published, related_keys
--   from public.practices
--   where slug = 'seed-energy-process';
--
-- STEP 2 — insert QTR (idempotent: safe to re-run, won't duplicate):
-- ─────────────────────────────────────────────────────────────────────────

insert into public.practices (
  slug,
  category_key,
  title,
  tagline,
  what_is_it,
  who_benefits,
  what_to_expect,
  hero_image_url,
  duration_typical_min,
  display_order,
  is_published,
  faq,
  related_keys
)
select
  'quantum-touch-releasing',
  'Quantum Touch Releasing',
  $$Quantum Touch Releasing$$,
  $$Tecnica meditativa energetica vibrazionale per osservare schemi ricorrenti, sciogliere blocchi ereditati e ritrovare una direzione interiore più chiara.$$,
  $$Quantum Touch Releasing®, spesso abbreviato in QTR®, è una tecnica meditativa energetica vibrazionale fondata da Ileana Rotella. Secondo la QTR Academy, combina principi di fisica quantistica e geometria sacra con un lavoro di intenzione, simboli e parole, con l'obiettivo di risvegliare benessere e rendere più semplice orientarsi verso i propri obiettivi nelle diverse aree della vita. QTR® lavora attraverso particolari note vibrazionali composte da simboli e parole, guidate da un'intenzione specifica: nel linguaggio della tecnica vengono usate per portare attenzione ai blocchi energetici personali o ereditati attraverso l'albero genealogico — schemi che possono mantenere la persona intrappolata in dinamiche di sofferenza, bassa autostima o perdita di fiducia. Su Holistic Unity la presentiamo come pratica bionaturale, meditativa ed esperienziale: uno spazio per ascoltare ciò che si ripete, riconoscere le radici di un blocco e aprire un movimento interiore più consapevole, senza promesse e senza sostituire percorsi medici o psicologici.$$,
  $$È adatta a chi si sente attratto da un lavoro energetico, meditativo e simbolico e desidera esplorare un tema personale senza entrare necessariamente in un racconto lungo o puramente mentale. Può interessare chi sente di ripetere sempre gli stessi schemi, chi vive un momento di transizione, chi desidera lavorare su autostima e fiducia, oppure chi vuole osservare il proprio percorso da una prospettiva più intuitiva e spirituale. In presenza di trauma clinico, disturbi psicologici, condizioni mediche o forte instabilità emotiva, QTR® non sostituisce psicoterapia, cure mediche o supporto sanitario qualificato e può, al più, affiancarli come pratica complementare.$$,
  $$La sessione si apre condividendo il tema che desideri esplorare: un blocco, una paura, una scelta, una relazione o una sensazione che continua a tornare. Il professionista ti accompagna in uno stato di maggiore calma e presenza, per osservare il tema senza forzare o razionalizzare troppo. La tecnica utilizza particolari note vibrazionali composte da simboli e parole, guidate da un'intenzione specifica, come strumenti di consapevolezza e trasformazione energetica. La sessione si chiude con un momento di rientro e integrazione: puoi portare con te nuove intuizioni, una sensazione di maggiore chiarezza o semplici indicazioni per continuare ad ascoltarti. Le sessioni si svolgono efficacemente anche online via videochiamata.$$,
  null,            -- hero image: set to '/practices/heroes/quantum-touch-releasing.jpg' once the asset is added to client-webapp/public/practices/heroes/ (a brand illustration already exists at holistic-unity-website/images/qtr.png)
  60,              -- typical session length in minutes (adjust to the practitioners' norm)
  coalesce((select max(display_order) from public.practices), 0) + 10,
  true,
  $faq$[
    {"q": "QTR® è una terapia medica?", "a": "No. È una pratica energetica e meditativa di consapevolezza e crescita personale. Non effettua diagnosi, non cura patologie e non sostituisce percorsi sanitari o psicoterapeutici."},
    {"q": "Si può fare online?", "a": "Sì, molte pratiche energetiche e meditative vengono proposte anche online. La sessione richiede uno spazio tranquillo, una connessione stabile e disponibilità all'ascolto."},
    {"q": "Devo conoscere già la tecnica?", "a": "No. È sufficiente arrivare con un tema o un'intenzione. Il professionista ti guida passo dopo passo nel processo."},
    {"q": "Cosa significa lavorare con i simboli?", "a": "Nel linguaggio QTR®, simboli, parole e intenzioni vengono usati come strumenti vibrazionali e meditativi. Non sono strumenti diagnostici, ma elementi del metodo con cui il professionista accompagna l'esplorazione del tema."},
    {"q": "Quante sessioni servono?", "a": "Dipende dalla persona, dal tema e dal tipo di percorso. Alcune persone scelgono una singola sessione esplorativa, altre preferiscono lavorare su più incontri."}
  ]$faq$::jsonb,
  '{}'::text[]
where not exists (
  select 1 from public.practices where slug = 'quantum-touch-releasing'
);

-- STEP 3 — verify:
--   select slug, category_key, title, is_published, display_order
--   from public.practices where slug = 'quantum-touch-releasing';
--
-- NOTE: the onboarding recommender (client-webapp/src/lib/onboarding/steps.ts)
-- HAS been wired for QTR in code (focus areas energy / family_roots /
-- inner_listening / life_direction; approaches energetic / spiritual) — mirroring
-- how SEED and Sciamanesimo are surfaced. QTR is also self-reportable under
-- "practices you already know". If you'd rather not proactively recommend QTR
-- until enough practitioners offer it, remove "Quantum Touch Releasing" from the
-- focusMap/approachMap entries (it stays selectable + bookable regardless).
