"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import it from "./translations/it";
import en from "./translations/en";

export type Locale = "it" | "en";

type Translations = typeof it;

const translationsMap: Record<Locale, Translations> = { it, en };

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
};

const I18nContext = createContext<I18nContextType>({
  locale: "it",
  setLocale: () => {},
  t: it,
});

export function I18nProvider({
  children,
  initialLocale = "it",
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  function setLocale(newLocale: Locale) {
    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      localStorage.setItem("hu-locale", newLocale);
      // Also mirror to the cookie so subsequent SSR requests (and the
      // email/notification pipelines if we ever read locale server-side)
      // stay consistent with the user's explicit choice.
      document.cookie = `hu-locale=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${
        window.location.protocol === "https:" ? "; secure" : ""
      }`;
    }
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translationsMap[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
