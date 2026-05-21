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
  // (e.g. x-nonce). The clone is safe — Next.js reads these when it
  // renders RSC downstream.
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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: augmentedHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // Public (unauthenticated) routes — must not be redirected to /login.
  // /register is public so users can self-serve onboarding.
  // /forgot-password is public so a locked-out user can recover.
  // /reset-password is technically post-recovery (the user has a
  // short-lived session at that point) but we list it as public so
  // the middleware doesn't bounce them to /login if the session
  // cookie hasn't propagated yet — the page itself checks for an
  // active session and renders the right state.
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/reset-password") ||
    path.startsWith("/auth") ||
    path === "/";

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from the auth pages — but NOT
  // /reset-password, since the user IS authenticated when they hit
  // it (post-recovery code exchange).
  if (user && (path === "/login" || path === "/register" || path === "/forgot-password")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Redirect root to dashboard if authenticated
  if (user && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
