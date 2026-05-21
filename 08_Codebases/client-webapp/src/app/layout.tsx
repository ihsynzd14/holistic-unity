import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import Providers from "./providers";
import CookieBanner from "@/components/CookieBanner";
import MetaPixel from "@/components/MetaPixel";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import type { Locale } from "@/lib/i18n/context";

export const metadata: Metadata = {
  title: "Holistic Unity",
  description: "Trova il tuo operatore olistico, prenota una sessione e parti per il tuo percorso di benessere.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("hu-locale")?.value;
  // Determine the initial locale in this priority order:
  //   1. Explicit user cookie (set when the user toggles language) — always wins
  //   2. Accept-Language header (browser preference) — defaults non-IT
  //      visitors to EN instead of forcing them onto an Italian page they
  //      can't read. Brazilian client report (2026-05-13): "vou aguardar
  //      a versão brasileira no capisco nada de italiano" — he abandoned
  //      because the page was in Italian and there was no auto-detection
  //      or visible language switcher.
  //   3. Hard fallback: IT (we're a primarily-Italian platform).
  // PT isn't yet implemented as a webapp locale — PT-speaking visitors
  // map to EN, which is at least navigable.
  let initialLocale: Locale = "it";
  if (localeCookie === "en") {
    initialLocale = "en";
  } else if (!localeCookie) {
    // Read the browser's preferred language list. Header format is
    // e.g. "pt-BR,pt;q=0.9,en;q=0.8". We pick the first one that we
    // can serve (IT or anything-else → EN).
    const acceptLang = (await headers()).get("accept-language");
    if (acceptLang) {
      const primary = acceptLang.split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
      // Italian-speaking visitors (it, it-IT, it-CH, …) keep Italian.
      // Anyone else gets English by default. They can switch any time
      // from the language toggle exposed on the register/login pages.
      if (!primary.startsWith("it")) {
        initialLocale = "en";
      }
    }
  }

  return (
    <html lang={initialLocale} className="h-full">
      <body className="h-full antialiased grain">
        <Providers initialLocale={initialLocale}>{children}</Providers>
        <CookieBanner />
        {/* MetaPixel uses useSearchParams() to track route changes;
            App Router requires wrapping such hooks in Suspense to avoid
            opting the whole tree into client-side rendering. */}
        <Suspense fallback={null}>
          <MetaPixel />
        </Suspense>
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
      </body>
    </html>
  );
}
