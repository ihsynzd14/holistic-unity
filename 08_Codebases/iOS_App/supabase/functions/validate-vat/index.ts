import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
/**
 * Validate an EU VAT number via the European Commission VIES REST API.
 * Returns { valid, name, address } on success.
 *
 * Note: UK VAT numbers (post-Brexit) cannot be validated via VIES.
 * For UK, we accept the format GB + 9 or 12 digits without live validation.
 */ async function validateViesVat(countryCode, vatNumber) {
  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      countryCode: countryCode.toUpperCase(),
      vatNumber: vatNumber
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VIES API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  return {
    valid: data.valid === true,
    name: data.name || undefined,
    address: data.address || undefined
  };
}
/**
 * Basic format check for UK VAT numbers: GB + 9 digits or GB + 12 digits.
 * No live validation available post-Brexit (HMRC API requires registration).
 */ function validateUkVatFormat(vatNumber) {
  const cleaned = vatNumber.replace(/\s+/g, "").toUpperCase();
  // Strip leading "GB" if present
  const digits = cleaned.startsWith("GB") ? cleaned.slice(2) : cleaned;
  return /^\d{9}$/.test(digits) || /^\d{12}$/.test(digits);
}
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  try {
    // Verify auth
    const userToken = req.headers.get("x-user-token");
    const authHeader = req.headers.get("Authorization");
    const jwt = userToken || (authHeader ? authHeader.replace("Bearer ", "") : null);
    if (!jwt) {
      return new Response(JSON.stringify({
        error: "Missing authorization"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized",
        detail: authError?.message
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Role gate — ONLY therapists can write to therapist_profiles.vat_number.
    // Without this check, any authenticated user (even a `client`) could
    // call this endpoint. Today there's no client row in `therapist_profiles`
    // so the UPDATE would be a no-op, but a future dual-role user (someone
    // who is both client AND therapist on the same account) could end up
    // overwriting their own therapist VAT without going through the
    // registration flow, AND a schema change that auto-creates therapist
    // rows for all signups would silently turn this into a write-anywhere
    // endpoint. Verify the caller actually owns a therapist profile.
    const { data: profile, error: profileErr } = await supabaseAdmin.from("therapist_profiles").select("id").eq("id", user.id).maybeSingle();
    if (profileErr) {
      console.error("validate-vat profile lookup failed:", profileErr);
      return new Response(JSON.stringify({
        error: "Profile lookup failed"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!profile) {
      // Same shape as Unauthorized to avoid leaking the role taxonomy
      // to the caller (defense in depth — they already know they're
      // authenticated, they don't need to know WHY they're rejected).
      return new Response(JSON.stringify({
        error: "Forbidden"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Rate limit: max 10 validation requests per user per minute.
    // `isRateLimited` is async in the current _shared/rate-limit.ts
    // (Postgres-backed global limiter); must be awaited or the returned
    // Promise is always truthy → every request would 429.
    if (await isRateLimited(`vat:${user.id}`, 10, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }
    const { vat_number } = await req.json();
    if (!vat_number || typeof vat_number !== "string") {
      return new Response(JSON.stringify({
        error: "vat_number is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Clean the input: remove spaces, uppercase
    const cleaned = vat_number.replace(/\s+/g, "").toUpperCase();
    if (cleaned.length < 4) {
      return new Response(JSON.stringify({
        error: "VAT number is too short"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Extract country prefix (first 2 chars must be letters)
    const countryPrefix = cleaned.slice(0, 2);
    if (!/^[A-Z]{2}$/.test(countryPrefix)) {
      return new Response(JSON.stringify({
        error: "VAT number must start with a 2-letter country code (e.g. DE123456789)"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const numberPart = cleaned.slice(2);
    // UK: format check only (no VIES access post-Brexit)
    if (countryPrefix === "GB") {
      const formatValid = validateUkVatFormat(cleaned);
      if (formatValid) {
        // Save to therapist profile
        await supabaseAdmin.from("therapist_profiles").update({
          vat_number: cleaned,
          vat_validated_at: new Date().toISOString()
        }).eq("id", user.id);
      }
      return new Response(JSON.stringify({
        valid: formatValid,
        vat_number: cleaned,
        method: "format_check",
        note: formatValid ? "UK VAT number format is valid. Live validation via HMRC is not available." : "Invalid UK VAT number format. Expected: GB + 9 or 12 digits."
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // EU: validate via VIES
    try {
      const result = await validateViesVat(countryPrefix, numberPart);
      if (result.valid) {
        // Save validated VAT number to therapist profile
        await supabaseAdmin.from("therapist_profiles").update({
          vat_number: cleaned,
          vat_validated_at: new Date().toISOString()
        }).eq("id", user.id);
      }
      return new Response(JSON.stringify({
        valid: result.valid,
        vat_number: cleaned,
        name: result.name,
        address: result.address,
        method: "vies"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } catch (viesErr) {
      console.error("VIES validation error:", viesErr);
      return new Response(JSON.stringify({
        error: "VAT validation service temporarily unavailable. Please try again later.",
        detail: viesErr instanceof Error ? viesErr.message : "Unknown error"
      }), {
        status: 503,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  } catch (err) {
    console.error("validate-vat error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
