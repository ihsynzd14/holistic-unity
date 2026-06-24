import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional extra headers to forward to the server-rendered RSC tree.
 * Used by the proxy middleware to pass the per-request CSP nonce
 * (`x-nonce`) so layouts/pages can read it via `headers()` and apply
 * it to inline `<script>` tags.
 */
interface UpdateSessionOptions {
  forwardHeaders?: Record<string, string>;
}

export async function updateSession(
  request: NextRequest,
  options: UpdateSessionOptions = {},
) {
  // Clone request headers so we can augment them with the forwarded set
  // (e.g. x-nonce). The clone is passed into NextResponse.next so that
  // downstream RSC renders see it.
  const augmentedHeaders = new Headers(request.headers);
  for (const [key, value] of Object.entries(options.forwardHeaders ?? {})) {
    augmentedHeaders.set(key, value);
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: augmentedHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request: { headers: augmentedHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Skip auth entirely for cron endpoints. Vercel's scheduler hits
  // these URLs directly with `Authorization: Bearer ${CRON_SECRET}`
  // — no Supabase session cookie. Without this skip the middleware
  // redirects to /login (302), Vercel sees a non-200 response, and
  // the cron silently never executes its body. The route handlers
  // themselves verify CRON_SECRET, so this is auth-safe.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check if user is authenticated
  if (!user && !request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Check if user email is in admin list
  if (user) {
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase());

    if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
      // Not an admin — sign out and redirect to login
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "unauthorized");
      return NextResponse.redirect(url);
    }
  }

  // If authenticated admin is on /login, redirect to dashboard
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
