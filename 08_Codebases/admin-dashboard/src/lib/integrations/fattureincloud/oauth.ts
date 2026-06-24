import { randomBytes, createHash } from "node:crypto";

const AUTHORIZE_URL = "https://api-v2.fattureincloud.it/oauth/authorize";
const TOKEN_URL = "https://api-v2.fattureincloud.it/oauth/token";

export const FIC_OAUTH_SCOPES = [
  "entity.suppliers:r",
  "entity.suppliers:a",
  "entity.clients:r",
  "entity.clients:a",
  "issued_documents.invoices:r",
  "issued_documents.invoices:a",
  "settings:r",
].join(" ");

export const FIC_COOKIE_STATE = "fic_oauth_state";
export const FIC_COOKIE_VERIFIER = "fic_oauth_verifier";
export const FIC_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600, // 10 minutes
};

export function buildAuthorizeUrl(redirectUri: string): {
  url: string;
  state: string;
  verifier: string;
} {
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const params = new URLSearchParams({
    client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FIC_OAUTH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, verifier };
}

export async function exchangeCode(args: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
      client_secret: process.env.FATTUREINCLOUD_CLIENT_SECRET!,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fic_token_exchange_failed:${res.status}:${body.slice(0, 200)}`);
  }
  return await res.json();
}
