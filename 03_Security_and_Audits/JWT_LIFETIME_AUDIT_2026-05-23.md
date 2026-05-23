# JWT Lifetime + Refresh Token Audit

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: Supabase Auth (GoTrue) settings su progetto `bqyqkvkzkemiwyqjkbna` + code review di iOS app + 3 webapp client-side.

**Result**: 🟢 **APP-SIDE PASS, Dashboard-side da verificare manualmente** (3 click). Il codice client-side è già configurato correttamente per gestire JWT con scadenza breve e refresh automatico. Le 2 impostazioni Dashboard (`JWT expiry < 1h`, `refresh token rotation enabled`) **non sono auditabili da CLI** (Supabase CLI v2.47.2 non espone l'auth config; Management API richiede un PAT separato; il `config.toml` locale non ha sezione `[auth]`). 3 step manuali documentati sotto.

---

## App-side review (PASS)

### iOS app

[`iOS_App/Holistic Unity/Core/Networking/SupabaseConfig.swift:57-67`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Networking/SupabaseConfig.swift):
```swift
static let client = SupabaseClient(
    supabaseURL: projectURL,
    supabaseKey: anonKey,
    options: .init(
        auth: .init(
            autoRefreshToken: true,                         // ✓ auto-refresh
            emitLocalSessionAsInitialSession: true
        ),
        global: .init(session: urlSession)
    )
)
```

`autoRefreshToken: true` significa che la SDK iOS schedula un refresh ~60s prima della scadenza dell'access token. Funziona in background mentre l'app è aperta.

**Manual refresh calls** trovati in path critici dove l'SDK potrebbe non aver ancora rinfrescato (es. dopo background → foreground):

| File | Riga | Quando |
|------|------|--------|
| [`SupabasePaymentRepository.swift:335`](../08_Codebases/iOS_App/Holistic%20Unity/Data/Repositories/SupabasePaymentRepository.swift) | 335 | Prima di una chiamata Stripe critica |
| [`VideoCallService.swift:347`](../08_Codebases/iOS_App/Holistic%20Unity/Data/Services/VideoCallService.swift) | 347 | Prima di richiedere LiveKit token |
| [`SupabaseAuthRepository.swift:224`](../08_Codebases/iOS_App/Holistic%20Unity/Data/Repositories/SupabaseAuthRepository.swift) | 224 | Reattivazione app |
| [`StreamChatService.swift:161`](../08_Codebases/iOS_App/Holistic%20Unity/Data/Services/StreamChatService.swift) | 161 | Prima di Stream Chat connect |

Pattern difensivo: `_ = try? await client.auth.refreshSession()` — non-throwing, swallow degli errori (assume che se refresh fallisce, il prossimo network call gestirà 401).

### Webapp client (3 webapp, pattern identico)

[`client-webapp/src/lib/supabase/client.ts`](../08_Codebases/client-webapp/src/lib/supabase/client.ts):
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

`createBrowserClient` da `@supabase/ssr` (modern Next.js 16 pattern) ha `autoRefreshToken: true` come default. Nessun override locale.

### Webapp middleware (refresh + session validation per request)

[`client-webapp/src/lib/supabase/middleware.ts:53`](../08_Codebases/client-webapp/src/lib/supabase/middleware.ts):
```ts
const { data: { user } } = await supabase.auth.getUser();
```

`getUser()` VALIDA il JWT contro l'auth server (NON solo decodifica). Se il token è scaduto, la libreria SSR fa refresh automatico via cookie e ri-emette `setAll` per aggiornare il cookie del browser. Pattern corretto per Next.js App Router con session in cookie.

### Webapp admin client (service-role)

[`client-webapp/src/lib/supabase/admin.ts:15-21`](../08_Codebases/client-webapp/src/lib/supabase/admin.ts):
```ts
return createClient(url, key, {
    auth: {
        autoRefreshToken: false,   // ✓ corretto: service-role token non scade
        persistSession: false,     // ✓ corretto: server-side, no cookie persistence
    },
});
```

Idem `therapist-webapp/src/lib/supabase/admin.ts:16` e `admin-dashboard/src/lib/supabase/admin.ts:19-20`. Tre webapp coerenti. Pattern corretto: il service-role JWT è long-lived (issued at project creation), non ha bisogno di refresh.

**Esclusione**: `therapist-webapp/src/lib/calendar/tokens.ts:207-236` e `admin-dashboard/src/lib/integrations/fattureincloud/client.ts:9-43` gestiscono OAuth token di GOOGLE / Microsoft / FattureInCloud (NON Supabase JWT). Hanno il proprio `expires_at` + refresh logic per via di refresh token OAuth — non confondere con Supabase JWT.

---

## Public auth settings endpoint (live, anon)

`curl https://bqyqkvkzkemiwyqjkbna.supabase.co/auth/v1/settings -H "apikey: <ANON>"` ritorna:

```json
{
  "external": { "apple": true, "google": true, "email": true, ... },
  "disable_signup": false,
  "mailer_autoconfirm": false,    // ✓ email verification REQUIRED
  "phone_autoconfirm": false,
  "anonymous_users": false,       // ✓ no anonymous sessions
  "saml_enabled": false,
  "passkeys_enabled": false
}
```

GoTrue version: `v2.189.0` (recente).

**Findings collaterali**:
- ✅ Email verification ON (`mailer_autoconfirm: false`) — bene per evitare account fake
- ✅ Anonymous sessions disabled — non si possono creare session senza credentials
- ✅ Phone auth NON abilitato (intentional — only email + OAuth)

L'endpoint NON espone `jwt_exp` né `refresh_token_rotation_enabled` (Dashboard-only by design).

---

## Step manuali da fare via Dashboard (5 minuti)

**Path**: Supabase Dashboard → progetto `Holistic New` (`bqyqkvkzkemiwyqjkbna`) → **Authentication** → **Sign In / Up** (o **Providers** in versioni recenti) e poi **JWT Settings** / **Session Settings**.

### Step 1 — JWT expiry < 1h

Cerca il setting **"JWT expiry limit"** o **"JWT expiry (seconds)"**.

- **Pass criteria**: valore ≤ 3600 (1 ora). **Default Supabase**: 3600s (esattamente 1 ora).
- **Action se > 3600**: scendi a 3600. Riduce la finestra in cui un JWT rubato è utilizzabile.
- **Action se ≤ 3600**: ✅ nessuna azione.

### Step 2 — Refresh token rotation enabled

Cerca **"Detect and revoke potentially compromised refresh tokens"** o simile (in Auth → Sessions o Auth → Settings).

- **Pass criteria**: ENABLED (toggle ON). **Default Supabase (progetti nuovi)**: enabled.
- **Action se OFF**: turn ON. Quando rotation è abilitata, ogni refresh emette un NUOVO refresh token e invalida il precedente. Un attacker che ruba un vecchio refresh token non può usarlo se la vittima ha già fatto un nuovo refresh.

### Step 3 — Refresh token reuse interval

Setting **"Refresh token reuse interval"** (se presente).

- **Raccomandazione**: ~10s (default Supabase) — protegge contro race condition quando 2 tab/device fanno refresh contemporaneamente.
- **Action**: lasciare default a meno che non ci siano feedback specifici.

### Step 4 — Inactivity timeout (bonus, non in spec del task)

Setting **"Inactivity timeout"** o **"Session timeout"**.

- **Default Supabase**: 0 = nessun timeout (session vive finché refresh token è valido)
- **Raccomandazione per app consumer come Holistic**: 0 va bene — gli utenti non vogliono essere kickati dopo X giorni se l'app è ancora installata. Per app B2B/banking si setta tipicamente 7-30 giorni.
- **Action**: nessuna a meno che non emerga policy specifica.

---

## Verifica empirica (opzionale, ~3 min)

Se vuoi confermare la JWT expiry SENZA accedere al Dashboard:

1. Apri il client-webapp in browser, login come utente di test.
2. DevTools → Application → Storage → Cookies → cerca cookie `sb-<ref>-auth-token` (il payload).
3. Decodifica il JWT su https://jwt.io (paste la parte centrale, tra i due punti).
4. Guarda il claim `exp` — è un Unix timestamp. Confrontalo con `iat` (issued at):
   - `(exp - iat) ≤ 3600` → JWT expiry è ≤ 1h ✓
   - `(exp - iat) > 3600` → JWT expiry è troppo lungo, fix via Dashboard

**Alternativa via curl**: difficile farlo senza JS perché Supabase Auth usa PKCE flow + cookie. Il path browser è il più rapido.

---

## Impact assessment (per i potenziali "fix")

Se la Dashboard rivelasse settings NON conformi (worst case: JWT expiry a 24h, rotation off):

| Domanda | Risposta |
|---------|----------|
| Cambierà UI/UX? | **Marginale.** Riducendo JWT expiry a 1h, gli utenti vedranno un refresh automatico più frequente (invisibile se autoRefreshToken funziona). In edge case di rete cattiva, potrebbero essere bouncati a login più spesso → ma il middleware webapp + iOS SDK gestiscono il refresh in modo trasparente. |
| Funzioni a rischio? | **NESSUNA** — l'app è già pronta per JWT short-lived. `autoRefreshToken: true` è acceso ovunque, middleware webapp valida ogni request, iOS fa refresh manuale prima delle chiamate critiche. Abbiamo letteralmente 4 punti di refresh esplicito in iOS che mostrano che il team ha già pensato a questo. Refresh token rotation è zero-impact per l'app (la SDK gestisce internamente). |
| Performance? | **Negativo trascurabile.** Refresh più frequente = +1 round-trip a `/auth/v1/token?grant_type=refresh_token` ogni 1h vs ogni 24h (se prima era 24h). Costo: ~50ms una volta l'ora. Vantaggio sicurezza: finestra di abuse 24× più stretta. |

---

## Deliverable

- 📄 [`03_Security_and_Audits/JWT_LIFETIME_AUDIT_2026-05-23.md`](JWT_LIFETIME_AUDIT_2026-05-23.md) — questo report
- ✏️ [`01_START_HERE/01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — checkbox `[-]` (parziale: app-side PASS, Dashboard verification pending — è 3 click di mouse)

**Per chiudere il task come `[x]`**: esegui Step 1 + Step 2 sopra (verifica Dashboard) e riportami i 2 valori. Se entrambi sono conformi → checkbox diventa `[x]` con nota "Dashboard verified, both settings compliant". Se uno o entrambi sono off → 1-click fix da Dashboard, poi `[x]`.
