import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import CookieBanner from "@/components/CookieBanner";

// Self-hosted via next/font: woff2 files are downloaded at build time and
// served from /_next/static/media. Replaces an @import url(fonts.googleapis.com)
// in globals.css that was being CSP-blocked at runtime (style-src 'self' only),
// so users were silently falling back to Georgia / system-ui.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Cormorant Garamond is a static (non-variable) family on Google Fonts, so
// explicit weights + styles are required. Mirrors the weights the previous
// @import requested. preload:false because this is the display/heading face —
// Inter is the LCP-critical body font and gets the preload budget instead.
const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-cormorant",
  preload: false,
});

export const metadata: Metadata = {
  title: "Holistic Unity — Therapist Portal",
  description: "Manage your profile, bookings and video sessions on Holistic Unity",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`h-full ${inter.variable} ${cormorantGaramond.variable}`}
    >
      <body className="h-full antialiased grain">
        <Providers>{children}</Providers>
        <CookieBanner />
      </body>
    </html>
  );
}
