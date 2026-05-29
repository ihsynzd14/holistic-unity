/**
 * send-brevo-email — Sends transactional or marketing emails via Brevo.
 *
 * Called by:
 *   - stripe-webhook (booking confirmed, payment receipt, refund)
 *   - admin dashboard (therapist approved/rejected)
 *   - scheduled cron jobs (session reminders, re-engagement)
 *   - pg_net triggers (database event → email)
 *
 * Transactional emails (booking confirmations, receipts) do NOT require
 * marketing consent and are always sent.
 *
 * Marketing emails (promos, vouchers, re-engagement) are ONLY sent
 * to users with marketing_consent = true (GDPR compliance).
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTransactionalEmail, sendWhatsAppMessage, trackEvent, BREVO_TEMPLATES } from "../_shared/brevo.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
// Email types that require marketing consent
const MARKETING_TEMPLATES = new Set([
  BREVO_TEMPLATES.FIRST_BOOKING_NUDGE,
  BREVO_TEMPLATES.POST_SESSION_FOLLOWUP,
  BREVO_TEMPLATES.REENGAGEMENT_CLIENT,
  BREVO_TEMPLATES.PROMO_VOUCHER,
  BREVO_TEMPLATES.THERAPIST_TIPS,
  BREVO_TEMPLATES.WEEKLY_EARNINGS_SUMMARY
]);
function timingSafeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for(let i = 0; i < a.length; i++){
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Internal auth: this function sends transactional emails on behalf
    // of the platform. Without auth, anyone could trigger any template
    // for any user_id with arbitrary params (impersonation + spam +
    // Brevo quota exhaustion). Service-role key OR CRON_SECRET only.
    const authHeader = req.headers.get("Authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const ok = provided.length > 0 && timingSafeEqualString(provided, supabaseServiceKey) || cronSecret.length > 0 && timingSafeEqualString(provided, cronSecret);
    if (!ok) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { template_id, user_id, email, params, tags, whatsapp } = await req.json();
    if (!template_id) {
      return new Response(JSON.stringify({
        error: "template_id required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Resolve recipient email and consent
    let recipientEmail = email;
    let recipientName = params?.name || "";
    let hasMarketingConsent = false;
    if (user_id) {
      const { data: user } = await supabase.from("users").select("email, display_name, marketing_consent, phone_number").eq("id", user_id).single();
      if (!user?.email) {
        return new Response(JSON.stringify({
          error: "User not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      recipientEmail = user.email;
      recipientName = recipientName || user.display_name || "";
      hasMarketingConsent = user.marketing_consent || false;
      // WhatsApp: send if requested and phone number available
      if (whatsapp && user.phone_number) {
        try {
          await sendWhatsAppMessage({
            senderNumber: Deno.env.get("BREVO_WHATSAPP_NUMBER") || "",
            contactNumbers: [
              user.phone_number
            ],
            templateId: whatsapp.template_id,
            params: whatsapp.params
          });
        } catch (waErr) {
          console.warn("WhatsApp send failed (non-blocking):", waErr);
        }
      }
    }
    if (!recipientEmail) {
      return new Response(JSON.stringify({
        error: "No recipient email"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // GDPR check: block marketing emails if user hasn't consented
    if (MARKETING_TEMPLATES.has(template_id) && !hasMarketingConsent) {
      console.log(`Skipping marketing email (template ${template_id}) — user ${recipientEmail} has not given marketing consent.`);
      return new Response(JSON.stringify({
        success: false,
        reason: "marketing_consent_required"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Send the email
    const result = await sendTransactionalEmail({
      to: [
        {
          email: recipientEmail,
          name: recipientName
        }
      ],
      templateId: template_id,
      params: {
        name: recipientName.split(" ")[0] || "there",
        full_name: recipientName,
        ...params
      },
      tags: tags || []
    });
    // Track event for Brevo analytics
    if (result.ok) {
      await trackEvent(recipientEmail, `email_sent_${template_id}`, {
        template_id,
        tags
      });
    }
    return new Response(JSON.stringify({
      success: result.ok,
      status: result.status
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("send-brevo-email error:", err);
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
