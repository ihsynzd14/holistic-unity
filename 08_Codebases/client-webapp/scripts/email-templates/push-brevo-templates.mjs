#!/usr/bin/env node
/**
 * Brand all active Brevo transactional templates with the Holistic
 * Unity visual language. Same wrapper/footer style as the Supabase
 * Auth emails (see push-email-templates.mjs).
 *
 * Usage:
 *   BREVO_API_KEY=xkeysib-... node scripts/email-templates/push-brevo-templates.mjs
 *
 * Idempotent — re-running just overwrites the templates with fresh
 * HTML. Doesn't touch the subject (keeps Brevo's existing one) unless
 * an override is set in the per-template config.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERED_DIR = resolve(__dirname, "rendered-brevo");

const BREVO_API_KEY = process.env.BREVO_API_KEY;
if (!BREVO_API_KEY) {
  console.error("BREVO_API_KEY not set. Aborting.");
  process.exit(1);
}

// ─── Brand constants ─────────────────────────────────────────────
const BRAND = {
  berry: "#8B2252",
  berryDark: "#6B1A40",
  gold: "#C9A96E",
  cream: "#FDF6F0",
  pink: "#F0DFE5",
  charcoal: "#2D2D2D",
  muted: "#7B7B7B",
  success: "#33B85C",
  successLight: "#E8F7EC",
  warningLight: "#FFF4E5",
  warningDark: "#B8651F",
  errorLight: "#FDEBEC",
  errorDark: "#B23A3A",
  logoUrl: "https://holisticunity.app/images/logo.png",
};

const COMPANY = {
  name: "STORM X DIGITAL S.R.L.",
  address: "Strada Del Carro 24 — 76011 Bisceglie (BA)",
  vat: "P.IVA / C.F. 08789080721",
  domain: "holisticunity.app",
  supportEmail: "support@holisticunity.app",
};

// ─── Wrapper ─────────────────────────────────────────────────────
function wrap({ preheader, heroLabel, body }) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.charcoal};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(139,34,82,0.10);">

          <tr>
            <td align="center" style="background:linear-gradient(135deg,${BRAND.berry} 0%,${BRAND.gold} 100%);background-color:${BRAND.berry};padding:40px 24px 32px 24px;">
              <!--[if mso]>
              <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td>
              <![endif]-->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background:#FFFFFF;border-radius:20px;padding:14px;line-height:0;">
                    <img src="${BRAND.logoUrl}" alt="Holistic Unity" width="64" height="64" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none;border-radius:12px;">
                  </td>
                </tr>
              </table>
              <!--[if mso]>
              </td></tr></table>
              <![endif]-->
              <h1 style="margin:20px 0 0 0;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;font-size:26px;font-weight:700;color:#FFFFFF;letter-spacing:0.4px;">Holistic Unity</h1>
              ${heroLabel ? `<p style="margin:6px 0 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(heroLabel)}</p>` : ""}
            </td>
          </tr>

          <tr>
            <td style="padding:36px 32px 28px 32px;font-size:15px;line-height:1.65;color:${BRAND.charcoal};">
              ${body}
            </td>
          </tr>

          <tr>
            <td style="padding:22px 32px 28px 32px;border-top:1px solid ${BRAND.pink};background:${BRAND.cream};font-size:12px;line-height:1.65;color:${BRAND.muted};text-align:center;">
              <p style="margin:0 0 6px 0;font-weight:600;color:${BRAND.charcoal};letter-spacing:0.3px;">${COMPANY.name}</p>
              <p style="margin:0 0 4px 0;">${COMPANY.address}</p>
              <p style="margin:0 0 14px 0;">${COMPANY.vat}</p>
              <p style="margin:0 0 6px 0;">
                <a href="https://${COMPANY.domain}" style="color:${BRAND.berry};text-decoration:none;">${COMPANY.domain}</a>
                &nbsp;·&nbsp;
                <a href="mailto:${COMPANY.supportEmail}" style="color:${BRAND.berry};text-decoration:none;">${COMPANY.supportEmail}</a>
              </p>
              <p style="margin:0;font-size:11px;color:${BRAND.muted};">
                Hai ricevuto questa email perché è collegata al tuo account Holistic Unity.
                Se non l'hai richiesta tu, puoi ignorarla in tutta sicurezza.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Bulletproof button (Outlook-friendly via VML).
function ctaButton({ url, label, color = BRAND.berry }) {
  return `
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="${color}">
  <w:anchorlock/>
  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;">${escapeHtml(label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${url}" target="_blank" style="display:inline-block;padding:15px 36px;background:${color};color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;border-radius:999px;letter-spacing:0.3px;mso-hide:all;">${escapeHtml(label)}</a>
<!--<![endif]-->`;
}

// Smaller secondary button (used for calendar links row).
function pillButton({ url, label }) {
  return `<a href="${url}" target="_blank" style="display:inline-block;margin:4px 4px 0 0;padding:9px 16px;background:#FFFFFF;border:1px solid ${BRAND.berry}30;color:${BRAND.berry};font-size:12px;font-weight:600;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>`;
}

// Highlight box for booking details (date/time/total etc.)
function detailsCard(rows) {
  const html = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:${BRAND.muted};font-size:13px;font-weight:500;width:120px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:${BRAND.charcoal};font-size:14px;font-weight:600;">${value}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.cream};border-radius:14px;padding:18px 20px;margin:20px 0;border:1px solid ${BRAND.pink};">${html}</table>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Per-template bodies ─────────────────────────────────────────
// Each function receives no args — Brevo merges {{ params.X }} at
// send time. We only need to compose the structure; the merge tags
// stay literal in the HTML.

function bodyWelcomeClient() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Benvenuto/a, {{ params.name }}!</h2>
<p style="margin:0 0 16px 0;">Siamo felici di averti su Holistic Unity. La tua avventura nel benessere olistico inizia qui.</p>
<p style="margin:0 0 24px 0;">Esplora i nostri terapisti certificati, prenota una sessione gratuita di prima conoscenza e trova la pratica giusta per te.</p>
<div style="text-align:center;margin:0 0 8px 0;">
  ${ctaButton({ url: "https://app.holisticunity.app/dashboard/therapists", label: "Trova un terapista" })}
</div>`;
}

function bodyWelcomeTherapist() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Benvenuto/a, {{ params.name }}</h2>
<p style="margin:0 0 16px 0;">Grazie per esserti registrato/a come terapista su Holistic Unity. Stiamo esaminando il tuo profilo e ti daremo conferma a breve.</p>
<p style="margin:0 0 24px 0;">Nel frattempo, entra nel portale per completare il tuo profilo e configurare i tuoi servizi:</p>
<div style="text-align:center;margin:0 0 8px 0;">
  ${ctaButton({ url: "https://therapistportal.holisticunity.app/dashboard", label: "Vai al portale terapisti" })}
</div>`;
}

function bodyBookingConfirmedClient() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Prenotazione confermata!</h2>
<p style="margin:0 0 8px 0;">La tua sessione con <strong>{{ params.therapist_name }}</strong> è stata confermata.</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Data", "{{ params.session_date }}"],
  ["Ora", "{{ params.session_time }}"],
  ["Totale", "{{ params.amount }}"],
])}

<div style="text-align:center;margin:24px 0 8px 0;">
  ${ctaButton({ url: "{{ params.call_url }}", label: "Apri stanza video", color: BRAND.berry })}
</div>
<p style="margin:18px 0 8px 0;font-size:12px;color:${BRAND.muted};text-align:center;">La stanza si apre 15 minuti prima dell'orario e resta attiva per 3 ore.</p>

<div style="border-top:1px solid ${BRAND.pink};margin-top:24px;padding-top:18px;">
  <p style="margin:0 0 10px 0;font-size:13px;font-weight:600;color:${BRAND.charcoal};">Aggiungi al calendario</p>
  ${pillButton({ url: "{{ params.google_cal_url }}", label: "Google Calendar" })}
  ${pillButton({ url: "{{ params.outlook_cal_url }}", label: "Outlook" })}
  ${pillButton({ url: "{{ params.ics_url }}", label: "Apple / .ics" })}
</div>

<p style="margin:24px 0 0 0;font-size:12px;color:${BRAND.muted};">Riceverai un promemoria 24 ore prima della sessione.</p>`;
}

function bodyBookingConfirmedTherapist() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Nuova prenotazione</h2>
<p style="margin:0 0 8px 0;">Hai una nuova sessione confermata con <strong>{{ params.client_name }}</strong>.</p>

${detailsCard([
  ["Cliente", "{{ params.client_name }}"],
  ["Servizio", "{{ params.service_name }}"],
  ["Data", "{{ params.session_date }}"],
  ["Ora", "{{ params.session_time }}"],
  ["Importo", "{{ params.amount }}"],
])}

<div style="text-align:center;margin:24px 0 8px 0;">
  ${ctaButton({ url: "https://therapistportal.holisticunity.app/dashboard/sessions", label: "Apri sessione" })}
</div>

<div style="border-top:1px solid ${BRAND.pink};margin-top:24px;padding-top:18px;">
  <p style="margin:0 0 10px 0;font-size:13px;font-weight:600;color:${BRAND.charcoal};">Aggiungi al calendario</p>
  ${pillButton({ url: "{{ params.google_cal_url }}", label: "Google Calendar" })}
  ${pillButton({ url: "{{ params.outlook_cal_url }}", label: "Outlook" })}
  ${pillButton({ url: "{{ params.ics_url }}", label: "Apple / .ics" })}
</div>

<p style="margin:24px 0 0 0;font-size:12px;color:${BRAND.muted};">La stanza video si apre 15 minuti prima dell'orario e resta attiva per 3 ore.</p>`;
}

function bodySessionReminder24h() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">La tua sessione è domani</h2>
<p style="margin:0 0 8px 0;">Ciao {{ params.name }}, ti ricordiamo la tua sessione su Holistic Unity in programma per domani.</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Data", "{{ params.session_date }}"],
  ["Ora", "{{ params.session_time }}"],
])}

<div style="text-align:center;margin:24px 0 8px 0;">
  ${ctaButton({ url: "https://app.holisticunity.app/dashboard/bookings", label: "Vedi prenotazione" })}
</div>
<p style="margin:18px 0 0 0;font-size:12px;color:${BRAND.muted};text-align:center;">La stanza video si apre 15 minuti prima dell'orario.</p>`;
}

function bodySessionReminder1h() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Manca 1 ora alla tua sessione</h2>
<p style="margin:0 0 8px 0;">Ciao {{ params.name }}, la tua sessione su Holistic Unity sta per iniziare. Preparati e accedi qualche minuto prima.</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Ora", "{{ params.session_time }}"],
])}

<div style="text-align:center;margin:24px 0 8px 0;">
  ${ctaButton({ url: "https://app.holisticunity.app/dashboard/bookings/{{ params.booking_id }}/join", label: "Entra nella sessione" })}
</div>
<p style="margin:18px 0 0 0;font-size:12px;color:${BRAND.muted};text-align:center;">La stanza video si apre 15 minuti prima. Se hai problemi tecnici, contatta il supporto: support@holisticunity.app</p>`;
}

function bodyPaymentReceipt() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Ricevuta di pagamento</h2>
<p style="margin:0 0 8px 0;">Grazie per il tuo pagamento. Ecco i dettagli:</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Importo", "{{ params.amount }}"],
  ["Data pagamento", "{{ params.payment_date }}"],
  ["ID transazione", "{{ params.transaction_id }}"],
])}

<p style="margin:18px 0 8px 0;">Conserva questa email come ricevuta. La fattura ufficiale (se richiesta) sarà disponibile nel tuo profilo.</p>
<div style="text-align:center;margin:20px 0 8px 0;">
  ${ctaButton({ url: "https://app.holisticunity.app/dashboard/bookings", label: "Vedi prenotazioni" })}
</div>`;
}

function bodyTherapistApproved() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Profilo approvato!</h2>
<p style="margin:0 0 16px 0;">Ciao {{ params.name }}, ottime notizie: il tuo profilo è stato approvato e da ora sei visibile ai clienti su Holistic Unity.</p>
<p style="margin:0 0 24px 0;">Per iniziare a ricevere prenotazioni:</p>
<ul style="margin:0 0 24px 0;padding-left:20px;color:${BRAND.charcoal};">
  <li style="margin-bottom:8px;">Completa la configurazione Stripe (necessaria per ricevere pagamenti)</li>
  <li style="margin-bottom:8px;">Verifica i tuoi servizi e prezzi</li>
  <li style="margin-bottom:8px;">Imposta la tua disponibilità settimanale</li>
</ul>
<div style="text-align:center;margin:0 0 8px 0;">
  ${ctaButton({ url: "https://therapistportal.holisticunity.app/dashboard", label: "Apri il portale" })}
</div>`;
}

function bodyTherapistChangesRequested() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Aggiornamento profilo richiesto</h2>
<p style="margin:0 0 16px 0;">Ciao {{ params.name }}, abbiamo bisogno di alcune modifiche al tuo profilo prima di poterlo approvare.</p>

${detailsCard([
  ["Note del team", "{{ params.changes_summary }}"],
])}

<p style="margin:18px 0 24px 0;">Apri il portale per aggiornare le informazioni richieste — ti revisioneremo nuovamente entro 24 ore lavorative.</p>
<div style="text-align:center;margin:0 0 8px 0;">
  ${ctaButton({ url: "https://therapistportal.holisticunity.app/dashboard/profile", label: "Aggiorna il profilo" })}
</div>`;
}

function bodyCancellationConfirmation() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Prenotazione annullata</h2>
<p style="margin:0 0 16px 0;">La tua sessione è stata annullata correttamente.</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Era prevista", "{{ params.session_date }} alle {{ params.session_time }}"],
  ["Rimborso", "{{ params.refund_amount }}"],
])}

<p style="margin:18px 0 16px 0;font-size:13px;color:${BRAND.muted};">Il rimborso (quando applicabile) sarà accreditato sul metodo di pagamento originale entro 5-10 giorni lavorativi, secondo la policy del tuo emittente.</p>
<div style="text-align:center;margin:20px 0 8px 0;">
  ${ctaButton({ url: "https://app.holisticunity.app/dashboard/therapists", label: "Trova un'altra sessione" })}
</div>`;
}

function bodyRefundConfirmation() {
  return `
<h2 style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:22px;color:${BRAND.charcoal};">Rimborso confermato</h2>
<p style="margin:0 0 16px 0;">Abbiamo elaborato il tuo rimborso parziale.</p>

${detailsCard([
  ["Servizio", "{{ params.service_name }}"],
  ["Importo rimborsato", "{{ params.refund_amount }}"],
  ["Data", "{{ params.refund_date }}"],
])}

<p style="margin:18px 0 0 0;font-size:13px;color:${BRAND.muted};">Il rimborso sarà accreditato sul metodo di pagamento originale entro 5-10 giorni lavorativi.</p>`;
}

// ─── Templates to update ─────────────────────────────────────────
const TEMPLATES = [
  { id: 1, preheader: "Benvenuto/a in Holistic Unity", heroLabel: "Benvenuto/a", body: bodyWelcomeClient },
  { id: 2, preheader: "Benvenuto/a sul portale terapisti", heroLabel: "Portale terapisti", body: bodyWelcomeTherapist },
  { id: 3, preheader: "La tua sessione è confermata", heroLabel: "Prenotazione confermata", body: bodyBookingConfirmedClient },
  { id: 4, preheader: "Hai una nuova prenotazione", heroLabel: "Nuova prenotazione", body: bodyBookingConfirmedTherapist },
  { id: 5, preheader: "La tua sessione è domani", heroLabel: "Promemoria sessione", body: bodySessionReminder24h },
  { id: 6, preheader: "Ricevuta di pagamento Holistic Unity", heroLabel: "Ricevuta pagamento", body: bodyPaymentReceipt },
  { id: 7, preheader: "Il tuo profilo terapista è approvato", heroLabel: "Profilo approvato", body: bodyTherapistApproved },
  { id: 8, preheader: "Modifiche richieste al tuo profilo", heroLabel: "Aggiornamento richiesto", body: bodyTherapistChangesRequested },
  { id: 9, preheader: "Prenotazione annullata", heroLabel: "Prenotazione annullata", body: bodyCancellationConfirmation },
  { id: 10, preheader: "Rimborso elaborato", heroLabel: "Rimborso confermato", body: bodyRefundConfirmation },
  { id: 11, preheader: "La tua sessione sta per iniziare", heroLabel: "1 ora alla sessione", body: bodySessionReminder1h },
];

// ─── Push ────────────────────────────────────────────────────────
mkdirSync(RENDERED_DIR, { recursive: true });

let success = 0;
let failed = 0;

for (const t of TEMPLATES) {
  const html = wrap({
    preheader: t.preheader,
    heroLabel: t.heroLabel,
    body: t.body(),
  });

  // Save locally for inspection / fallback paste
  writeFileSync(resolve(RENDERED_DIR, `template-${t.id}.html`), html, "utf8");

  // PUT to Brevo. We only update htmlContent — preserve subject,
  // sender, etc. that Brevo already has.
  const res = await fetch(`https://api.brevo.com/v3/smtp/templates/${t.id}`, {
    method: "PUT",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ htmlContent: html }),
  });

  if (res.ok || res.status === 204) {
    console.log(`  ✓ template ${t.id} updated`);
    success++;
  } else {
    const text = await res.text();
    console.error(`  ✗ template ${t.id} FAILED (${res.status}): ${text}`);
    failed++;
  }
}

console.log(
  `\nDone. ${success} updated, ${failed} failed. Local HTML in ${RENDERED_DIR}/`,
);
