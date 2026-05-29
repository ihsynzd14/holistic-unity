/**
 * sync-brevo-contact — Syncs user data to Brevo CRM.
 *
 * Called after:
 *   1. Client completes onboarding
 *   2. Therapist profile is approved
 *   3. User updates marketing consent in Settings
 *   4. Bulk sync via admin API
 *
 * Creates/updates the Brevo contact with all relevant attributes
 * and assigns them to the correct lists based on role + consent.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertContact, addToLists, removeFromLists, trackEvent, BREVO_LISTS } from "../_shared/brevo.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { user_id, event } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({
        error: "user_id required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Fetch user data
    const { data: user, error: userErr } = await supabase.from("users").select("id, email, display_name, role, city, country, marketing_consent, marketing_consent_date, created_at, preferred_languages, experience_level").eq("id", user_id).single();
    if (userErr || !user || !user.email) {
      return new Response(JSON.stringify({
        error: "User not found or missing email"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Build list assignments based on role + consent
    const listIds = [
      BREVO_LISTS.ALL_USERS
    ];
    if (user.role === "client") {
      listIds.push(BREVO_LISTS.CLIENTS);
    } else if (user.role === "therapist") {
      listIds.push(BREVO_LISTS.THERAPISTS);
      // Check therapist approval status
      const { data: profile } = await supabase.from("therapist_profiles").select("approval_status").eq("id", user_id).single();
      if (profile?.approval_status === "approved") {
        listIds.push(BREVO_LISTS.THERAPISTS_APPROVED);
      } else {
        listIds.push(BREVO_LISTS.THERAPISTS_PENDING);
      }
    }
    if (user.marketing_consent) {
      listIds.push(BREVO_LISTS.MARKETING_OPTED_IN);
    }
    // Brevo contact attributes (used in email templates and segmentation)
    const attributes = {
      FIRSTNAME: (user.display_name || "").split(" ")[0] || "",
      LASTNAME: (user.display_name || "").split(" ").slice(1).join(" ") || "",
      FULL_NAME: user.display_name || "",
      ROLE: user.role || "unknown",
      CITY: user.city || "",
      COUNTRY: user.country || "",
      MARKETING_CONSENT: user.marketing_consent || false,
      SIGNUP_DATE: user.created_at || "",
      LANGUAGE: (user.preferred_languages || [
        "en"
      ])[0] || "en",
      EXPERIENCE_LEVEL: user.experience_level || "",
      APP_USER_ID: user.id
    };
    // If therapist, add extra attributes
    if (user.role === "therapist") {
      const { data: tp } = await supabase.from("therapist_profiles").select("categories, years_experience, rating, total_reviews, currency").eq("id", user_id).single();
      if (tp) {
        attributes.THERAPIST_CATEGORIES = (tp.categories || []).join(", ");
        attributes.YEARS_EXPERIENCE = tp.years_experience || 0;
        attributes.RATING = tp.rating || 0;
        attributes.TOTAL_REVIEWS = tp.total_reviews || 0;
        attributes.CURRENCY = tp.currency || "eur";
      }
    }
    // Upsert contact in Brevo
    const result = await upsertContact({
      email: user.email,
      attributes,
      listIds,
      updateEnabled: true
    });
    // Handle marketing consent list toggle
    if (user.marketing_consent) {
      await addToLists(user.email, [
        BREVO_LISTS.MARKETING_OPTED_IN
      ]);
    } else {
      await removeFromLists(user.email, [
        BREVO_LISTS.MARKETING_OPTED_IN
      ]);
    }
    // Track event in Brevo (triggers automation workflows)
    if (event) {
      await trackEvent(user.email, event, {
        user_id: user.id,
        role: user.role,
        timestamp: new Date().toISOString()
      });
    }
    return new Response(JSON.stringify({
      success: true,
      brevo: result.ok
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("sync-brevo-contact error:", err);
    return new Response(JSON.stringify({
      error: err.message || "Internal error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
