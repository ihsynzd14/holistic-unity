/**
 * One-off maintenance: clear the legacy `ui-avatars.com` fallback image from
 * every Stream Chat user record.
 *
 * WHY: users without an uploaded photo used to be stored on Stream with an
 * `image: https://ui-avatars.com/...` URL. Every web app's CSP `img-src`
 * blocks that host, so each conversation that renders such a user spams the
 * console with CSP violations (and a redeploy of the apps does NOT fix the
 * already-stored records — Stream caches user data server-side until the user
 * reconnects). This script rewrites those records once, for everyone, so no
 * client ever requests the blocked host again. All three apps share the same
 * Stream application, so a single run cleans the whole platform.
 *
 * USAGE (from client-webapp/):
 *   node scripts/scrub-stream-avatars.mjs --dry-run   # preview only
 *   node scripts/scrub-stream-avatars.mjs             # apply
 *
 * Reads STREAM_API_KEY + STREAM_API_SECRET from the environment or .env.local.
 * SAFE TO RE-RUN: it only touches records whose image points at ui-avatars.com.
 */
import { readFileSync } from "node:fs";
import { StreamChat } from "stream-chat";

// Load .env.local (Next-style) so the script picks up the Stream secret
// without needing it exported in the shell. Real env vars take precedence.
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on the real environment */
}

const apiKey = process.env.STREAM_API_KEY || process.env.NEXT_PUBLIC_STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error(
    "Missing STREAM_API_KEY / STREAM_API_SECRET (looked in env and .env.local).",
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const BAD_HOST = "ui-avatars.com";
const PAGE = 100;

const server = StreamChat.getInstance(apiKey, apiSecret);

let cursor = ""; // all real ids sort after "" → first page returns everything
let scanned = 0;
let scrubbed = 0;

console.log(`${DRY_RUN ? "DRY RUN — " : ""}scanning Stream users for ${BAD_HOST} avatars…`);

for (;;) {
  const { users } = await server.queryUsers(
    { id: { $gt: cursor } },
    { id: 1 },
    { limit: PAGE },
  );
  if (!users.length) break;
  scanned += users.length;

  const bad = users.filter(
    (u) => typeof u.image === "string" && u.image.includes(BAD_HOST),
  );
  if (bad.length) {
    console.log(
      `${DRY_RUN ? "[dry-run] would clear" : "clearing"} ${bad.length}: ${bad
        .map((u) => u.id)
        .join(", ")}`,
    );
    if (!DRY_RUN) {
      await server.partialUpdateUsers(
        bad.map((u) => ({ id: u.id, unset: ["image"] })),
      );
    }
    scrubbed += bad.length;
  }

  cursor = users[users.length - 1].id;
  if (users.length < PAGE) break;
}

console.log(
  `Done. Scanned ${scanned} users; ${DRY_RUN ? "would clear" : "cleared"} ${scrubbed}.`,
);
process.exit(0);
