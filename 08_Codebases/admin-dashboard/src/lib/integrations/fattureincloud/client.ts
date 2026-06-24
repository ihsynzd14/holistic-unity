import { createAdminClient } from "@/lib/supabase/admin";

const FIC_API_BASE = "https://api-v2.fattureincloud.it";
const TOKEN_URL = "https://api-v2.fattureincloud.it/oauth/token";

interface FicCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  company_id: number;
}

async function getCredentials(): Promise<FicCredentials | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("fattureincloud_credentials")
    .select("access_token, refresh_token, expires_at, company_id")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as FicCredentials | null;
}

async function refreshIfNeeded(creds: FicCredentials): Promise<FicCredentials> {
  const expires = new Date(creds.expires_at).getTime();
  if (expires - Date.now() > 60_000) return creds;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
      client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
      client_secret: process.env.FATTUREINCLOUD_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`fic_refresh_failed:${res.status}`);
  const json = await res.json();
  const next: FicCredentials = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? creds.refresh_token,
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    company_id: creds.company_id,
  };
  const admin = createAdminClient();
  await admin
    .from("fattureincloud_credentials")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("company_id", creds.company_id);
  return next;
}

export async function ficFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let creds = await getCredentials();
  if (!creds) throw new Error("fic_not_connected");
  creds = await refreshIfNeeded(creds);
  const url = path.startsWith("http") ? path : `${FIC_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fic_${res.status}:${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function getCompanyId(): Promise<number> {
  const creds = await getCredentials();
  if (!creds) throw new Error("fic_not_connected");
  return creds.company_id;
}

export async function isConnected(): Promise<boolean> {
  const creds = await getCredentials();
  return !!creds;
}
