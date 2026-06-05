import { type NextRequest } from "next/server";
import { buildEmbedCsp } from "@/lib/security/csp";

/**
 * GET /embed/youtube?v=VIDEO_ID[&autoplay=1]
 *
 * A standalone HTML page that hosts the YouTube IFrame Player. It exists
 * solely so the iOS app can load a YouTube video as a *real* HTTPS
 * navigation inside its WKWebView.
 *
 * WHY (see also buildEmbedCsp in lib/security/csp.ts):
 *   WKWebView's `loadHTMLString(html, baseURL:)` does not send a real HTTP
 *   `Referer` header, so YouTube's player refuses to embed and returns the
 *   error 150/152/153 family — even for videos whose owners DO allow
 *   embedding. (We confirmed the affected therapist videos are all public
 *   and embeddable via YouTube's oEmbed endpoint.) Loading this page over
 *   `https://app.holisticunity.app` with `URLRequest` makes WKWebView send
 *   a genuine same-origin `Referer`, which YouTube accepts. Vimeo never
 *   enforced this, which is why Vimeo embeds worked all along.
 *
 * NATIVE BRIDGE:
 *   For the rare video that genuinely has embedding disabled by its owner,
 *   the IFrame API fires `onError`. We post the error code to the WKWebView
 *   message handler `ytError` (when present) so the app can fall back to an
 *   in-app SFSafariViewController, and we also render an in-page "Guarda su
 *   YouTube" link so the page degrades gracefully in a normal browser.
 *
 * SECURITY:
 *   `v` is therapist-controlled (it originates from `video_intro_url`). We
 *   hard-validate it against YouTube's ID grammar (exactly 11 chars from
 *   [A-Za-z0-9_-]) before interpolating it into the HTML/JS — anything else
 *   renders a static "non disponibile" page. This mirrors the iOS-side
 *   `isValidYouTubeID` gate and keeps the interpolation injection-safe.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": buildEmbedCsp(),
      // Never let a CDN cache a per-video page under a shared key.
      "cache-control": "private, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

function unavailablePage(): Response {
  return htmlResponse(
    `<!doctype html><html lang="it"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>html,body{margin:0;height:100%;background:#000;color:#fff;` +
      `font:14px -apple-system,system-ui,sans-serif;display:flex;` +
      `align-items:center;justify-content:center}</style></head>` +
      `<body>Video non disponibile</body></html>`,
    400,
  );
}

export function GET(request: NextRequest): Response {
  const id = request.nextUrl.searchParams.get("v") ?? "";
  if (!YOUTUBE_ID.test(id)) return unavailablePage();

  const autoplay = request.nextUrl.searchParams.get("autoplay") === "1";
  // `id` has passed the strict 11-char gate above, so interpolating it into
  // the script and the href is injection-safe.
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  const html =
    `<!doctype html><html lang="it"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">` +
    `<style>` +
    `html,body{margin:0;height:100%;background:#000;overflow:hidden}` +
    `#player,iframe{position:absolute;inset:0;width:100%;height:100%;border:0}` +
    `#fallback{position:absolute;inset:0;display:none;flex-direction:column;` +
    `align-items:center;justify-content:center;gap:14px;background:#000;color:#fff;` +
    `font:14px -apple-system,system-ui,sans-serif;text-align:center;padding:24px}` +
    `#fallback a{display:inline-flex;align-items:center;gap:8px;background:#f00;` +
    `color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px}` +
    `</style></head><body>` +
    `<div id="player"></div>` +
    `<div id="fallback">` +
    `<div>Questo video non può essere riprodotto qui</div>` +
    `<a href="${watchUrl}" target="_blank" rel="noopener">▶ Guarda su YouTube</a>` +
    `</div>` +
    `<script src="https://www.youtube.com/iframe_api"></script>` +
    `<script>` +
    `function showFallback(code){` +
    `var f=document.getElementById('fallback');if(f)f.style.display='flex';` +
    `var p=document.getElementById('player');if(p)p.style.display='none';` +
    `try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.ytError){` +
    `window.webkit.messageHandlers.ytError.postMessage(String(code));}}catch(e){}` +
    `}` +
    `function onYouTubeIframeAPIReady(){` +
    `new YT.Player('player',{` +
    `videoId:'${id}',` +
    `playerVars:{playsinline:1,rel:0,modestbranding:1,autoplay:${autoplay ? 1 : 0},` +
    `origin:location.origin},` +
    `events:{onError:function(e){showFallback(e&&e.data);}}` +
    `});` +
    `}` +
    `</script></body></html>`;

  return htmlResponse(html);
}
