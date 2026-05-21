/**
 * Onboarding step configuration.
 *
 * Single source of truth for the 7-step onboarding flow at /welcome.
 * Each step is rendered by the same generic component; the only thing
 * that changes is the question, hero image, and answer config.
 *
 * Copy guidelines (CRITICAL):
 *   - Holistic Unity is NOT psychotherapy. We must never use words like
 *     "cura", "trattamento", "diagnosi", "terapia", "psicologo",
 *     "terapeuta", "disturbo", "soffri di", or any wording implying
 *     medical efficacy.
 *   - Use: "esplorazione", "pratica", "percorso", "ascolto",
 *     "consapevolezza", "benessere", "facilitatore", "professionista
 *     olistico", "guida", "operatore".
 *   - Tone: warm, exploratory, agency-preserving. The client is
 *     "attraversando", "esplorando", "sentendo il bisogno di" — never
 *     "afflicted by" or "diagnosed with".
 */

export type StepType = "single" | "multi" | "text";

export type AnswerOption = {
  value: string;
  label: string;
  description?: string;
};

export type StepConfig = {
  id: string;
  type: StepType;
  // Lookup key into the i18n bundle, kept in onboarding.ts under each step's id
  i18nKey: string;
  options?: AnswerOption[];
  optional?: boolean;
  // Image source — populated later (FAL-generated heroes uploaded to Supabase Storage)
  // Falls back to a CSS gradient hero if missing.
  heroSrc?: string;
  /** Soft minimum number of answers for multi-select to be considered complete */
  minSelections?: number;
};

export const ONBOARDING_STEPS: StepConfig[] = [
  {
    id: "intent",
    type: "single",
    i18nKey: "intent",
    options: [
      { value: "stop",           label: "Ho bisogno di fermarmi" },
      { value: "self_discovery", label: "Voglio capire qualcosa di me" },
      { value: "transition",     label: "Sto attraversando un cambiamento" },
      { value: "curiosity",      label: "Sono curioso/a di esplorare" },
      { value: "support_other",  label: "Cerco supporto per qualcuno" },
    ],
    heroSrc: "/onboarding/heroes/01-intent.jpg",
  },
  {
    id: "focus_areas",
    type: "multi",
    i18nKey: "focus_areas",
    minSelections: 1,
    options: [
      { value: "body",            label: "Il corpo",            description: "Energia, vitalit\u00e0, ritmi naturali" },
      { value: "mind",            label: "La mente",            description: "Pensieri ricorrenti, chiarezza, lucidit\u00e0" },
      { value: "energy",          label: "L'energia",           description: "Sensazione di blocco o di flusso" },
      { value: "relationships",   label: "Le relazioni",        description: "Famiglia, partner, amicizie" },
      { value: "life_direction",  label: "La direzione di vita", description: "Vocazione, scelte, prossimi passi" },
      { value: "daily_ritual",    label: "Il rituale quotidiano", description: "Sonno, alimentazione, cura di s\u00e9" },
      { value: "family_roots",    label: "Le radici familiari", description: "Storia, eredit\u00e0, dinamiche tramandate" },
      { value: "inner_listening", label: "L'ascolto interiore", description: "Intuito, segnali, presenza" },
    ],
    heroSrc: "/onboarding/heroes/02-focus.jpg",
  },
  {
    id: "familiar_practices",
    type: "multi",
    i18nKey: "familiar_practices",
    options: [
      { value: "ThetaHealing",            label: "ThetaHealing\u00ae" },
      { value: "Costellazioni Familiari", label: "Costellazioni Familiari" },
      { value: "Costellazioni Sistemiche", label: "Costellazioni Sistemiche" },
      { value: "Reiki",                   label: "Reiki" },
      { value: "Naturopatia",             label: "Naturopatia" },
      { value: "Astrologia",              label: "Astrologia" },
      { value: "Human Design",            label: "Human Design" },
      { value: "Numerologia",             label: "Numerologia" },
      { value: "Ayurveda",                label: "Ayurveda" },
      { value: "Sciamanesimo",            label: "Sciamanesimo" },
      { value: "none",                    label: "Non le conosco bene", description: "Va benissimo, ti guidiamo noi" },
    ],
    heroSrc: "/onboarding/heroes/03-practices.jpg",
  },
  {
    id: "approaches",
    type: "multi",
    i18nKey: "approaches",
    minSelections: 1,
    options: [
      { value: "energetic",       label: "Lavoro energetico",        description: "Riequilibrio sottile, channeling" },
      { value: "self_knowledge",  label: "Conoscenza di s\u00e9",     description: "Mappe interpretative, simboli, archetipi" },
      { value: "spiritual",       label: "Riconnessione spirituale", description: "Senso del sacro, presenza, ascolto" },
      { value: "symbolic",        label: "Lettura simbolica",        description: "Numeri, astri, lettere, sincronicit\u00e0" },
      { value: "body_care",       label: "Cura del corpo",            description: "Alimentazione, ritmi, fitoterapia" },
      { value: "open",            label: "Lasciamo decidere a te",    description: "Suggeriscimi tu cosa fa per me" },
    ],
    heroSrc: "/onboarding/heroes/04-approaches.jpg",
  },
  {
    id: "timing",
    type: "single",
    i18nKey: "timing",
    options: [
      { value: "asap",         label: "Appena possibile" },
      { value: "this_week",    label: "Questa settimana" },
      { value: "few_weeks",    label: "Tra qualche settimana" },
      { value: "exploring",    label: "Sto solo esplorando, senza fretta" },
    ],
    heroSrc: "/onboarding/heroes/05-timing.jpg",
  },
  // ─────────────────────────────────────────────────────────────
  // life_season — psychographic segmentation. Useful for matchmaking
  // (a "transition" person matches differently than someone in
  // "stability") and high value for anonymous cohort insights
  // (industry partners pay attention to life-stage cohorts).
  // ─────────────────────────────────────────────────────────────
  {
    id: "life_season",
    type: "single",
    i18nKey: "life_season",
    options: [
      { value: "transition",      label: "Sono in transizione",      description: "Sto attraversando un cambiamento importante" },
      { value: "stability",       label: "In una fase stabile",       description: "Voglio approfondire e integrare" },
      { value: "growth",          label: "In crescita attiva",        description: "Mi sto espandendo, esploro tanto" },
      { value: "realignment",     label: "In riallineamento",         description: "Sto ritrovando il mio centro" },
      { value: "disorientation",  label: "Un po' disorientato/a",     description: "Cerco una direzione, non so bene dove andare" },
      { value: "unsure",          label: "Non saprei dire",           description: "Va bene così, possiamo lasciarlo aperto" },
    ],
    heroSrc: "/onboarding/heroes/06-life-season.jpg",
  },
  // ─────────────────────────────────────────────────────────────
  // current_practices — what's already part of the user's routine.
  // Predictor of "wellness sophistication" tier. Different from
  // familiar_practices (which asks about HU's modalities specifically).
  // ─────────────────────────────────────────────────────────────
  {
    id: "current_practices",
    type: "multi",
    i18nKey: "current_practices",
    minSelections: 1,
    options: [
      { value: "yoga",                 label: "Yoga" },
      { value: "meditation",           label: "Meditazione" },
      { value: "journaling",           label: "Journaling / scrittura" },
      { value: "breathwork",           label: "Respirazione consapevole" },
      { value: "conscious_nutrition",  label: "Alimentazione consapevole" },
      { value: "movement",             label: "Movimento (danza, camminata, sport)" },
      { value: "nature_time",          label: "Tempo in natura" },
      { value: "digital_detox",        label: "Pause dal digitale" },
      { value: "none",                 label: "Nessuna ancora",        description: "Va benissimo, è il punto di partenza" },
    ],
    heroSrc: "/onboarding/heroes/07-current-practices.jpg",
  },
  // ─────────────────────────────────────────────────────────────
  // cosmic_marker — optional symbolic identity. Stored as
  // "zodiac:<sign>" so we can extend later (dosha, life-path number,
  // etc.) without changing the column.
  // ─────────────────────────────────────────────────────────────
  {
    id: "cosmic_marker",
    type: "single",
    i18nKey: "cosmic_marker",
    optional: true,
    options: [
      { value: "zodiac:aries",       label: "Ariete" },
      { value: "zodiac:taurus",      label: "Toro" },
      { value: "zodiac:gemini",      label: "Gemelli" },
      { value: "zodiac:cancer",      label: "Cancro" },
      { value: "zodiac:leo",         label: "Leone" },
      { value: "zodiac:virgo",       label: "Vergine" },
      { value: "zodiac:libra",       label: "Bilancia" },
      { value: "zodiac:scorpio",     label: "Scorpione" },
      { value: "zodiac:sagittarius", label: "Sagittario" },
      { value: "zodiac:capricorn",   label: "Capricorno" },
      { value: "zodiac:aquarius",    label: "Acquario" },
      { value: "zodiac:pisces",      label: "Pesci" },
      { value: "unknown",            label: "Non lo so / preferisco non dire" },
    ],
    heroSrc: "/onboarding/heroes/08-cosmic-marker.jpg",
  },
  {
    id: "notes",
    type: "text",
    i18nKey: "notes",
    optional: true,
    heroSrc: "/onboarding/heroes/09-notes.jpg",
  },
  {
    id: "summary",
    type: "single", // not really used — the summary step is its own UI
    i18nKey: "summary",
    heroSrc: "/onboarding/heroes/10-summary.jpg",
  },
];

export type AnswerSet = {
  intent?: string;
  focus_areas?: string[];
  familiar_practices?: string[];
  approaches?: string[];
  timing?: string;
  notes?: string;
  // Added 2026-05-16 — psychographic + lifestyle + symbolic markers.
  // All three feed both matchmaking and (with research_consent) anonymous
  // cohort insights for industry partners.
  life_season?: string;
  current_practices?: string[];
  cosmic_marker?: string;
  // GDPR-explicit: opt-in for anonymous use of the user's onboarding
  // answers in aggregate research / industry reports. Default is
  // false (silence is not consent). When true, we ALSO stamp the
  // research_consent_at timestamp server-side.
  research_consent?: boolean;
};

/**
 * Practice matchmaking. Maps focus_areas + approaches to a relevance score
 * for each canonical practice. Returns the top N practice category_keys.
 */
export function recommendPractices(answers: AnswerSet, n = 3): string[] {
  const scores: Record<string, number> = {};
  const bump = (key: string, by: number) => {
    scores[key] = (scores[key] ?? 0) + by;
  };

  // Strong signal: explicit familiarity gets the practice surfaced
  for (const p of answers.familiar_practices ?? []) {
    if (p === "none") continue;
    bump(p, 4);
  }

  // Focus areas → practices that address them. Sciamanesimo is added
  // to `energy`, `family_roots` (lavoro su antenati / parti di sé
  // smarrite) and `inner_listening` — those are the areas where the
  // shamanic journey is most directly aligned with what the user is
  // signalling.
  const focusMap: Record<string, string[]> = {
    body:           ["Naturopatia", "Ayurveda", "Reiki"],
    mind:           ["ThetaHealing", "Numerologia"],
    energy:         ["ThetaHealing", "Reiki", "Sciamanesimo"],
    relationships:  ["Costellazioni Familiari", "Costellazioni Sistemiche"],
    life_direction: ["Astrologia", "Human Design", "Numerologia"],
    daily_ritual:   ["Ayurveda", "Naturopatia"],
    family_roots:   ["Costellazioni Familiari", "Sciamanesimo"],
    inner_listening: ["ThetaHealing", "Astrologia", "Human Design", "Sciamanesimo"],
  };
  for (const a of answers.focus_areas ?? []) {
    for (const p of focusMap[a] ?? []) bump(p, 2);
  }

  // Approaches → practices that match. Sciamanesimo strongly aligns
  // with `energetic` and `spiritual`; less so with `symbolic` (it does
  // use symbols but they're experienced, not interpreted) — left out
  // there to keep that bucket focused on Astrologia/Numerologia/HD.
  const approachMap: Record<string, string[]> = {
    energetic:      ["ThetaHealing", "Reiki", "Sciamanesimo"],
    self_knowledge: ["Astrologia", "Human Design", "Numerologia"],
    spiritual:      ["ThetaHealing", "Reiki", "Sciamanesimo"],
    symbolic:       ["Astrologia", "Numerologia", "Human Design"],
    body_care:      ["Naturopatia", "Ayurveda"],
    // 'open' adds nothing — let other signals decide
  };
  for (const a of answers.approaches ?? []) {
    for (const p of approachMap[a] ?? []) bump(p, 2);
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key);
}
