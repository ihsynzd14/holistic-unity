"use client";

import { I18nProvider } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/context";

export default function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  return <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>;
}
