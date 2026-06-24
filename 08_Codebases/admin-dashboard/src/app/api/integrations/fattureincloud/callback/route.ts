import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCode,
  FIC_COOKIE_STATE,
  FIC_COOKIE_VERIFIER,
} from "@/lib/integrations/fattureincloud/oauth";

interface FicCompany {
  id: number;
  name?: string;
}

interface FicCompaniesResponse {
  data?: { companies?: FicCompany[] };
}

function html(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#2D2D2D}h1{color:#7B2252}code{background:#FCF7FA;padding:2px 6px;border-radius:4px}</style>
</head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * GET /api/integrations/fattureincloud/callback
 *
 * Handles the OAuth callback from FIC. Validates state vs cookie,
 * exchanges code for tokens (PKCE), resolves the Storm X Digital
 * company id, persists credentials in DB.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { user } = auth;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return html("FIC OAuth errore", `<h1>Errore FIC</h1><p><code>${errorParam}</code></p>`, 400);
  }
  if (!code || !state) {
    return html("Parametri mancanti", "<h1>Parametri mancanti</h1><p>code o state assenti.</p>", 400);
  }

  // Validate state + read verifier from cookies
  const cookieState = req.cookies.get(FIC_COOKIE_STATE)?.value;
  const verifier = req.cookies.get(FIC_COOKIE_VERIFIER)?.value;
  if (!cookieState || cookieState !== state) {
    return html("State invalido", "<h1>State invalido</h1><p>CSRF protection ha bloccato il callback. Riprova dall'inizio.</p>", 400);
  }
  if (!verifier) {
    return html("Verifier mancante", "<h1>Verifier mancante</h1><p>Il cookie PKCE è scaduto. Riavvia il flusso connect.</p>", 400);
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/integrations/fattureincloud/callback`;

  let tokens;
  try {
    tokens = await exchangeCode({ code, redirectUri, verifier });
  } catch (e) {
    return html("Token exchange fallito", `<h1>Token exchange fallito</h1><p><code>${(e as Error).message}</code></p>`, 500);
  }

  // Resolve Storm X Digital company id
  let stormX: FicCompany | undefined;
  try {
    const cRes = await fetch("https://api-v2.fattureincloud.it/user/companies", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const cJson = (await cRes.json()) as FicCompaniesResponse;
    const companies = cJson?.data?.companies ?? [];
    stormX = companies.find((c) => /storm\s*x\s*digital/i.test(c.name ?? ""));
    if (!stormX) {
      const list = companies.map((c) => `${c.id}: ${c.name}`).join(", ");
      return html(
        "Azienda non trovata",
        `<h1>Azienda non trovata</h1><p>STORM X DIGITAL non è tra le aziende del tuo account FIC. Aziende disponibili: ${list || "(nessuna)"}.</p>`,
        400,
      );
    }
  } catch (e) {
    return html("Errore lookup aziende", `<h1>Errore lookup aziende</h1><p><code>${(e as Error).message}</code></p>`, 500);
  }

  // Persist credentials (single-row table)
  const admin = createAdminClient();
  await admin
    .from("fattureincloud_credentials")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: insErr } = await admin.from("fattureincloud_credentials").insert({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    company_id: stormX.id,
    scope: tokens.scope,
    connected_by: user.id,
  });
  if (insErr) {
    return html("DB error", `<h1>DB error</h1><p><code>${insErr.message}</code></p>`, 500);
  }

  // Clear OAuth cookies
  const response = html(
    "FIC connesso",
    `<h1>FattureInCloud connesso</h1>
     <p>Azienda: <strong>${stormX.name}</strong> (id <code>${stormX.id}</code>)</p>
     <p>Token salvati. Il cron mensile può ora emettere fatture commissione.</p>
     <p><a href="/dashboard">Torna al dashboard</a></p>`,
  );
  response.cookies.delete(FIC_COOKIE_STATE);
  response.cookies.delete(FIC_COOKIE_VERIFIER);
  return response;
}
