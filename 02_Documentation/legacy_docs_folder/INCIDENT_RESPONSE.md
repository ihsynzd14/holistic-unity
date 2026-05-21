# Incident Response Runbook

**Last verified:** 2026-04-17 by Marcello
**Status:** ✅ V1 (solo-founder). Revise when team grows.
**Owner:** Marcello

> **Purpose:** the playbook you reach for at 02:00 when something is wrong. Written so a tired person can follow it without thinking. If you ever update a secret, close a cert, or change a provider — UPDATE THIS DOC in the same PR.

## How to use

1. **First 5 minutes — triage.** Jump to § 1 (Severity matrix) and pick a level. Everything else derives from that.
2. **Declare.** If Sev 1 or Sev 2, page yourself (until there's a team, that's just "open laptop, focus, silence other notifications").
3. **Follow the relevant § 2–6 playbook.**
4. **After the fire is out — § 7 post-mortem.** Don't skip, even solo. The point is preventing recurrence, not assigning blame.

## Contact / escalation chain (V1)

- Primary: Marcello — Armand@stormxdigital.com
- Secondary: — (add co-founder / ops when hired)
- Legal: — (add DPO contact when retained)
- PR / user comms: — (handled by founder for V1)

---

## 1. Severity matrix

| Sev | Definition | Response time target | Typical example |
|-----|------------|---------------------|-----------------|
| **1 — Critical** | User data breach, money loss, full outage, or public safety risk | < 15 min ack, active incident until resolved | Stripe secret leaked, database wiped, admin RLS bypass proven |
| **2 — High** | Feature broken for all users, no data exposed, money flows intact | < 1 h ack | Booking endpoint 500s, LiveKit down, Stream Chat disconnected |
| **3 — Medium** | Feature degraded for subset of users, workaround exists | < 4 h ack | Specific therapist's calendar sync broken, single language string wrong |
| **4 — Low** | Cosmetic / UX polish, no user-facing impact | Next business day | Typo, slight layout shift |

When in doubt, escalate one level. It's cheaper to treat a Sev 3 as Sev 2 than the reverse.

---

## 2. Secret rotation (Sev 1: secret proven leaked)

A secret is **proven leaked** if you can see it in any of these places:
- A public git repo (including a commit that was force-pushed away — assume it was crawled)
- A public Vercel preview URL / log
- A screenshot, a tweet, a Slack thread that touches anyone outside the team
- Gitleaks / ggshield / GitHub secret-scanning alert
- A Sentry breadcrumb that logged the secret by accident

When this happens: **do not wait to understand scope**. Rotate first, investigate second.

### 2.1 Supabase `service_role` JWT (HIGHEST PRIORITY)
1. Supabase Dashboard → **Project Settings → API → "Reset service_role secret"**. Old JWT invalidated within ~30 s of the new one being shown.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in **every** environment:
   - Vercel → therapist-webapp → Settings → Environment Variables (Production + Preview + Development)
   - Vercel → admin-dashboard → same
   - Supabase → Project Settings → Edge Functions → Secrets (every edge function reads it from env)
3. Trigger a redeploy in each Vercel project (envs take effect on next build).
4. Re-deploy every edge function that references it: `supabase functions deploy <name>` — list is in `/supabase/functions/*/index.ts`.
5. **Verify:** hit any service_role-protected endpoint (e.g. `/api/admin/set-monthly-payouts`) with an admin account. Must still work. Then hit it with the *old* key — must 401.

### 2.2 Stripe keys (`sk_live_*`, `rk_live_*`, `whsec_*`)
1. Stripe Dashboard → **Developers → API Keys**. Choose the key → "Roll". Stripe shows both old + new for 24 h by default (shorten this to 1 h via dropdown if leak is severe).
2. Webhook secret (`whsec_*`): **Developers → Webhooks → select endpoint → Roll secret**. 24 h grace period.
3. Update all Vercel + Supabase secrets with the new values (same path as 2.1).
4. For `whsec_*`: the migration is automatic during the grace period because Stripe sends BOTH signatures on the `Stripe-Signature` header. After grace expires, only the new one is sent.
5. **Verify:** make one test charge through Stripe test mode with the new key. Check `supabase/functions/stripe-webhook` logs for successful signature verification.

### 2.3 LiveKit API secret
1. LiveKit Cloud dashboard → **API Keys** → create a new key pair → mark old one as "deprecated" (Don't delete yet — in-flight session tokens are signed with the old secret and must remain validatable until they expire ~1 h later).
2. Update `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` in Supabase edge function secrets + Vercel env.
3. Re-deploy `supabase/functions/livekit-token`.
4. Wait 2 h (longer than the token TTL of 1 h + buffer). Then delete the old key.

### 2.4 Stream Chat API secret
1. Stream dashboard → **App → App Settings → API Keys** → "Regenerate secret".
2. Update `STREAM_API_SECRET` in Supabase edge function secrets + Vercel env.
3. Re-deploy `supabase/functions/stream-token`.
4. Active user sessions will keep working because tokens are issued server-side; new connections use the new secret.

### 2.5 `ICAL_SECRET` (HMAC signing)
1. Generate a new 32-byte random secret: `openssl rand -hex 32`.
2. Update `ICAL_SECRET` in both webapp Vercel envs.
3. **Cost:** every therapist's iCal feed URL becomes invalid instantly. Users need to re-add the feed from their webapp dashboard. Either: (a) email all active therapists ahead of time, or (b) accept the friction if severity warrants.
4. Document the user-comm timeline if doing (b).

### 2.6 `OAUTH_STATE_SECRET` (CSRF HMAC for OAuth)
1. Same generation: `openssl rand -hex 32`.
2. Update in Vercel envs.
3. **Cost:** any OAuth flow currently in progress (user clicked "Connect Google Calendar", is on the Google consent screen right now) will fail when they come back. Acceptable — transient.

### 2.7 Google / Microsoft OAuth client secrets
- **Google:** Google Cloud Console → APIs & Services → Credentials → select the OAuth 2.0 Client → "Reset client secret". Update Vercel envs. No grace period available.
- **Microsoft (Azure AD):** Azure Portal → App Registrations → your app → Certificates & secrets → delete old, create new. Value shown only at creation — copy immediately. See the existing runbook `MICROSOFT_OUTLOOK_SECRET_REGEN.md` for step-by-step.

### 2.8 Anthropic / OpenAI / other AI vendor keys
Not in V1 scope. Update this section when/if we integrate.

---

## 3. Data breach response (Sev 1)

Triggered when you have reason to believe personal data has been exposed (e.g. RLS bypass, SQL injection succeeded, unauthorised admin access, lost laptop with unencrypted backup).

### 3.1 Immediate (first 30 min)
1. **Stop the bleeding.** Disable the offending endpoint or deploy an RLS tightening that closes the hole. If you can't patch in 15 min, put the affected feature behind a "down for maintenance" flag.
2. **Preserve evidence.** `pg_dump` the current state of the affected tables. Save Vercel + Supabase logs for the relevant window. Don't delete anything — even "obviously unused" logs — for at least 30 days post-incident.
3. **Scope the impact.** Query to count affected user rows. Don't estimate — get the actual list of `user_id`s who may have had data exposed.

### 3.2 GDPR notification clock starts (Art 33)
If personal data of EU residents may have been exposed, you have **72 hours** from becoming aware to notify the supervisory authority (Italy: Garante per la protezione dei dati personali).

If the breach is "likely to result in a high risk to the rights and freedoms of natural persons" (Art 34), you must also notify the **affected individuals** directly.

### 3.3 Communication templates

**Internal status update (first hour):**
```
[INC-YYYYMMDD-NNN] Sev 1 data incident

Status: [Investigating | Mitigated | Resolved]
Detected: YYYY-MM-DD HH:MM UTC
Potentially affected users: N (exact count)
Data categories potentially exposed: [e.g. email, display name, booking metadata]
Monetary impact: [none | N transactions worth €X]
Current action: [what we're doing right now]
Next update: in [X] minutes
```

**User notification (draft — legal review required before send):**
```
Subject: Security notice regarding your Holistic Unity account

Dear [name or "Client"],

On YYYY-MM-DD we detected an incident that may have exposed some
information from your Holistic Unity account. The data that may have
been viewed by unauthorised parties includes: [specific list —
be honest, be specific].

We have already taken these steps:
• [what we did]
• [what we did]
• [what we did]

What we recommend you do:
• If you reuse your password on other services, change it there.
• Review your recent bookings and messages for anything unexpected.
• If you see anything unusual, reply to this email.

We are continuing the investigation and will send a follow-up update
within [X] days. We have notified [Garante / relevant DPA] as required
by GDPR Article 33.

We are sorry for the concern this causes. If you have questions, reply
to this email — a human will respond within 24 hours.

Marcello Froscia
Holistic Unity
```

**Supervisory authority notification:** follow the Garante's online form at https://servizi.gpdp.it. Summary elements required: nature of breach, categories of data and data subjects, approximate number of subjects, contact of DPO or data controller, likely consequences, measures taken or proposed.

### 3.4 Post-incident restoration
- Force password reset for any user whose session may have been hijacked (Supabase dashboard → Users → select → "Invalidate sessions").
- If financial data was touched, ask Stripe radar review of recent transactions on affected accounts.
- If LiveKit room access may have been leaked, log all active rooms and consider force-disconnecting (LiveKit dashboard → Rooms → terminate).

---

## 4. Supabase point-in-time recovery (data loss)

Triggered when: database was accidentally dropped / truncated / catastrophically corrupted.

### 4.1 Check your retention window
- Supabase **Pro** plan includes 7 days of PITR. Free plan has **daily backups only** (up to 7 days, one snapshot per day).
- Verify current plan + retention: Supabase Dashboard → Database → Backups.

### 4.2 Decide: full restore or targeted restore?
- **Full restore** (`supabase projects update --restore-from <timestamp>`) — rolls back the ENTIRE database. Any legitimate writes after the chosen timestamp are lost.
- **Targeted restore** — restore to a new project, dump the needed tables, diff against production, merge selectively. More surgical, more effort.

For most incidents: targeted is safer. Full restore is a nuclear option.

### 4.3 Targeted restore procedure
1. Supabase Dashboard → Database → Backups → "Restore to new project" (provisions a new project from the snapshot).
2. Connect to the restored project's database with psql using the connection string from the new project's settings.
3. Dump the specific affected tables: `pg_dump --data-only -t public.bookings -t public.transactions ... > restored.sql`
4. Diff against production's current state. Script the merge carefully — unique constraints may fight you.
5. Import into production inside a transaction (`BEGIN; ... COMMIT;`) so you can roll back if something is off.
6. Delete the temporary restored project.

### 4.4 What to audit after restore
- Any row you restored with a `created_at` newer than the snapshot timestamp may have been legitimately updated between snapshot + incident. Cross-reference with logs.
- `pg_cron` jobs may have double-fired — check `rate_limit_buckets`, `orphaned bookings cleanup`, etc.
- Stripe webhooks that were replayed against the restored state: check for duplicate charges (our UNIQUE constraint on `stripe_payment_intent_id` protects, but verify).

---

## 5. Stripe fraud / dispute path

Triggered when: Stripe Radar flags a transaction, a chargeback is filed, or a user reports unauthorised payment.

### 5.1 Immediate
1. Stripe Dashboard → Payments → search by `stripe_payment_intent_id` from our `transactions` table.
2. If `status = disputed` and we want to contest: use Stripe's "Submit evidence" flow. Include: booking record (from our DB), session log if video call was held (LiveKit session duration), chat transcript if any communication happened.
3. If the charge was clearly fraudulent (card reported stolen): accept the dispute; the refund will be processed automatically.

### 5.2 Platform-level fraud signal
If multiple disputes hit the same therapist within a short window, pause that therapist's Stripe Connect payouts:
```sql
UPDATE public.therapist_profiles
SET stripe_account_status = 'paused'
WHERE id = '<therapist_id>';
```
Then contact the therapist for verification. Reopen only once resolved.

### 5.3 Refund from our side (user requests, no dispute)
Use the admin dashboard at `/api/admin/refund` (backed by `requireAdmin()` 2-factor gate). This:
- Creates a Stripe refund for the transaction
- Marks our `transactions.status = 'refunded'`
- Adjusts `therapist_payout` if the refund is full or partial
- Emits an in-app notification to both parties

Full procedure is in `docs/flows/08-refund-cancellation.md`.

---

## 6. Vercel / Supabase outage playbook (Sev 2)

Triggered when: a hosted service we depend on is down.

### 6.1 Vercel outage (webapp portal unreachable)
- Check Vercel status page: https://www.vercel-status.com/
- If it's platform-wide, nothing we can do except comms.
- If it's our project specifically: redeploy from a known-good git commit. Sometimes a build corrupted artefact.

### 6.2 Supabase outage
- Check https://status.supabase.com/
- Platform-wide: user comms → tweet / email affected therapists.
- Project-specific: check Compute + Database metrics in the dashboard. Restart compute if pegged.
- Emergency read-only mode: we don't have this wired up in V1 (accepted risk).

### 6.3 Stripe outage
- Users see booking checkout fail. Check https://status.stripe.com/.
- We queue nothing client-side; failed charges are lost. Accept the loss; Stripe almost never has multi-hour outages.

### 6.4 LiveKit outage
- Video calls fail to connect.
- Users should be told to reschedule; we can't route around.
- Status: https://status.livekit.io/

### 6.5 Stream Chat outage
- In-app chat fails to connect.
- Status: https://status.getstream.io/
- Non-critical — chat history is not a money path. Queue user-comms if outage > 1 h.

### 6.6 Communications templates for outages
- **In-app banner (therapist webapp):** wire through a kill-switch we can flip via Vercel env var `SHOW_OUTAGE_BANNER=1` — today we'd have to deploy a quick PR for this. (TODO: add a generic banner component.)
- **Email to affected users:** template in § 3.3 adapted.
- **Status-page:** we don't host one yet. If outages become common, provision a free https://statuspage.io account.

---

## 7. Post-mortem (always, even for Sev 3)

Within 5 business days of resolution, write a post-mortem with these sections:

1. **What happened** — factual timeline. No blame, no feelings. Times in UTC.
2. **Impact** — users affected, duration, monetary or data loss if any.
3. **Root cause** — technical. Go 3-deep on "why": not "a database query was slow", but "a missing index on `bookings(therapist_id)` caused a seq scan on a growing table, and the migration that should have added the index was skipped because the CI didn't run `supabase db push`".
4. **What went well** — one thing minimum. Reinforce the positive.
5. **What went badly** — again, technical, not personal.
6. **Action items** — concrete, assigned, dated. Every item has an owner and a target date. File each as a separate GitHub issue.

Save each post-mortem as `docs/postmortems/YYYYMMDD-short-slug.md`. Never delete one; they compound into institutional memory.

---

## 8. Drills (optional, recommended quarterly)

When time allows, run a tabletop exercise:
- "Imagine the Supabase service_role secret leaked on Twitter right now. Who does what first? How long does rotation take? How do we communicate?"

Time how long each step takes. Fix the slow steps. Update this doc with anything new you learned.

## Related

- `platform/security.md` — threat model + what's defended
- `platform/monitoring.md` — alert rules that trigger the playbooks here
- `platform/scanning-runbook.md` — scheduled scans that reduce incident rate
- `PRE_DEPLOYMENT_QA.md` — release-gate checklist
- `MICROSOFT_OUTLOOK_SECRET_REGEN.md` — detailed Azure AD secret rotation
- Supabase status: https://status.supabase.com/
- Vercel status: https://www.vercel-status.com/
- Stripe status: https://status.stripe.com/
- LiveKit status: https://status.livekit.io/
- Stream status: https://status.getstream.io/
