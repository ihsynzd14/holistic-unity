-- ─────────────────────────────────────────────────────────────────────────
-- Add "SEED – Energy Process" to the practices taxonomy.
--
-- WHY THIS RUNS FIRST: the `validate_therapist_categories` trigger on
-- `therapist_profiles` rejects any category value that isn't a known
-- practice. Until this row exists, a therapist who selects SEED in the
-- profile editor (therapist-webapp) gets a 23514 "check_violation" save
-- error. So: run this in Supabase → SQL Editor BEFORE deploying the
-- webapp code changes.
--
-- IDENTIFIER MODEL (see client-webapp/src/app/welcome/page.tsx +
-- client-webapp/src/app/dashboard/pratiche/page.tsx):
--   • slug         — kebab-case, language-neutral. THIS is the value the
--                    webapps key on: stored in therapist_profiles.categories[],
--                    matched by the practices listing, and mapped to a
--                    display label by the client maps.   → seed-energy-process
--   • category_key — used by the onboarding recommendation engine
--                    (client-webapp/src/lib/onboarding/steps.ts). Kept ASCII
--                    so it matches the steps.ts option value byte-for-byte.
--   • title        — the display name shown on practice cards (en-dash).
--
-- STEP 1 — eyeball an existing row first, to confirm the column set and the
-- conventions your live table actually uses (esp. the hero_image_url path
-- and any NOT NULL columns this script doesn't set):
--
--   select slug, category_key, title, tagline, hero_image_url,
--          what_is_it, who_benefits, what_to_expect, duration_typical_min,
--          faq, display_order, is_published, related_keys
--   from public.practices
--   where slug = 'theta-healing';
--
-- STEP 2 — insert SEED (idempotent: safe to re-run, won't duplicate):
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
  'seed-energy-process',
  'SEED - Energy Process',
  $$SEED – Energy Process$$,
  $$Lavoro energetico di risveglio interiore per riallinearti con la tua anima, la tua autenticità e la tua missione.$$,
  $$SEED – Energy Process® è la pratica energetica di risveglio interiore sviluppata da Gioia Mandriola e Giorgio Alloa, fondatori di SEED Academy. In una sessione il facilitatore crea un ponte diretto tra l'anima incarnata — la parte di te che vive blocchi, paure e resistenze — e l'anima individuale, che racchiude il tuo massimo potenziale e la mappa del percorso che hai scelto di compiere in questa vita. A differenza di molti approcci che lavorano su un solo aspetto, SEED accompagna un lavoro su più livelli — fisico, mentale, energetico e spirituale. È una pratica olistica di crescita personale e spirituale e non sostituisce la psicoterapia o la cura medica.$$,
  $$È adatta a chi sente di lottare per una vita che non gli appartiene e desidera riconoscere ciò che vuole davvero, sciogliendo i blocchi che lo frenano. Accompagna chi cerca il coraggio di mostrarsi per ciò che è, di lasciar andare il giudizio e di esprimere i propri talenti, e chi vuole ritrovare chiarezza, direzione e la forza di realizzare i propri progetti.$$,
  $$La sessione si apre condividendo ciò che desideri lasciare andare, trasformare o raggiungere. Il facilitatore si connette poi con la parte della tua anima che custodisce le informazioni utili in questo momento: emergono memorie, schemi inconsci e credenze limitanti che vengono portati alla luce e rilasciati o integrati, accompagnati da musica specifica che facilita profondità e introspezione. Al termine, attraverso una condivisione finale, ricevi chiarezza sul processo e strumenti pratici per ancorare la trasformazione nelle settimane successive. Le sessioni si svolgono efficacemente anche online via videochiamata.$$,
  null,            -- hero image: set to '/practices/heroes/seed-energy-process.jpg' once the asset is added to client-webapp/public/practices/heroes/
  60,              -- typical session length in minutes (adjust to the facilitators' norm)
  coalesce((select max(display_order) from public.practices), 0) + 10,
  true,
  $faq$[
    {"q": "Cos'è SEED – Energy Process®?", "a": "SEED – Energy Process® è una pratica energetica e di risveglio interiore che guida verso il riallineamento con la propria missione d'anima. Il nome SEED significa «seme»: in ogni sessione il facilitatore crea una connessione tra la tua parte animica presente nel corpo fisico e la parte animica più autentica, che custodisce il potenziale della creazione."},
    {"q": "SEED – Energy Process® si svolge online?", "a": "Sì, le sessioni funzionano efficacemente anche online via videochiamata. Molti riceventi riportano la stessa profondità dell'incontro in presenza; anzi, trovarsi nel proprio spazio personale può favorire un migliore stato di apertura."},
    {"q": "Di quante sessioni ho bisogno?", "a": "Ogni persona è unica. Alcuni riceventi sperimentano cambiamenti significativi già dalla prima sessione, altri preferiscono un percorso strutturato nel tempo. Il facilitatore ti guiderà nella scelta più adatta a te."},
    {"q": "Devo fare qualcosa per prepararmi?", "a": "Ti consigliamo di arrivare alla sessione con un'intenzione chiara di ciò che desideri trasformare nella tua vita."}
  ]$faq$::jsonb,
  '{}'::text[]
where not exists (
  select 1 from public.practices where slug = 'seed-energy-process'
);

-- STEP 3 — verify:
--   select slug, category_key, title, is_published, display_order
--   from public.practices where slug = 'seed-energy-process';
--
-- NOTE on the onboarding recommender: this script does NOT wire SEED into
-- the focus-area / approach scoring maps in steps.ts (that's a content
-- decision). SEED is selectable, listed, displayed and bookable as-is; it
-- will also surface in onboarding when a user marks it under "practices you
-- already know". Tune recommendPractices() separately if you want it
-- proposed from focus areas too.
