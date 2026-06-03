/**
 * Brevo (ex-Sendinblue) API client for Supabase Edge Functions.
 * Handles contact management, transactional emails, and WhatsApp messages.
 *
 * Environment variables required:
 *   BREVO_API_KEY - Brevo API v3 key
 */ const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const BREVO_BASE_URL = "https://api.brevo.com/v3";
// Sender identity — matches the verified sender in Brevo
const DEFAULT_SENDER = {
  name: "Holistic Unity",
  email: "support@holisticunity.app"
};
// ─── Brevo Contact Lists ─────────────────────────────────────────────────────
// These IDs must match the lists created in the Brevo dashboard.
// Create them first in Brevo > Contacts > Lists, then paste IDs here.
export const BREVO_LISTS = {
  ALL_USERS: 4,
  CLIENTS: 5,
  THERAPISTS: 6,
  MARKETING_OPTED_IN: 7,
  CLIENTS_ACTIVE: 8,
  CLIENTS_DORMANT: 9,
  THERAPISTS_APPROVED: 10,
  THERAPISTS_PENDING: 11
};
// ─── Brevo Transactional Template IDs ────────────────────────────────────────
// Create these templates in Brevo > Transactional > Email Templates.
// Use double-handlebars {{params.name}} for dynamic content.
export const BREVO_TEMPLATES = {
  // Transactional (no consent needed)
  WELCOME_CLIENT: 1,
  WELCOME_THERAPIST: 2,
  BOOKING_CONFIRMED_CLIENT: 3,
  BOOKING_CONFIRMED_THERAPIST: 4,
  SESSION_REMINDER_24H: 5,
  PAYMENT_RECEIPT: 6,
  THERAPIST_APPROVED: 7,
  THERAPIST_CHANGES_REQUESTED: 8,
  CANCELLATION_CONFIRMATION: 9,
  REFUND_CONFIRMATION: 10,
  // Payouts (transactional) — fired by stripe-webhook on Stripe Connect
  // payout.paid / payout.failed events. T13/T14 go to the therapist,
  // ADMIN_PAYOUT_FAILED (A4) alerts the platform admin on any failure.
  PAYOUT_SENT: 12,
  PAYOUT_FAILED: 13,
  ADMIN_PAYOUT_FAILED: 14,
  // Admin alerts (A1/A2) — internal emails to the platform admin,
  // fired by the admin-dashboard /api/cron/admin-alerts cron.
  ADMIN_NEW_THERAPIST: 15,
  ADMIN_NEW_REPORT: 16,
  RESCHEDULE_PROPOSED: 26,
  RESCHEDULE_RESPONDED: 27,
  // Marketing (requires marketing_consent = true)
  FIRST_BOOKING_NUDGE: 20,
  POST_SESSION_FOLLOWUP: 21,
  REENGAGEMENT_CLIENT: 22,
  PROMO_VOUCHER: 23,
  THERAPIST_TIPS: 24,
  WEEKLY_EARNINGS_SUMMARY: 25
};
// ─── Core API Helper ─────────────────────────────────────────────────────────
async function brevoRequest(method, path, body) {
  if (!BREVO_API_KEY) {
    console.warn("BREVO_API_KEY not set — skipping Brevo API call");
    return {
      ok: false,
      status: 0,
      data: {
        error: "API key not configured"
      }
    };
  }
  const url = `${BREVO_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) {
    console.error(`Brevo ${method} ${path} failed:`, res.status, data);
  }
  return {
    ok: res.ok,
    status: res.status,
    data
  };
}
// ─── Contact Management ──────────────────────────────────────────────────────
/**
 * Create or update a contact in Brevo.
 * Uses `updateEnabled: true` to upsert (create if new, update if existing).
 */ export async function upsertContact(contact) {
  return brevoRequest("POST", "/contacts", {
    email: contact.email,
    attributes: contact.attributes || {},
    listIds: contact.listIds || [
      BREVO_LISTS.ALL_USERS
    ],
    updateEnabled: contact.updateEnabled ?? true
  });
}
/**
 * Remove a contact from specific lists (without deleting from Brevo).
 */ export async function removeFromLists(email, listIds) {
  for (const listId of listIds){
    await brevoRequest("POST", `/contacts/lists/${listId}/contacts/remove`, {
      emails: [
        email
      ]
    });
  }
}
/**
 * Add a contact to specific lists.
 */ export async function addToLists(email, listIds) {
  for (const listId of listIds){
    await brevoRequest("POST", `/contacts/lists/${listId}/contacts/add`, {
      emails: [
        email
      ]
    });
  }
}
// ─── Transactional Email ─────────────────────────────────────────────────────
/**
 * Send a transactional email using a Brevo template.
 * These do NOT require marketing consent (booking confirmations, receipts, etc.)
 */ export async function sendTransactionalEmail(params) {
  return brevoRequest("POST", "/smtp/email", {
    sender: DEFAULT_SENDER,
    to: params.to,
    templateId: params.templateId,
    params: params.params || {},
    ...params.subject && {
      subject: params.subject
    },
    ...params.tags && {
      tags: params.tags
    },
    ...params.replyTo && {
      replyTo: params.replyTo
    }
  });
}
/**
 * Send a raw HTML transactional email (no template).
 */ export async function sendRawEmail(to, subject, htmlContent, tags) {
  return brevoRequest("POST", "/smtp/email", {
    sender: DEFAULT_SENDER,
    to,
    subject,
    htmlContent,
    ...tags && {
      tags
    }
  });
}
// ─── WhatsApp ────────────────────────────────────────────────────────────────
/**
 * Send a WhatsApp message via Brevo WhatsApp Business API.
 * Requires: Brevo WhatsApp channel activated + Meta-approved templates.
 */ export async function sendWhatsAppMessage(params) {
  return brevoRequest("POST", "/whatsapp/sendMessage", {
    senderNumber: params.senderNumber,
    contactNumbers: params.contactNumbers,
    templateId: params.templateId,
    ...params.params && {
      bodyVariables: params.params
    }
  });
}
// ─── Automation Triggers ─────────────────────────────────────────────────────
/**
 * Track a custom event in Brevo (triggers automation workflows).
 * Use this to fire Brevo automations based on app events.
 *
 * Example events:
 *   "booking_completed", "session_ended", "therapist_approved",
 *   "first_booking", "account_dormant_14d"
 */ export async function trackEvent(email, eventName, eventData) {
  return brevoRequest("POST", "/events", {
    email,
    event: eventName,
    properties: eventData || {}
  });
}
