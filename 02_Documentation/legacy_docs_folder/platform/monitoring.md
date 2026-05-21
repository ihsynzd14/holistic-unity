# Monitoring & Security Alerting

**Last verified:** 2026-04-17 by Marcello
**Status:** ✅ Phase 4.6 — alert rules drafted, awaiting user-side configuration in Sentry + Supabase dashboards.
**Owner:** Marcello

> **Purpose:** every security event in the app should either be ignored (known-safe) or alert someone within minutes. This doc is the definitive list of what to alert on, how to configure it, and who gets paged.

## 1. Sentry — error + security event alerts

Sentry already receives crashes and unhandled errors. Beyond that, our codebase emits security-specific events with structured tags that a scoped alert rule can pick up:

| Tag | Emitted by | What it means |
|-----|-----------|---------------|
| `security.event_type=deep_link` | `DeepLinkRouter.reject()` | iOS client received an inbound URL the allowlist rejected. Investigate spikes — could be a phishing campaign. |
| `security.event_type=jailbreak` | `JailbreakDetector.reportToSentry()` | iOS device flagged one or more of: jailbroken, debugger attached, reverse-engineering tools, runtime hooks. |
| `security.event_type=rate_limit` | Edge functions when a call returns 429 | Distributed rate limiter tripped. A handful is expected from real traffic; a spike from one IP/user is an abuse signal. |
| `security.event_type=admin_access_denied` | `admin-dashboard/src/lib/auth/requireAdmin.ts` | Someone signed in but was rejected by either the `ADMIN_EMAILS` env check or the `public.is_admin()` RPC. |
| `security.event_type=biometric_failed` | `BiometricLock` after repeated failures | Device-owner biometric prompt failed a threshold number of times. |

### Alert rules to configure

Open **Sentry → Alerts → Create Alert Rule → Issues**. For each rule below:
- **Issue category:** All
- **When any of these filters match:** as specified
- **Perform these actions:** "Send a notification to members" → your email + (optionally) a Slack/Discord webhook
- **Action interval:** `30 minutes` — suppress alert storms

#### Rule 1 — Deep-link rejection spike
- Filter: `tags[security.event_type] equals deep_link`
- Trigger: `event count > 10 in 5 minutes`
- Priority: Medium — high if sustained for an hour.

#### Rule 2 — Jailbreak / tampering detection
- Filter: `tags[security.event_type] equals jailbreak`
- Trigger: `event count > 0 (any)` → firstseen alert, so the first flagged device pages someone.
- After a few weeks of baseline data, raise to `> 20 in 1 hour` to catch coordinated abuse vs. individual curious users.

#### Rule 3 — Rate-limit cascade
- Filter: `tags[security.event_type] equals rate_limit AND tags[endpoint] equals livekit-token`
- Trigger: `event count > 50 in 10 minutes`
- Meaning: the rate limiter is firing on LiveKit token requests more than twice per second for ten minutes — either real load we need to scale for, or abuse.

#### Rule 4 — Admin access denials
- Filter: `tags[security.event_type] equals admin_access_denied`
- Trigger: `event count > 3 in 1 hour`
- **This is the highest priority rule.** If someone is persistently trying to hit admin endpoints without passing both env + `is_admin()`, investigate immediately. Correlate with Sentry's user IP + Supabase auth logs.

#### Rule 5 — Unusual crash rate
- Filter: `level:error`
- Trigger: `crash-free session rate drops below 99.5% in 15 minutes`
- Not strictly a security alert, but a crash spike after a deploy often correlates with security regressions.

### Tag propagation checklist

Before the rules can fire, the emitting code must attach the right tags. Verify:

| File | Tag | Already set? |
|------|-----|--------------|
| `Holistic Unity/Core/Security/DeepLinkRouter.swift` | `security.event_type=deep_link` | ✅ (Phase 3.2) |
| `Holistic Unity/Core/Security/JailbreakDetector.swift` | `security.event_type=jailbreak` | ✅ (Phase 3.1) |
| `supabase/functions/_shared/rate-limit.ts` | `security.event_type=rate_limit` via Sentry edge integration | ❌ — TODO: wire Sentry client in edge functions (currently only iOS + webapps use Sentry). |
| `admin-dashboard/src/lib/auth/requireAdmin.ts` | `security.event_type=admin_access_denied` | ❌ — TODO: add Sentry client + tag on 403 path. |
| `Holistic Unity/Core/Authentication/BiometricLock.swift` | `security.event_type=biometric_failed` | ❌ — TODO: add tag on repeated LAError. |

The three TODOs above are follow-up work — the alert rules will be created but remain dormant until the tags flow.

---

## 2. Supabase — log-based alerts

Supabase Dashboard → **Logs → Saved Queries**. For each query below, save with the suggested name + enable an alert via the "bell" icon → webhook to a Slack/Discord channel or an email.

> Queries use the Logflare SQL dialect (Supabase's log backend). All timestamps are UTC.

### Query 1 — failed auth rate spike
```sql
SELECT
  COUNT(*) AS failures,
  DATE_TRUNC('minute', timestamp) AS window
FROM auth_logs
WHERE
  event_message ILIKE '%invalid login credentials%'
  OR event_message ILIKE '%password grant error%'
GROUP BY window
HAVING COUNT(*) > 30
ORDER BY window DESC
```
**Why:** credential-stuffing attempts. 30+ failures per minute from any combination of IPs. Normal noise floor is ~1–3/min.

**Alert:** email on any result returned in last 5 min.

### Query 2 — spike in distinct failed users
```sql
SELECT
  COUNT(DISTINCT user_id) AS distinct_users,
  DATE_TRUNC('minute', timestamp) AS window
FROM auth_logs
WHERE
  event_message ILIKE '%invalid%'
  OR status >= 400
GROUP BY window
HAVING COUNT(DISTINCT user_id) > 50
ORDER BY window DESC
```
**Why:** enumeration attack — attacker trying many known email addresses against login. >50 distinct users failing in 60 s is not organic.

### Query 3 — `users.is_admin` row changes
```sql
SELECT *
FROM postgres_logs
WHERE
  event_message ILIKE '%UPDATE%users%is_admin%'
  AND event_message NOT ILIKE '%_guard_user_is_admin_updates%'
```
**Why:** only service_role should change `users.is_admin`. The `_guard_user_is_admin_updates` trigger blocks non-admin updates, so any row appearing here is either a legitimate admin action (seed script, manual promotion) or an attempted escalation. Either way — review.

**Alert:** email on ANY result in last hour.

### Query 4 — RLS policy violations
```sql
SELECT
  event_message,
  timestamp
FROM postgres_logs
WHERE
  event_message ILIKE '%new row violates row-level security%'
  OR event_message ILIKE '%permission denied for%'
```
**Why:** RLS violations usually surface as client errors the client retries past. If we see these for a specific user+table combination sustained, either:
- A legitimate RLS policy is too strict → fix.
- A client is trying to read something it shouldn't → investigate.

### Query 5 — edge function 5xx rate
```sql
SELECT
  function_id,
  COUNT(*) AS errors,
  DATE_TRUNC('minute', timestamp) AS window
FROM function_logs
WHERE
  status_code >= 500
GROUP BY function_id, window
HAVING COUNT(*) > 10
ORDER BY window DESC
```
**Why:** an edge function crash loop means the backend is failing open — maybe on critical paths like `create-booking-with-payment`. High priority.

### Query 6 — `rate_limit_buckets` hot keys
```sql
SELECT
  bucket_key,
  count
FROM rate_limit_buckets
WHERE
  count > 100
  AND expires_at > NOW()
ORDER BY count DESC
LIMIT 20
```
**Why:** identifies keys (user IDs or IPs) hammering the API faster than our limit. Re-run daily for a pattern; if the same key dominates, consider a longer block + manual account review.

This is a dashboard query, not an alert — Logflare doesn't watch the DB, only the log stream. Schedule as a daily email report via `pg_cron` + a tiny function that pushes to Resend if needed. For V1, a manual glance is fine.

### Query 7 — Failed payment intents
```sql
SELECT
  payment_intent_id,
  amount,
  status,
  last_error,
  created_at
FROM transactions
WHERE
  status IN ('failed', 'requires_action')
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
```
**Why:** day-over-day trend. An unusual spike usually means a Stripe config regression (wrong publishable key, wrong Connect account mapping) or a fraud ring.

---

## 3. Vercel — log draining

Vercel's default log retention is 1 hour on Hobby, 24 h on Pro. For any meaningful forensics (post-incident investigation more than a day after the fact) we need log draining.

### Recommended setup — Vercel Log Drain → Supabase Logflare

Vercel Pro required (includes log draining; Hobby doesn't).

1. Dashboard → **Project → Settings → Log Drains → Add new drain**
2. Choose **JSON**, endpoint: a Supabase function URL that writes incoming logs to a `vercel_logs` table.
3. Filter: `source:application` (only app logs, not build logs — those are noisier and less useful).

Alternatively — **Better Stack** or **Axiom** have free tiers for low log volumes and no custom drain endpoint to maintain. Axiom is the typical recommendation for Vercel for logs + metrics if you're not already paying for Datadog.

---

## 4. Distribution of alert load

Email alerts are fine for solo-founder phase. As the team grows:

| Alert severity | V1 (solo) | Post-team |
|----------------|-----------|-----------|
| Critical (admin access denied, money path) | Email | PagerDuty/OpsGenie → on-call phone |
| High (auth stuffing, edge-fn 5xx) | Email | Slack channel + email |
| Medium (deep link reject spike, jailbreak) | Email | Slack channel only |
| Info (weekly RL hot keys, dashboards) | Weekly digest | Weekly digest |

---

## 5. What's explicitly NOT monitored (V1)

- No NetFlow / WAF telemetry — Vercel and Supabase edges terminate TLS; we have no lower-level network visibility.
- No DNS-based anomaly detection — relying on Cloudflare's default DNS for marketing domain.
- No synthetic monitoring pings to `bqyqkvkzkemiwyqjkbna.supabase.co` from external prober.
- No end-user session replay — deliberately: therapy content is sensitive, Sentry `attachScreenshot` is OFF, and we refuse to deploy FullStory-style replay.

Those are accepted gaps. If any of them become critical, document the decision in `SECURITY_AUDIT.md` before adding.

## Related

- `security.md` — threat model these alerts defend against.
- `scanning-runbook.md` — scheduled deep scans.
- `../../PRE_DEPLOYMENT_QA.md` — release-gate checklist.
