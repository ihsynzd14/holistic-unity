# Security Scanning Runbook

**Last verified:** 2026-04-17 by Marcello
**Status:** ✅ Ready to use (Phase 4 deployment)
**Owner:** Marcello

> **Purpose:** operational playbook for the manual security scans that can't realistically run in CI (binary analysis on IPA, deep-crawl web scanners, TLS health). Each section is self-contained — copy/paste the block you need.

## When to run what

| Scan | Cadence | Trigger |
|------|---------|---------|
| `ggshield secret scan repo .` | **Before every public release** | Paranoia safety net on top of gitleaks CI |
| MobSF on Release IPA | After every major release | TestFlight builds OK to skip; archive-to-App-Store builds MUST pass |
| OWASP ZAP baseline | Monthly | Also on any notable webapp route change |
| testssl.sh | Quarterly | Also after any cert rotation |
| `npm audit --omit=dev --audit-level=high` | CI does it automatically | Manual rerun if a Dependabot PR is merged outside CI |

If you don't have Docker installed yet: `brew install --cask docker` or download Docker Desktop from docker.com. Start the Docker app before running the commands below.

---

## 1. ggshield — secret leak scan (Phase 1.1 + ongoing)

Belt-and-suspenders alongside the gitleaks CI workflow. Gitleaks runs on every push; ggshield catches patterns the ruleset may have missed (GitGuardian's signature DB is larger than gitleaks' default).

```bash
# One-time setup:
brew install ggshield
ggshield auth login   # opens browser to pair with a free GitGuardian account

# Scan any repo before a release:
cd "<REPO>"
ggshield secret scan repo .

# Scan the whole git history (~minutes on small repos):
ggshield secret scan repo --all-commits .
```

**What to do on a hit:**
1. Rotate the leaked secret immediately (see `INCIDENT_RESPONSE.md` per-provider steps once written).
2. `git filter-repo` or BFG to purge from history if it's in a commit that's already been pushed to a public remote.
3. Add the false-positive pattern to `.gitleaks.toml` `[allowlist]` if it's a test key / mock.

**Alternative:** `brew install trufflehog && trufflehog git file://. --only-verified` — TruffleHog is faster for large repos but doesn't catch as many provider-specific patterns.

---

## 2. MobSF — iOS IPA static analysis (Phase 4.1)

Mobile Security Framework — a full-spectrum scanner for compiled iOS and Android binaries. Flags hardcoded secrets, weak crypto, insecure ATS config, exported URL schemes with no validation, and App Transport Security bypasses. Run against the Release IPA (not Debug — Release has stripped symbols + final compile settings).

```bash
# Start MobSF as a local container:
docker run --rm -d \
  --name mobsf \
  -p 8000:8000 \
  opensecurity/mobile-security-framework-mobsf:latest

# Open http://localhost:8000 in a browser.
# Default creds: mobsf / mobsf — change on first login.

# Build the IPA in Xcode:
#   Product → Archive → Distribute App → App Store Connect (or Enterprise)
#   → Export → choose a local path.
# Then upload the .ipa via the MobSF web UI.

# Scan takes 2–5 minutes. Review results under these sections:
#   - Static Analysis → Code Analysis   (hardcoded secrets, API keys)
#   - Static Analysis → Binary Analysis (PIE, stack canaries, RPATH)
#   - Static Analysis → ATS Analysis    (NSAllowsArbitraryLoads, TLS settings)
#   - Domain Analysis                   (3rd-party endpoints)
#   - Manifest Analysis                 (URL schemes, capabilities)

# Stop MobSF:
docker stop mobsf
```

**What to treat as a blocker for TestFlight:**
- ANY "HIGH" finding in Static Analysis → Code Analysis (hardcoded secrets/keys).
- ATS Analysis showing `NSAllowsArbitraryLoads=true`.
- Binary compiled without PIE (`-fPIE`) — this should be impossible in a 2026 Xcode build but verify anyway.

**What's acceptable to ship with (document in release notes):**
- Reflection / dynamic dispatch warnings (SwiftUI uses these extensively).
- Weak hashes in dependency code (if the hash isn't used for security — e.g. non-crypto UUID generation).

---

## 3. OWASP ZAP — web vulnerability baseline scan (Phase 4.2)

Automated web scanner. The `zap-baseline.py` variant is spider-only (no active attacks), safe to run against production. Targets: therapist webapp, admin dashboard, marketing site.

```bash
# Scan therapist webapp:
docker run --rm -t \
  --user "$(id -u):$(id -g)" \
  -v "$(pwd):/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t https://therapistportal.holisticunity.app \
    -r zap-therapist-$(date +%Y%m%d).html \
    -I

# Scan admin dashboard (same, different URL):
docker run --rm -t \
  --user "$(id -u):$(id -g)" \
  -v "$(pwd):/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t https://admin.holisticunity.app \
    -r zap-admin-$(date +%Y%m%d).html \
    -I

# Scan marketing site:
docker run --rm -t \
  --user "$(id -u):$(id -g)" \
  -v "$(pwd):/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t https://holisticunity.app \
    -r zap-site-$(date +%Y%m%d).html \
    -I
```

Flags:
- `-I` — ignores warnings (doesn't exit non-zero on informational findings). Remove this flag if running in CI where you want warnings to fail the job.
- `-r <file>` — HTML report saved to the current directory.

**Typical findings + resolution:**
- `Missing Anti-clickjacking Header` — shouldn't fire now (we set `X-Frame-Options: DENY` + `frame-ancestors 'none'`). If it does, inspect the route — some Vercel rewrites drop headers.
- `Cross-Domain JavaScript Source File Inclusion` — fine on routes that embed Stripe.js or LiveKit.
- `Content Security Policy (CSP) Header Not Set` — shouldn't fire after Phase 3.4 deploy. If it does, check `proxy.ts` / `middleware.ts` matcher is hitting that route.
- `Cookie Without Secure Flag` — Supabase sets this correctly in production; ZAP may flag local dev cookies.

**Active scan (more aggressive, don't run on prod):**
Replace `zap-baseline.py` with `zap-full-scan.py`. Only run against a staging environment — it WILL submit test payloads including SQL injection probes.

---

## 4. testssl.sh — TLS configuration audit (Phase 4.5)

Verifies cipher suites, HSTS preload eligibility, certificate validity, vulnerability to known TLS CVEs (ROBOT, Heartbleed, POODLE, …).

```bash
# Scan all production-facing endpoints in one go.
for host in \
  bqyqkvkzkemiwyqjkbna.supabase.co \
  therapistportal.holisticunity.app \
  admin.holisticunity.app \
  holisticunity.app; do
  echo "=========================================="
  echo "  $host"
  echo "=========================================="
  docker run --rm -t drwetter/testssl.sh:latest \
    --severity HIGH \
    --quiet \
    --color 0 \
    "https://$host"
done | tee "testssl-$(date +%Y%m%d).log"
```

**Pass criteria:**
- Protocol support: TLS 1.2 + TLS 1.3 only. TLS 1.0 / 1.1 disabled.
- Cipher suites: no `EXPORT`, `RC4`, `DES`, `3DES`, `MD5`.
- No vulnerability to ROBOT, Heartbleed, CCS Injection, Ticketbleed, Secure Renegotiation, CRIME, BREACH.
- HSTS header present, `max-age >= 31536000`, `includeSubDomains` recommended.

**Won't pass:**
- HSTS preload — requires manual submission to hstspreload.org AND no subdomain hosts that break on HTTPS-only. Document the decision; optional.

---

## 5. iOS-side `swift package show-dependencies`

Quick check that SPM dependencies are pinned and there's no unexpected dep drift:

```bash
cd "iOS App/untitled folder/Backup 6 Aprile"
xcodebuild -resolvePackageDependencies \
  -project "Holistic Unity.xcodeproj" \
  -scheme "Holistic Unity"

# Then inspect the resolved graph:
cat "Holistic Unity.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved" | jq '.pins[] | {name: .identity, version: .state.version}'
```

Compare against the last-known-good list in `PRE_DEPLOYMENT_QA.md` § Phase 3 Audit. Any unexpected new dep is a red flag (supply-chain risk).

---

## 6. Triage workflow after each scan

For every finding above a noise threshold:

1. **Reproduce.** If a scanner says "XSS in field X" — try the payload manually. Scanners have false positives.
2. **Classify.** Is this:
   - A legitimate bug in OUR code → fix in a regular PR.
   - A dependency bug → upgrade the dep (Dependabot PR expected within a week).
   - A third-party service's problem (Supabase / Stripe / Stream) → open a ticket, document as "accepted risk" in `SECURITY_AUDIT.md` until upstream fixes.
3. **Document.** Any "accepted risk" item must have an owner and a review date in `SECURITY_AUDIT.md`.
4. **Re-scan after the fix ships.** Close the loop in the same release notes that mention the scan.

---

## 7. What's automated vs. manual

| Check | Mechanism | Fires |
|-------|-----------|-------|
| Secrets in commit history | `.github/workflows/gitleaks.yml` | Push + PR + weekly |
| npm high/critical CVEs | `.github/workflows/npm-audit.yml` | Push + PR + daily |
| Dep version drift | `.github/dependabot.yml` | Weekly PRs |
| GitHub Actions version drift | `.github/dependabot.yml` (github-actions ecosystem) | Weekly PRs |
| iOS binary analysis (MobSF) | Manual — this runbook §2 | Major releases |
| Web crawl + header check (ZAP) | Manual — this runbook §3 | Monthly |
| TLS cipher audit (testssl) | Manual — this runbook §4 | Quarterly |
| SPM graph audit | Manual — this runbook §5 | Before TestFlight |
| Ad-hoc secret rescan (ggshield) | Manual — this runbook §1 | Before public release |

## Related

- `../../SECURITY_AUDIT.md` — findings history + accepted risks.
- `../../PRE_DEPLOYMENT_QA.md` — full Part A–I checklist for each release.
- `security.md` — threat model + what's defended.
- `INCIDENT_RESPONSE.md` (pending — Phase 5.3).
