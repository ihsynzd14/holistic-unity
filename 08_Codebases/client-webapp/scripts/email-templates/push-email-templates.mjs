#!/usr/bin/env node
/**
 * Push Holistic Unity branded auth email templates to Supabase.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/email-templates/push-email-templates.mjs
 *
 * Requires:
 *   - SUPABASE_ACCESS_TOKEN env var (Personal Access Token, sbp_*).
 *     Generate at https://supabase.com/dashboard/account/tokens
 *
 * What it does:
 *   - Renders 4 templates (confirmation, recovery, magic_link, email_change)
 *     into a shared brand wrapper with table-centered logo + Storm X Digital
 *     legal footer
 *   - Writes each rendered HTML to ./rendered/*.html (for manual fallback if
 *     the API call fails — paste them into Supabase Dashboard → Auth →
 *     Email Templates)
 *   - PATCHes the Supabase Auth config so the live mailer uses them
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERED_DIR = resolve(__dirname, "rendered");

const PROJECT_REF = "bqyqkvkzkemiwyqjkbna";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

// --- Brand constants -------------------------------------------------------
// Keep in sync with HOLISTIC_UNITY_KNOWLEDGE_BASE.md §9 Brand Guidelines.
const BRAND = {
  berry: "#8B2252",
  gold: "#C9A96E",
  cream: "#FDF6F0",
  pink: "#F0DFE5",
  charcoal: "#2D2D2D",
  muted: "#7B7B7B",
  logoUrl: "https://holisticunity.app/images/logo.png",
};

const COMPANY = {
  name: "STORM X DIGITAL S.R.L.",
  address: "Strada Del Carro 24 — 76011 Bisceglie (BA)",
  vat: "P.IVA / C.F. 08789080721",
  domain: "holisticunity.app",
  supportEmail: "support@holisticunity.app",
};

// --- Wrapper ---------------------------------------------------------------
// 100% table-based for max email-client compatibility (Outlook, Gmail mobile,
// Apple Mail). The logo is centered via a nested <table align="center"> with
// margin:0 auto — the only trick that survives Outlook's box model.
function wrap({ title, preheader, body }) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.charcoal};-webkit-text-size-adjust:100%;">
  <!-- preheader (hidden, shown as preview text in inbox) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(139,34,82,0.10);">

          <!-- Hero -->
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
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px 32px;font-size:15px;line-height:1.65;color:${BRAND.charcoal};">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
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

function ctaButton({ url, label }) {
  // Bulletproof button (works in Outlook via VML).
  return `
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="${BRAND.berry}">
  <w:anchorlock/>
  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;">${escapeHtml(label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${url}" target="_blank" style="display:inline-block;padding:15px 36px;background:${BRAND.berry};color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;border-radius:999px;letter-spacing:0.3px;mso-hide:all;">${escapeHtml(label)}</a>
<!--<![endif]-->`;
}

function fallbackLink(url) {
  return `
<p style="margin:24px 0 4px 0;font-size:13px;color:${BRAND.muted};">Se il pulsante non funziona, copia e incolla questo link nel tuo browser:</p>
<p style="margin:0;font-size:12px;color:${BRAND.berry};word-break:break-all;"><a href="${url}" style="color:${BRAND.berry};text-decoration:underline;">${url}</a></p>`;
}

// --- Bodies ----------------------------------------------------------------
// Supabase substitutes {{ .ConfirmationURL }}, {{ .Email }}, {{ .NewEmail }}
// at send time. Anything else stays literal.

function bodyConfirmation() {
  const url = "{{ .ConfirmationURL }}";
  return `
<h2 style="margin:0 0 16px 0;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${BRAND.charcoal};">Benvenuto/a in Holistic Unity</h2>
<p style="margin:0 0 16px 0;">Manca un solo passaggio: conferma il tuo indirizzo email per attivare l'account e iniziare a scoprire terapisti e pratiche olistiche selezionate per te.</p>
<p style="margin:0 0 28px 0;">Tocca il pulsante qui sotto — il link è valido per 24 ore.</p>
<div style="text-align:center;margin:8px 0 0 0;">
  ${ctaButton({ url, label: "Conferma il mio indirizzo" })}
</div>
${fallbackLink(url)}`;
}

function bodyRecovery() {
  const url = "{{ .ConfirmationURL }}";
  return `
<h2 style="margin:0 0 16px 0;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${BRAND.charcoal};">Reimposta la tua password</h2>
<p style="margin:0 0 16px 0;">Hai chiesto di reimpostare la password del tuo account Holistic Unity. Tocca il pulsante qui sotto per scegliere una nuova password.</p>
<p style="margin:0 0 28px 0;">Per la tua sicurezza il link è valido per 1 ora. Se non sei stato/a tu a richiedere il reset, ignora questa email — la tua password attuale resta valida.</p>
<div style="text-align:center;margin:8px 0 0 0;">
  ${ctaButton({ url, label: "Scegli nuova password" })}
</div>
${fallbackLink(url)}`;
}

function bodyMagicLink() {
  const url = "{{ .ConfirmationURL }}";
  return `
<h2 style="margin:0 0 16px 0;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${BRAND.charcoal};">Accedi a Holistic Unity</h2>
<p style="margin:0 0 16px 0;">Tocca il pulsante qui sotto per accedere al tuo account senza inserire la password.</p>
<p style="margin:0 0 28px 0;">Il link è valido per un solo accesso e scade dopo 1 ora. Se non sei stato/a tu a richiederlo, puoi ignorare questa email.</p>
<div style="text-align:center;margin:8px 0 0 0;">
  ${ctaButton({ url, label: "Accedi al mio account" })}
</div>
${fallbackLink(url)}`;
}

function bodyEmailChange() {
  const url = "{{ .ConfirmationURL }}";
  return `
<h2 style="margin:0 0 16px 0;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${BRAND.charcoal};">Conferma il nuovo indirizzo email</h2>
<p style="margin:0 0 16px 0;">Hai richiesto di cambiare l'indirizzo email del tuo account Holistic Unity da <strong>{{ .Email }}</strong> a <strong>{{ .NewEmail }}</strong>.</p>
<p style="margin:0 0 28px 0;">Conferma cliccando il pulsante qui sotto. Se non sei stato/a tu, ignora questa email — l'indirizzo attuale resta attivo.</p>
<div style="text-align:center;margin:8px 0 0 0;">
  ${ctaButton({ url, label: "Conferma il nuovo indirizzo" })}
</div>
${fallbackLink(url)}`;
}

// --- Helpers ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Templates -------------------------------------------------------------
const TEMPLATES = [
  {
    key: "confirmation",
    subject: "Conferma il tuo indirizzo · Holistic Unity",
    title: "Conferma il tuo indirizzo email",
    preheader: "Conferma il tuo indirizzo per attivare l'account Holistic Unity.",
    body: bodyConfirmation,
  },
  {
    key: "recovery",
    subject: "Reimposta la tua password · Holistic Unity",
    title: "Reimposta la tua password",
    preheader: "Tocca il pulsante per scegliere una nuova password.",
    body: bodyRecovery,
  },
  {
    key: "magic_link",
    subject: "Accedi a Holistic Unity",
    title: "Accedi a Holistic Unity",
    preheader: "Tocca il pulsante per accedere senza password.",
    body: bodyMagicLink,
  },
  {
    key: "email_change",
    subject: "Conferma il nuovo indirizzo email · Holistic Unity",
    title: "Conferma il nuovo indirizzo email",
    preheader: "Conferma il cambio dell'indirizzo email associato al tuo account.",
    body: bodyEmailChange,
  },
];

// --- Render ---------------------------------------------------------------
function renderAll() {
  mkdirSync(RENDERED_DIR, { recursive: true });

  const payload = {};
  for (const t of TEMPLATES) {
    const html = wrap({
      title: t.title,
      preheader: t.preheader,
      body: t.body(),
    });

    // Save locally for manual paste fallback
    writeFileSync(resolve(RENDERED_DIR, `${t.key}.html`), html, "utf8");

    // Build PATCH payload (Supabase Mgmt API field names)
    payload[`mailer_subjects_${t.key}`] = t.subject;
    payload[`mailer_templates_${t.key}_content`] = html;
  }

  console.log(
    `Rendered ${TEMPLATES.length} templates → ${RENDERED_DIR}/{${TEMPLATES.map((t) => t.key).join(",")}}.html`,
  );
  return payload;
}

// --- Push -----------------------------------------------------------------
async function push(payload) {
  if (!ACCESS_TOKEN) {
    console.error(
      "\n[!] SUPABASE_ACCESS_TOKEN not set — skipping API push.\n" +
        "    Templates were still written to ./rendered/ — you can paste\n" +
        "    them manually into Supabase Dashboard → Authentication → Email Templates.\n" +
        "\n    To push automatically:\n" +
        "      1. Create a PAT at https://supabase.com/dashboard/account/tokens\n" +
        "      2. SUPABASE_ACCESS_TOKEN=sbp_... node scripts/email-templates/push-email-templates.mjs\n",
    );
    process.exit(2);
  }

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`\n[!] Push failed (${res.status}):`, text);
    if (res.status === 401) {
      console.error(
        "    The PAT was rejected. Generate a fresh one at\n" +
          "    https://supabase.com/dashboard/account/tokens and re-run.",
      );
    }
    process.exit(1);
  }

  console.log("✓ Pushed all 4 templates to Supabase Auth config.");
}

// --- Main -----------------------------------------------------------------
const payload = renderAll();
await push(payload);
