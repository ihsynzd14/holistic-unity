# Bundle Analyzer — Top 3 heaviest per webapp + alternative evaluation

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: client-webapp, therapist-webapp, admin-dashboard. Tool: **Next.js 16.2.3 Bundle Analyzer (Turbopack-native, experimental)** via `npx next experimental-analyze --output`. Output in each `.next/diagnostics/analyze/`.

**Result**: 🟢 **Nessun "elefante nella stanza"**. Le 3 dipendenze più pesanti su ogni webapp sono **funzionalmente necessarie** (chat + video + framework) e tutte tree-shake correttamente con named imports. Switching a librerie alternative richiederebbe 2-6 settimane di rewrite per saving marginale. Identificate 4 piccole opportunità di hardening per post-launch. Output del Webpack analyzer (`@next/bundle-analyzer`) configurato e committato per future runs ad-hoc via `ANALYZE=true npm run build` (richiede flag `--webpack` con Next 16).

---

## Misura: dimensione totale chunk client

| Webapp | Total `.next/static/chunks/` | Δ vs admin |
|--------|-----------------------------:|-----------:|
| **client-webapp** | 3.84 MB | +35% |
| **therapist-webapp** | 3.79 MB | +33% |
| **admin-dashboard** | 2.85 MB | baseline (no LiveKit) |

L'admin-dashboard è **1 MB più piccolo** dei due principali — coerente con il fatto che non monta LiveKit (no video sessions lato admin).

> **Nota importante**: questi sono **chunk PRODOTTI dal build**, non payload che ogni utente scarica. Next.js App Router fa code-splitting per route → la maggior parte degli utenti scarica solo gli ~200-450 KB iniziali (vendor + page corrente). Le chat (Stream) e video (LiveKit) vengono caricati solo entrando in `/dashboard/messages` o `/call/[bookingId]`.

---

## Top 3 chunk per webapp (identificati via grep su simboli dei pacchetti)

### client-webapp

| # | Chunk | Size | Contenuto identificato | Categoria |
|--:|------|-----:|----------------------|-----------|
| 1 | `00_cjn4kk9jgn.js` | **1.41 MB** | `stream-chat-react` + `stream-chat` (4+2 string matches) | **Chat lib (UI + protocol)** |
| 2 | `0eds~h2ma7ayq.js` | **548 KB** | `livekit` + `RTCPeer` + `MediaStream` (168+155+36 matches) | **WebRTC video lib** |
| 3 | `0dk0.i94nu~70.js` | **223 KB** | `supabase` (88 matches) | **Supabase JS SDK** |
| 4 | `0h49f8pola-dz.js` | 222 KB | `react` (57 matches) + `react-dom` + Next runtime | Framework runtime |
| 5 | `0fi6hnp3c5b6z.js` | 134 KB | (no obvious markers) | Probably Sentry SDK |

### therapist-webapp

Pattern identico a client-webapp (stesso stack):
| # | Chunk | Size | Contenuto inferito |
|--:|------|-----:|--------------------|
| 1 | `0c46x71204a-m.js` | **1.41 MB** | Stream Chat (stessa shape del client-webapp) |
| 2 | `0qj.z-ilwsyas.js` | **548 KB** | LiveKit |
| 3 | `0dk0.i94nu~70.js` | **223 KB** | Supabase |

### admin-dashboard

| # | Chunk | Size | Contenuto inferito |
|--:|------|-----:|--------------------|
| 1 | `07qdg_i7b9p37.js` | **1.41 MB** | Stream Chat (admin usa il chat con clienti per support) |
| 2 | `0i.c-_l09dfp3.js` | **222 KB** | Supabase |
| 3 | `0524vgq4dk8uu.js` | **200 KB** | (no marker — probably Sentry + admin features) |

**Nessun LiveKit chunk in admin-dashboard** — corretto, admin non fa video session.

---

## Dependency source sizes (su disco, pre-bundling) — client-webapp

| Package | Source MB | Note |
|---------|----------:|------|
| `next` | 165 MB | Framework runtime; solo una porzione finisce nel client bundle |
| `lucide-react` | 37 MB | ⚠️ Icon library con 1000+ icone in file separati. **Auto-optimized da Next 16** (vedi sotto) — solo le icone effettivamente importate finiscono nel client. |
| `date-fns` | 32 MB | ⚠️ Date library con centinaia di functions + locales. **Auto-optimized da Next 16** — solo le functions usate finiscono nel client. |
| `stream-chat-react` | 21 MB | UI components per chat |
| `stripe` | 17 MB | **SERVER SDK** — verificato: importato solo in 5 route handler (`src/app/api/**/route.ts`), MAI nei `"use client"`. Next.js code splitting lo esclude correttamente dal browser bundle. ✅ |
| `livekit-client` | 9.1 MB | WebRTC core |
| `stream-chat` | 7.7 MB | Chat protocol core (transitive di `stream-chat-react`) |
| `react-dom` | 7.1 MB | Framework |
| `@livekit/components-react` | 4.0 MB | LiveKit UI components |
| `@sentry/nextjs` | 3.3 MB | Observability |
| `@supabase/supabase-js` | 524 KB | DB client |

---

## Alternative valutazione (la richiesta esplicita del task)

| Pacchetto attuale | Bundle weight | Alternativa più leggera? | Verdict |
|-------------------|--------------:|--------------------------|---------|
| `stream-chat-react` + `stream-chat` | **1.4 MB** | (a) Hand-roll su Supabase Realtime + custom UI, (b) `@chatscope/chat-ui-kit-react` (~300 KB ma no backend), (c) TalkJS (paid SaaS, ~400 KB) | **❌ KEEP**. Stream Chat ci dà: typing indicators, reactions, attachments, read receipts, threading, search, presence, push integration, moderation, retention. Rewrite con Supabase Realtime = 4-8 settimane di lavoro per replicare le primitive base. Per il lancio: il chunk si carica SOLO entrando in `/dashboard/messages` (Next App Router code-split per route). |
| `livekit-client` + `@livekit/components-react` | **548 KB** | (a) Daily.co (~500 KB, simile), (b) Twilio Video (~600 KB, più pesante), (c) Pure WebRTC + Socket.IO (impossibile per MVP, 8+ settimane) | **❌ KEEP**. LiveKit è competitive su bundle weight. Switching SDK è 2-4 settimane di lavoro per saving marginale (forse 50-100 KB). Si carica SOLO entrando in `/call/[bookingId]`. |
| `@supabase/supabase-js` + `@supabase/ssr` | **~230 KB** | (a) `postgrest-js` direct (no auth flow), (b) Firebase SDK (~700 KB, peggio), (c) custom REST fetch | **❌ KEEP**. Il SDK è il sistema di auth + RLS + realtime + storage. Sostituirlo = riscrivere TUTTO il backend access pattern. Pay-it-once cost, value-for-money eccellente. |
| `@sentry/nextjs` | **~135 KB** | (a) Datadog Browser RUM (~200 KB), (b) Bugsnag (~100 KB ma meno feature), (c) hand-roll error reporter (no UX) | **❌ KEEP**. Sentry è già configurato + il deprecation warning notato in build (`disableLogger` → `webpack.treeshake.removeDebugLogging`) è un follow-up minore. |
| `lucide-react` | ~5 KB ship (~37 MB source) | Auto-optimized by Next 16 — irrilevante | **✅ ALREADY OPTIMAL** |
| `date-fns` | ~5-20 KB ship (~32 MB source) | Auto-optimized by Next 16 | **✅ ALREADY OPTIMAL** |
| `stripe` (server SDK) | **0 KB client ship** | Solo route handlers — verificato grep | **✅ ALREADY OPTIMAL** |

**Conclusione**: Le 3 dependency più pesanti **sono dovute alla feature parity richiesta dal prodotto** (chat real-time + video sessions + auth/db). Nessuna alternativa "drop-in" più leggera è viable senza riscrivere intere feature.

---

## Verifica importanti (positive)

1. ✅ **Tutti gli import di stream-chat-react e @livekit/components-react sono named** (`import { Chat, Channel, MessageList, ... }`) — il tree-shaking funziona. Mai `import * as X from "..."`.
2. ✅ **`stripe` server SDK MAI bundled to client**: solo 7 route handlers (5 client-webapp + 2 therapist-webapp) → `route.ts` runtime server-only. Verifica grep: zero match nei file `"use client"`.
3. ✅ **`lucide-react` e `date-fns` auto-optimized**: presenti nella default list di Next 16 `optimizePackageImports` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/optimizePackageImports.md`).
4. ✅ **Route-level code splitting attivo** by default in Next App Router. Stream Chat + LiveKit non shipped a chi non usa quelle pagine.

---

## 4 piccole opportunità (post-launch hardening, NON blocking)

### 1. Sentry `disableLogger` deprecato

Il build mostra:
```
[@sentry/nextjs] DEPRECATION WARNING: disableLogger is deprecated and will be removed in a future version. Use webpack.treeshake.removeDebugLogging instead.
```

Su tutti e 3 i webapp. Effort: 5 min (find/replace nei 3 `next.config.ts`). Effetto: -0 KB ma silenzia un warning + future-proofs verso Sentry SDK v11+.

### 2. Aggiungere `stream-chat-react` a `optimizePackageImports`

Esperimento: aggiungere `stream-chat-react` (e forse `@livekit/components-react`) al config:
```ts
experimental: {
  optimizePackageImports: ['stream-chat-react', '@livekit/components-react'],
}
```
Effetto sconosciuto a priori — bisogna fare il diff prima/dopo con `npx next experimental-analyze --output`. Potrebbe non aiutare (i bundler di Stream Chat sono già aggressive in tree-shaking) o salvare 50-100 KB. **Worth a TestFlight cycle**.

### 3. Dynamic import + suspense per `/dashboard/messages` e `/call/[bookingId]`

Per UX su connessioni lente: invece di lasciare il browser parse-pareggiando il chunk da 1.4 MB di Stream Chat, mostrare uno skeleton via `dynamic({ssr:false, loading: () => <Skeleton />})`. **Era già tracciato come follow-up nel task `dynamic({ssr:false})` originale**.

### 4. `bundle-analyzer` configurato per future runs

Il package `@next/bundle-analyzer` è installato come devDep su tutti e 3 webapp + wrap aggiunto a `next.config.ts`. Per usarlo:
```bash
# Next 16 default Turbopack analyzer (preferito):
npx next experimental-analyze --output
# Output in .next/diagnostics/analyze/, server interattivo via:
npx next experimental-analyze

# Webpack analyzer (legacy, richiede --webpack):
ANALYZE=true npm run build -- --webpack
# Output in .next/analyze/*.html
```

---

## Impact assessment

| Domanda | AUDIT | FIX (4 opportunità sopra) |
|---------|-------|---------------------------|
| Cambierà UI/UX? | NO (read-only build) | NO. Tutti pure-DX fix. |
| Funzioni a rischio? | NO | BASSO. Sentry deprecation = trivial. `optimizePackageImports` = potenziale tree-shake aggressivo che potrebbe rompere import non-standard (rare). Dynamic imports = già supportati da Next, well-tested. |
| Performance? | NO change | TINY positive (50-100 KB potential saving da step 2; skeleton UX da step 3). |

---

## Deliverable

- 📄 [`03_Security_and_Audits/BUNDLE_AUDIT_2026-05-23.md`](BUNDLE_AUDIT_2026-05-23.md) — questo report
- 🔧 `@next/bundle-analyzer` installato come devDep + wrap aggiunto a `next.config.ts` in tutti e 3 webapp
- 📊 Output analyzer in `.next/diagnostics/analyze/` di ogni webapp (gitignored automaticamente)
- ✏️ [`01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — checkbox `[x]` con audit note
- 🛡️ Le 4 opportunità minori aggiunte alla sezione **Post-launch hardening**

**Conclusione**: i 3 webapp sono **bundle-size-healthy** per il modello di prodotto. Non ci sono "low-hanging fruits" da raccogliere — le ottimizzazioni rimaste sono incrementali (50-100 KB saving cumulativo se faremo tutti e 3 i micro-fix), non gate per il lancio.
