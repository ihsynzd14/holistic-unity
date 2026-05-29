/**
 * send-session-reminders — Sends 24h-before reminders for upcoming sessions.
 *
 * Triggered by: pg_cron daily at 10:00 UTC
 * Sends both email (Brevo) and WhatsApp (if phone available) reminders.
 * Only sends for bookings with status = 'confirmed' scheduled tomorrow.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTransactionalEmail, sendWhatsAppMessage, BREVO_TEMPLATES } from "../_shared/brevo.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const whatsappNumber = Deno.env.get("BREVO_WHATSAPP_NUMBER") || "";
    // Find all bookings scheduled for tomorrow (24h window)
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const { data: bookings, error } = await supabase.from("bookings").select(`
        id, scheduled_at, service_name,
        client_id, therapist_id
      `).eq("status", "confirmed").gte("scheduled_at", tomorrow.toISOString()).lt("scheduled_at", dayAfter.toISOString());
    if (error) {
      console.error("Failed to fetch bookings:", error);
      return new Response(JSON.stringify({
        error: "Failed to fetch bookings"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let sent = 0;
    let failed = 0;
    for (const booking of bookings || []){
      try {
        // Fetch client and therapist info
        const [{ data: client }, { data: therapist }] = await Promise.all([
          supabase.from("users").select("email, display_name, phone_number").eq("id", booking.client_id).single(),
          supabase.from("users").select("email, display_name, phone_number").eq("id", booking.therapist_id).single()
        ]);
        // `scheduled_at` is TIMESTAMPTZ stored in UTC. Without an explicit
        // `timeZone` the Deno runtime renders the wall-clock in UTC, which
        // shifts every Italian session by 1–2h (e.g. 09:00 Rome → "07:00"
        // in the reminder email during DST). Force Europe/Rome.
        const TZ_ROME = "Europe/Rome";
        const sessionDate = new Date(booking.scheduled_at).toLocaleDateString("it-IT", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: TZ_ROME
        });
        const sessionTime = new Date(booking.scheduled_at).toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: TZ_ROME
        });
        const serviceName = booking.service_name || "Sessione";
        // Send reminder to client
        if (client?.email) {
          await sendTransactionalEmail({
            to: [
              {
                email: client.email,
                name: client.display_name || ""
              }
            ],
            templateId: BREVO_TEMPLATES.SESSION_REMINDER_24H,
            params: {
              name: (client.display_name || "").split(" ")[0] || "there",
              therapist_name: therapist?.display_name || "",
              service_name: serviceName,
              session_date: sessionDate,
              session_time: sessionTime,
              booking_id: booking.id
            },
            tags: [
              "session_reminder",
              "client"
            ]
          });
          sent++;
        }
        // Send reminder to therapist
        if (therapist?.email) {
          await sendTransactionalEmail({
            to: [
              {
                email: therapist.email,
                name: therapist.display_name || ""
              }
            ],
            templateId: BREVO_TEMPLATES.SESSION_REMINDER_24H,
            params: {
              name: (therapist.display_name || "").split(" ")[0] || "there",
              client_name: client?.display_name || "",
              service_name: serviceName,
              session_date: sessionDate,
              session_time: sessionTime,
              booking_id: booking.id
            },
            tags: [
              "session_reminder",
              "therapist"
            ]
          });
          sent++;
        }
        // WhatsApp reminder to client (if phone available)
        if (whatsappNumber && client?.phone_number) {
          try {
            await sendWhatsAppMessage({
              senderNumber: whatsappNumber,
              contactNumbers: [
                client.phone_number
              ],
              templateId: 1,
              params: [
                (client.display_name || "").split(" ")[0],
                therapist?.display_name || "",
                `${sessionDate} ${sessionTime}`
              ]
            });
          } catch (waErr) {
            console.warn("WhatsApp reminder failed:", waErr);
          }
        }
      } catch (bookingErr) {
        console.error(`Reminder failed for booking ${booking.id}:`, bookingErr);
        failed++;
      }
      // Rate limit: 100ms between sends
      await new Promise((r)=>setTimeout(r, 100));
    }
    return new Response(JSON.stringify({
      total_bookings: bookings?.length || 0,
      reminders_sent: sent,
      failed
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("send-session-reminders error:", err);
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
