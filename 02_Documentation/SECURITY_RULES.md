# Holistic Unity — Security Rules

> This file defines mandatory security patterns for all code changes.
> Referenced automatically when security-relevant code is written or modified.

---

## 1. Stack Context

- **Auth:** Supabase Auth (JWT + cookies via `@supabase/ssr`)
- **Database:** Supabase PostgreSQL with Row-Level Security (RLS)
- **Payments:** Stripe Connect — Destination Charges, 20% platform commission
- **Backend:** Supabase Edge Functions (Deno), Next.js API Routes
- **Frontend:** Next.js (React), iOS (SwiftUI)
- **Video:** LiveKit Cloud (WebRTC)
- **Chat:** Stream Chat
- **Hosting:** Vercel (webapp), Supabase (DB + Edge Functions)

---

## 2. Mandatory Patterns (must ALWAYS be true)

### Authentication
- All API routes MUST verify auth via `supabase.auth.getUser()` before processing
- Edge functions MUST extract JWT from `x-user-token` header (preferred) or `Authorization` header
- Edge functions MUST call `supabaseAdmin.auth.getUser(jwt)` to validate — never trust the JWT payload directly
- Token refresh MUST be handled on 401 responses

### Row-Level Security
- Every new table MUST have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Every SELECT policy MUST use `auth.uid()` — never client-supplied user IDs
- INSERT policies MUST restrict to `auth.uid() = user_id` — never `auth.role() = 'authenticated'` alone
- UPDATE/DELETE policies MUST verify ownership: `auth.uid() = owner_id`
- After creating RLS policies, verify with: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`

### Payments
- Payment amounts MUST be calculated server-side from the service price in the database
- Never trust client-sent prices — always verify: `body.price === service.price` (or pack price)
- The `connected_account_id` MUST come from `therapist_profiles` table, never from the client request
- Stripe webhook MUST verify signature via `stripe-signature` header + `STRIPE_WEBHOOK_SECRET`
- Webhook handlers MUST be idempotent (use UNIQUE constraints or event ID tracking)
- Refund amounts MUST be validated: `> 0 AND <= original_amount`

### Data Validation
- All numeric inputs MUST be validated: `isFinite()`, range checks, no NaN
- All string inputs MUST be length-limited (max 255 for names, max 1000 for descriptions)
- UUID inputs SHOULD be format-validated before DB queries
- Price fields MUST have CHECK constraints: `CHECK (price >= 0)`

### CORS
- Production edge functions MUST use the shared `_shared/cors.ts` module
- ALLOWED_ORIGINS must be an explicit whitelist — never `"*"` in production
- New domains MUST be added to the ALLOWED_ORIGINS array in `_shared/cors.ts`

---

## 3. Forbidden Patterns (must NEVER appear in code)

### Grep checks to run before any deployment:

```bash
# Hardcoded secrets
grep -rn "sk_live_\|sk_test_\|whsec_\|service_role" src/ --include="*.ts" --include="*.tsx"

# Service role key in client code
grep -rn "service_role" src/ --include="*.ts" --include="*.tsx" --include="*.swift"

# Wildcard CORS in production
grep -rn '"Access-Control-Allow-Origin": "\*"' supabase/functions/

# eval() or innerHTML with user input
grep -rn "eval(\|innerHTML\|dangerouslySetInnerHTML" src/ --include="*.ts" --include="*.tsx"

# Console.log with sensitive data
grep -rn "console.log.*password\|console.log.*token\|console.log.*secret" src/

# Raw SQL (bypass parameterized queries)
grep -rn "\.raw(\|\.rpc.*\\\`\|sql\\\`" src/ --include="*.ts"
```

All of the above MUST return 0 matches.

### Never do:
- Store `service_role` key in client-side code or NEXT_PUBLIC_* env vars
- Use `auth.role() = 'authenticated'` alone as an INSERT policy (too permissive)
- Trust client-sent prices, user IDs, or roles without server verification
- Return stack traces, SQL errors, or internal paths in API responses
- Store sensitive data in `localStorage` — use httpOnly cookies or Keychain
- Use `print()` for logging in Swift release builds — use `Logger(subsystem:category:)`
- Create tables without enabling RLS
- Use `Access-Control-Allow-Origin: *` in production edge functions

---

## 4. Pre-Launch Verification Commands

```bash
# 1. Check RLS on all tables
curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY tablename;"}' \
  | python3 -c "import json,sys; [print(f\"{'✅' if r['rowsecurity'] else '❌'} {r['tablename']}\") for r in json.load(sys.stdin)]"

# 2. Check for overly permissive INSERT policies
curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT tablename, policyname, with_check FROM pg_policies WHERE schemaname = '\''public'\'' AND cmd = '\''INSERT'\'' AND (with_check LIKE '\''%IS NOT NULL%'\'' OR with_check LIKE '\''%authenticated%'\'');"}'

# 3. Check npm vulnerabilities
cd therapist-webapp && npm audit --omit=dev

# 4. Verify no hardcoded secrets
grep -rn "sk_live_\|sk_test_\|whsec_\|service_role" therapist-webapp/src/ iOS-App/Holistic\ Unity/

# 5. Verify CORS is not wildcard
grep -rn '"Access-Control-Allow-Origin": "\*"' supabase/functions/

# 6. Verify webhook signature verification
grep -n "stripe-signature" supabase/functions/stripe-webhook/index.ts

# 7. Check Stripe keys in production
grep -rn "sk_test_\|pk_test_" therapist-webapp/.env.local iOS-App/Config/Secrets.xcconfig
```

---

## 5. Stripe-Specific Rules (Destination Charges + 20% Commission)

### Payment Flow
1. Client selects service → iOS sends `{bookingId, therapistId, serviceId, price, currency}` to `create-booking-with-payment`
2. Edge function MUST: fetch service from DB → verify `body.price == service.price` → reject if mismatch
3. Edge function computes: `sessionPriceCents`, `serviceFee`, `commissionBase`, `ivaAmount`, `totalChargeAmount`, `applicationFeeAmount`
4. PaymentIntent created with `application_fee_amount` (platform keeps) + `transfer_data.destination` (therapist gets rest)
5. Webhook receives `payment_intent.succeeded` → creates `transaction` row → creates `session_credits` if pack

### Commission Math
```
sessionPrice = service price (from DB, NOT client)
serviceFee = sessionPrice * 2.9% + €0.30
commissionBase = sessionPrice * 20%
ivaAmount = (commissionBase + serviceFee) * 22%  [only if therapist country = IT]
totalCharged = sessionPrice + serviceFee + ivaAmount
applicationFee = commissionBase + ivaAmount + serviceFee
therapistPayout = totalCharged - applicationFee
```

### Refund Rules
- Only `completed` transactions can be refunded
- Refund = 50% if > 24h before session, 0% if < 24h
- `refundAmountCents <= originalAmountCents` (enforced in `request-refund`)
- Transaction status updates: `completed` → `refunded` or `partially_refunded`

---

## 6. RLS Policy Template (for new tables)

```sql
-- 1. Always enable RLS
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- 2. SELECT: users see only their own rows
CREATE POLICY "Users can view own records"
  ON public.new_table FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- 3. INSERT: users can only create rows for themselves
CREATE POLICY "Users can insert own records"
  ON public.new_table FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 4. UPDATE: users can only update their own rows
CREATE POLICY "Users can update own records"
  ON public.new_table FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

-- 5. DELETE: users can only delete their own rows (if allowed)
CREATE POLICY "Users can delete own records"
  ON public.new_table FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- 6. For tables with therapist + client (like bookings):
CREATE POLICY "Clients can view own bookings"
  ON public.bookings_table FOR SELECT
  USING ((SELECT auth.uid()) = client_id);

CREATE POLICY "Therapists can view assigned bookings"
  ON public.bookings_table FOR SELECT
  USING ((SELECT auth.uid()) = therapist_id);

-- 7. Price constraints
ALTER TABLE public.new_table
  ADD CONSTRAINT price_non_negative CHECK (price >= 0);
```

### Anti-patterns to avoid:
```sql
-- ❌ BAD: Any authenticated user can insert for anyone
CREATE POLICY "bad" ON table FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ❌ BAD: Any authenticated user can read everything
CREATE POLICY "bad" ON table FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ✅ GOOD: Only the owner
CREATE POLICY "good" ON table FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

---

## 7. Severity Classification

| Level | Meaning | SLA |
|-------|---------|-----|
| **LAUNCH-BLOCKING** | Must fix before any public deployment | Immediate |
| **IMPORTANT** | Fix within first week post-launch | 7 days |
| **NICE-TO-HAVE** | Improves security posture, not urgent | 30 days |
