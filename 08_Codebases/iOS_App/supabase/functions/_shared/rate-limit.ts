/**
 * Rate limiter for Supabase Edge Functions.
 *
 * Backend: Postgres RPC `public.check_rate_limit(key, max, window_seconds)`.
 * All Deno Deploy instances share the same counter by going through the
 * database — so the rate limit is truly global, not per-instance.
 *
 * The RPC is a single-round-trip UPSERT (INSERT ... ON CONFLICT UPDATE
 * RETURNING) on a small, indexed table. Expected latency: 5–15 ms.
 *
 * Fallback: in-memory per-instance sliding window, used ONLY when the
 * Postgres call fails (network partition, DB briefly unreachable).
 * A soft-fail strategy — rate limiting degraded but never fully off.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[rate-limit] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — " +
      "Postgres rate limiting disabled, falling back to per-instance in-memory counter."
  );
}

// ── In-memory fallback ──────────────────────────────────────────────

interface RateLimitEntry {
  timestamps: number[];
}
const memoryStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, entry] of memoryStore) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) memoryStore.delete(key);
  }
}, 5 * 60 * 1000);

function memoryIsRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = memoryStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    memoryStore.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  if (entry.timestamps.length >= maxRequests) return true;
  entry.timestamps.push(now);
  return false;
}

// ── Postgres RPC (distributed) ──────────────────────────────────────

/**
 * Call check_rate_limit() on Postgres via PostgREST RPC endpoint.
 * Returns { count, limited } or null on failure.
 */
async function pgCheckRateLimit(
  key: string,
  max: number,
  windowSec: number,
  signal: AbortSignal
): Promise<{ count: number; limited: boolean } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        p_key: key,
        p_max: max,
        p_window_seconds: windowSec,
      }),
      signal,
    });

    if (!res.ok) {
      console.error(
        `[rate-limit] RPC non-OK: ${res.status} ${res.statusText}`
      );
      return null;
    }

    const data = await res.json();
    // RPC returns an array with one row { count, limited }.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.count === "undefined") return null;

    return {
      count: Number(row.count),
      limited: Boolean(row.limited),
    };
  } catch (err) {
    console.error(
      "[rate-limit] RPC call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export interface RateLimitResult {
  limited: boolean;
  count: number;
  limit: number;
  windowSec: number;
  remaining: number;
}

/**
 * Main entry point — returns full metadata (count, limit, remaining).
 *
 * @param key Unique identifier (user ID or IP)
 * @param maxRequests Max requests per window
 * @param windowSec Window size in seconds (default 60)
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSec: number = 60
): Promise<RateLimitResult> {
  // Primary: Postgres RPC. 800 ms timeout so a stalled DB never blocks an
  // auth request for long — the fallback kicks in quickly.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const row = await pgCheckRateLimit(
      key,
      maxRequests,
      windowSec,
      controller.signal
    );
    if (row !== null) {
      return {
        limited: row.limited,
        count: row.count,
        limit: maxRequests,
        windowSec,
        remaining: Math.max(0, maxRequests - row.count),
      };
    }
  } finally {
    clearTimeout(timeout);
  }

  // Fallback: per-instance in-memory.
  const limited = memoryIsRateLimited(key, maxRequests, windowSec * 1000);
  return {
    limited,
    count: limited ? maxRequests + 1 : maxRequests,
    limit: maxRequests,
    windowSec,
    remaining: limited ? 0 : 1,
  };
}

/**
 * Legacy boolean-only API, for backward compatibility with existing callers.
 * Now async: callers must `await isRateLimited(...)`.
 *
 * @param key Unique identifier
 * @param maxRequests Max requests per window
 * @param windowMs Window in MILLISECONDS (converted to seconds internally)
 */
export async function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number = 60_000
): Promise<boolean> {
  const result = await checkRateLimit(
    key,
    maxRequests,
    Math.ceil(windowMs / 1000)
  );
  return result.limited;
}

/**
 * Builds a 429 response with Retry-After + X-RateLimit-* headers.
 */
export function rateLimitResponse(
  corsHeaders: Record<string, string>,
  result?: RateLimitResult
): Response {
  const retryAfter = result?.windowSec ?? 60;
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result?.limit ?? ""),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(
          Math.floor(Date.now() / 1000) + retryAfter
        ),
      },
    }
  );
}
