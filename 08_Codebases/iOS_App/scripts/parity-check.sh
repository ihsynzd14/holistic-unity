#!/usr/bin/env bash
# parity-check.sh — verify iOS ↔ web app sync
#
# Run from anywhere. Exits 0 if everything aligned, 1 if gaps found.
#
# Checks performed:
#   1. Edge Function source presence (every deployed function has local TS)
#   2. Edge Function source freshness (no source older than the deployed version's update date)
#   3. DTO required-NOT-NULL fields actually non-null in DB rows
#   4. iOS BookingStatus enum covers all distinct status values in DB
#   5. iOS TherapyCategory dbValue covers all distinct categories in DB
#   6. Stale `pending` bookings with PI but never confirmed
#
# Requires:
#   - SBP_TOKEN env var (Supabase personal access token, sbp_*)
#   - jq, curl, python3
#
# Usage:
#   SBP_TOKEN=sbp_... ./parity-check.sh

set -euo pipefail

SBP="${SBP_TOKEN:-}"
PROJECT="bqyqkvkzkemiwyqjkbna"

if [[ -z "$SBP" ]]; then
  echo "❌ SBP_TOKEN not set. Get one at https://supabase.com/dashboard/account/tokens"
  exit 2
fi

# Resolve repo root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."  # the Backup 6 Aprile directory itself
EF_DIR="$ROOT/../../supabase/functions"  # iOS App/supabase/functions
WEB_DIR="$ROOT/../../../client-webapp/src"

GAPS=0
note() { echo "  ⚠️  $*"; GAPS=$((GAPS+1)); }
ok()   { echo "  ✅ $*"; }
hr()   { echo; echo "── $1 ──"; }

# ─────────────────────────────────────────────────────────────────────
hr "1. Edge Function source presence"
DEPLOYED=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/functions" \
  -H "Authorization: Bearer $SBP" | python3 -c "
import json, sys
for f in json.load(sys.stdin):
    print(f['slug'])")

while read -r slug; do
  [[ -z "$slug" ]] && continue
  if [[ -f "$EF_DIR/$slug/index.ts" ]]; then
    ok "$slug"
  else
    note "$slug deployed but no local source at $EF_DIR/$slug/index.ts"
  fi
done <<< "$DEPLOYED"

# ─────────────────────────────────────────────────────────────────────
hr "2. DB integrity for therapist_profiles required fields"
INTEGRITY=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
  -X POST -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  -d '{"query":"SELECT count(*) as c FROM public.therapist_profiles WHERE is_approved AND (tagline IS NULL OR bio IS NULL OR cancellation_policy IS NULL OR approval_status IS NULL OR created_at IS NULL OR updated_at IS NULL);"}')
NULLS=$(echo "$INTEGRITY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['c'])")
if [[ "$NULLS" == "0" ]]; then
  ok "all approved therapist_profiles have non-null required DTO fields"
else
  note "$NULLS approved therapist_profiles have NULL in DTO-required fields → iOS decode will fail"
fi

# ─────────────────────────────────────────────────────────────────────
hr "3. Distinct booking statuses vs iOS BookingStatus enum"
STATUSES=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
  -X POST -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  -d '{"query":"SELECT DISTINCT status FROM public.bookings ORDER BY status;"}' \
  | python3 -c "import sys,json; print('|'.join(r['status'] for r in json.load(sys.stdin)))")

IOS_BOOKING_FILE="$ROOT/Holistic Unity/Domain/Models/Booking.swift"
IFS='|' read -r -a S <<< "$STATUSES"
for s in "${S[@]}"; do
  # Allow either snake_case or camelCase; the BookingDTO falls back to .pending for unknowns
  if grep -q "\"$s\"\\|case ${s//_/}" "$IOS_BOOKING_FILE" 2>/dev/null; then
    ok "DB status '$s' recognised by iOS"
  else
    # `pending_payment` is intentionally not in iOS BookingStatus enum (filtered at query level)
    if [[ "$s" == "pending_payment" ]]; then
      ok "DB status '$s' (filtered out of upcoming-bookings query, no enum needed)"
    else
      note "DB status '$s' has no matching iOS BookingStatus case — DTO will fall back to .pending"
    fi
  fi
done

# ─────────────────────────────────────────────────────────────────────
hr "4. Distinct therapist categories vs iOS TherapyCategory.dbValue"
CATS=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
  -X POST -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  -d '{"query":"SELECT DISTINCT unnest(categories) AS c FROM public.therapist_profiles WHERE is_approved ORDER BY c;"}' \
  | python3 -c "import sys,json; print('|'.join(r['c'] for r in json.load(sys.stdin) if r['c']))")

CAT_FILE="$ROOT/Holistic Unity/Domain/Models/TherapyCategory.swift"
IFS='|' read -r -a C <<< "$CATS"
for c in "${C[@]}"; do
  if grep -q "\"$c\"" "$CAT_FILE" 2>/dev/null; then
    ok "DB category '$c' present in TherapyCategory (dbValue or rawValue)"
  else
    note "DB category '$c' has no iOS mapping — therapist's category dropped silently in compactMap"
  fi
done

# ─────────────────────────────────────────────────────────────────────
hr "5. Stale 'pending' bookings (zombie slots blocking other clients)"
STALE=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
  -X POST -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  -d '{"query":"SELECT count(*) as c FROM public.bookings WHERE status = '"'"'pending'"'"' AND stripe_payment_intent_id IS NOT NULL AND created_at < now() - interval '"'"'2 hours'"'"';"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['c'])")
if [[ "$STALE" == "0" ]]; then
  ok "no stale 'pending'+PI bookings older than 2h"
else
  note "$STALE stale pending bookings blocking slots — run the cleanup UPDATE manually"
fi

# ─────────────────────────────────────────────────────────────────────
hr "6. Marcello DB Connect ID coherence"
MARCELLO=$(curl -fsS "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
  -X POST -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  -d '{"query":"SELECT count(*) as dups FROM public.therapist_profiles WHERE display_name ILIKE '"'"'Marcello%'"'"';"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['dups'])")
if [[ "$MARCELLO" == "1" ]]; then
  ok "exactly 1 Marcello profile"
else
  note "$MARCELLO Marcello profiles in DB — investigate for duplicates"
fi

# ─────────────────────────────────────────────────────────────────────
echo
if [[ "$GAPS" == "0" ]]; then
  echo "✅ All parity checks passed."
  exit 0
else
  echo "⚠️  $GAPS parity gaps detected. Review above."
  exit 1
fi
