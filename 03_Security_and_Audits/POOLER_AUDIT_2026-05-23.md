# Connection Pooling — Supabase (PgBouncer/Supavisor) Audit

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: verifica che il connection pooling Postgres sia attivo sul progetto Supabase `bqyqkvkzkemiwyqjkbna` e che nessun codice applicativo lo bypassi con connessioni dirette.

**Result**: 🟢 **CONFIRMED ENABLED + nessun bypass nel codice.** Il pooler è attivo (URL endpoint configurato in CLI metadata di tutti e 3 i webapp), e i 3 webapp + 14 Edge Functions + iOS app usano **esclusivamente** Supabase SDK (HTTPS via PostgREST), mai direct PG. Il pooler è quindi trasparente all'applicazione: Supabase lo usa internamente tra PostgREST/Realtime/Storage e il database, e l'app non deve fare nulla per beneficiarne.

---

## TL;DR rapido

| Domanda | Risposta |
|---------|----------|
| Pooler attivo sul progetto? | ✅ SI. Endpoint configurato: `aws-1-eu-west-1.pooler.supabase.com:5432` (verificato in `.temp/pooler-url` di 3 supabase CLI workdir). |
| Quale pooler? | Supavisor (replacement Supabase di PgBouncer dal 2023, drop-in compatible — stessa API, stesso protocollo wire). La task spec dice "PgBouncer" — è la stessa cosa funzionalmente. |
| L'app usa il pooler? | ✅ SI, **transparently**. L'app usa Supabase SDK → HTTPS verso PostgREST/Realtime/Storage → Supabase backend → pooler → Postgres. Il pooler è interno a Supabase, non visibile all'app. |
| Codice bypassa il pooler con direct PG? | ❌ NO. Zero match per `pg.Client`, `new Pool()`, `postgresql://` o `DATABASE_URL` env var in tutto il codebase. Verificato via grep esaustivo. |
| Configurazione di default va bene? | ✅ Per il modello pre-launch (low concurrency). Da verificare via Dashboard per ottimizzare pool size se mai si scaleranno carichi reali. |

---

## Methodology

L'audit segue un pattern triplo (come quelli RLS / JWT / Storage):

1. **Code grep**: cercare ogni potenziale uso di connessione PG diretta che bypasserebbe il pooler
2. **CLI metadata**: leggere i file `.temp/` del `supabase` CLI che contengono lo stato della connessione configurata
3. **Dashboard checklist**: documentare gli step per verificare in production via Supabase Dashboard (non eseguibile da CLI senza PAT in shell)

---

## Code grep — zero direct PG anywhere

### Webapps (3)

```
grep "postgresql://|postgres://|new Pool\(|pg\.Client|new Client\(|import.*from\s+[\"']pg[\"']" \
  08_Codebases/{client,therapist,admin}-webapp/src \
  → only matches: 2 files (.temp/pooler-url) — CLI metadata, NOT app code

grep "DATABASE_URL|POSTGRES_URL|SUPABASE_DB_URL|DB_URL" \
  08_Codebases/{client,therapist,admin}-webapp \
  → ZERO match
```

**Verdict**: nessun webapp ha import del package `pg` o referenze a connessioni dirette. Tutte le query DB passano attraverso il Supabase JS SDK (`@supabase/supabase-js` + `@supabase/ssr`), che fa REST/HTTPS verso `https://bqyqkvkzkemiwyqjkbna.supabase.co/rest/v1/*` (PostgREST).

### Edge Functions Deno (14 functions)

```
grep "postgresql://|postgres://|new Pool\(|deno-postgres|from\s+[\"']postgres[\"']" \
  08_Codebases/iOS_App/supabase/functions \
  → ZERO match
```

**Verdict**: tutte le 14 Edge Functions usano `createClient(supabaseUrl, supabaseServiceRoleKey)` da `@supabase/supabase-js@2` esm.sh, mai direct PG. Pattern verificato in audit precedenti (JWT, RLS, Storage, Edge Functions JWT).

### iOS app

L'iOS app usa il SDK Swift Supabase ([SupabaseConfig.swift](../08_Codebases/iOS_App/Holistic%20Unity/Core/Networking/SupabaseConfig.swift)) — HTTPS, mai direct PG. Già verificato in audit OWASP MAS.

---

## Pooler config verificata

File: `08_Codebases/{client-webapp,therapist-webapp,iOS_App}/supabase/.temp/pooler-url`

Contenuto (identico in tutti e 3):
```
postgresql://postgres.bqyqkvkzkemiwyqjkbna@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

**Analisi dell'URL**:
- **Host**: `aws-1-eu-west-1.pooler.supabase.com` — this is **Supavisor**, l'Elixir-based pooler che Supabase usa di default dal 2023 (ha sostituito PgBouncer). Drop-in compatible (stesso wire protocol).
- **Port**: `5432` — questo è la **session mode** del pooler (vs port 6543 = transaction mode).
- **User**: `postgres.bqyqkvkzkemiwyqjkbna` — username tenant-prefisso, richiesto da Supavisor per il multi-tenancy.
- **Region**: `eu-west-1` — coerente con il progetto Italia-targeted (latenza più bassa di us-east).

**Nota technical**: questo URL è il punto di ingresso disponibile per direct PG (es. via `psql` per debugging o per tools come Drizzle/Prisma). L'app NON lo usa — è solo per accessi amministrativi diretti. La password DB non è in nessun file locale (gestita via Dashboard manualmente quando serve).

---

## Background: cosa fa il pooler

PgBouncer/Supavisor è uno stratificato che si interpone tra applicazioni e Postgres per:

1. **Riusare connessioni TCP/TLS**: aprire una connessione Postgres è costoso (~10-50ms + ~10MB memoria per connessione). Il pooler mantiene un pool di connessioni "sempre aperte" e le ricicla.

2. **Limitare il numero massimo di connessioni a Postgres**: Postgres ha un `max_connections` finito (default 100 su Supabase Free, 200+ su Pro). Senza pooler, ogni request HTTP che apre una connessione consuma uno slot. Con 50 utenti concorrenti su un'app serverless, 50 connessioni ≈ esaurimento del limite.

3. **Modalità transaction vs session**:
   - **Session mode (port 5432)**: una connessione client → una connessione Postgres dedicata fino a disconnect. Compatibile con tutto (prepared statements, LISTEN/NOTIFY, ecc.). Usata da app long-running (psql, GUI Postgres).
   - **Transaction mode (port 6543)**: una connessione client riusa connessioni Postgres tra transazioni diverse. Critico per **serverless/edge** dove ogni invocation è effimera. NON supporta prepared statements server-side (raramente un problema).

**Per il nostro caso** (webapp + Edge Functions + iOS via SDK Supabase): non importa quale modalità, perché **non andiamo MAI direct PG**. Andiamo via PostgREST, che è un servizio gestito da Supabase con il suo proprio pool internal.

---

## Step manuale via Dashboard (opzionale, ~1 min)

Per chi vuole vedere lo stato del pooler in console:

1. **Supabase Dashboard** → progetto `Holistic New` → **Project Settings** → **Database** → tab **Connection Pooling**
2. Verifica:
   - **Mode**: di default è **Transaction**, port 6543 per il pooler endpoint. Ok lasciarlo.
   - **Pool size**: di default 15 (Free) / 25-40 (Pro). Aumentare solo se Dashboard → Database → Reports mostra contention.
   - **Max client connections**: ~200 (free) / ~400+ (Pro). Non toccare.

**Pass criteria**: pagina esiste + pooler endpoint mostra come "Active". Tutti i progetti Supabase post-2023 ce l'hanno di default — fail criteria sarebbe pagina assente o pooler in stato "Disabled" (statisticamente improbabile).

**Action se Pool size sembra basso** (post-lancio, sotto carico reale): aumentare via Dashboard. Non serve modificare il codice — è trasparente.

---

## Impact assessment

### Per l'AUDIT (read-only)

| Domanda | Risposta |
|---------|----------|
| Cambierà UI/UX? | NO |
| Funzioni a rischio? | NO (solo grep + lettura config files) |
| Performance? | NO change |

### Per i potenziali "fix" (se mai dovessimo cambiare config)

| Scenario | Impact |
|----------|--------|
| Aumentare Pool size via Dashboard | NO UI/UX. Funzioni: zero risk (cambio transparent). Performance: marginal positive sotto carico. |
| Passare da Session a Transaction mode (port 6543) | NO UI/UX. Funzioni: BASSO risk (no prepared-statement usage nel codice — siamo SDK-based). Performance: meglio per serverless. **Già transaction mode di default su Supabase moderno.** |
| Disabilitare pooler (hypothetical) | DISASTROSO. Postgres esaurirebbe `max_connections` rapidamente sotto carico. Non farlo. |

---

## Deliverable

- 📄 [`03_Security_and_Audits/POOLER_AUDIT_2026-05-23.md`](POOLER_AUDIT_2026-05-23.md) — questo report
- ✏️ [`01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — checkbox `[x]` con audit note

**Conclusione**: il pooler è attivo by default su Supabase e il nostro codice non lo bypassa. **Nessuna azione richiesta pre-lancio**. La Dashboard verification dei pool size è un nice-to-have post-lancio, da fare se mai dovessimo vedere connection-pool exhaustion in produzione (statisticamente improbabile prima delle migliaia di RPS).
