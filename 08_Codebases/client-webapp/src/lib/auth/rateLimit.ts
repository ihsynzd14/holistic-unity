import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * Postgres-backed rate limiter for Next.js API routes.
 *
 * Calls the `check_rate_limit(key, max, window_seconds)` RPC on Supabase,
 * which is shared with Edge Functions. The counter is global — all
 * webapp instances + Deno Edge Function instances share the same state.
 *
 * Usage in a route handler:
 *
 *   const limit = await withRateLimit(req, { key: "ical-feed", max: 60, windowSec: 3600 });
 *   if (limit.response) return limit.response;
 *   // ... proceed
 *
 * The limiter uses (in this priority order):
 *   1. an explicit `userId` passed by the caller (best — ties to authenticated user)
 *   2. `x-forwarded-for` first IP (set by Vercel edge)
 *   3. `x-real-ip`
 *   4. literal "anon" (worst case; effectively a global limit)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Service-role client reused across invocations (stateless; safe).
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export interface RateLimitOptions {
  /** Short, purpose-specific key prefix — e.g. "ical-feed" or "stripe-connect". */
  key: string;
  /** Max requests in the window. */
  max: number;
  /** Window duration in seconds. Default: 60. */
  windowSec?: number;
  /** Optional authenticated user ID — if provided, takes priority over IP. */
  userId?: string;
}

export interface RateLimitSuccess {
  response?: never;
  remaining: number;
  limit: number;
}

export interface RateLimitFailure {
  response: NextResponse;
  remaining?: never;
  limit?: never;
}

export type RateLimitOutcome = RateLimitSuccess | RateLimitFailure;

function requestIdentity(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`;

  const xff = request.headers.get("x-forwarded-for");
  if (xff) return `ip:${xff.split(",")[0].trim()}`;

  const xreal = request.headers.get("x-real-ip");
  if (xreal) return `ip:${xreal}`;

  return "anon";
}

export async function withRateLimit(
  request: NextRequest,
  opts: RateLimitOptions
): Promise<RateLimitOutcome> {
  const windowSec = opts.windowSec ?? 60;
  const identity = requestIdentity(request, opts.userId);
  const fullKey = `${opts.key}:${identity}`;

  // If Supabase admin client unavailable (env missing), FAIL OPEN with a
  // warning — better to let requests through than to hard-block all traffic
  // during a misconfiguration. Real production has the env vars set.
  if (!supabaseAdmin) {
    console.warn("[rateLimit] SUPABASE_SERVICE_ROLE_KEY missing — rate limiting DISABLED");
    return { remaining: opts.max, limit: opts.max };
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
      p_key: fullKey,
      p_max: opts.max,
      p_window_seconds: windowSec,
    });

    if (error || !data) {
      console.error("[rateLimit] RPC error:", error?.message ?? "no data");
      // Fail open on infrastructure issues (DB down). User-visible rate
      // limiting is more important than perfect enforcement.
      return { remaining: opts.max, limit: opts.max };
    }

    // RPC returns [{ count, limited }]
    const row = Array.isArray(data) ? data[0] : data;
    const count = Number(row?.count ?? 0);
    const limited = Boolean(row?.limited);

    if (limited) {
      return {
        response: NextResponse.json(
          { error: "Too many requests. Please try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": String(windowSec),
              "X-RateLimit-Limit": String(opts.max),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(
                Math.floor(Date.now() / 1000) + windowSec
              ),
            },
          }
        ),
      };
    }

    return {
      remaining: Math.max(0, opts.max - count),
      limit: opts.max,
    };
  } catch (err) {
    console.error(
      "[rateLimit] call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { remaining: opts.max, limit: opts.max };
  }
}
