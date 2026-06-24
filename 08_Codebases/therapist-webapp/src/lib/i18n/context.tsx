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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return "it";
    }

    const stored = localStorage.getItem("hu-locale") as Locale | null;
    return stored && translationsMap[stored] ? stored : "it";
  });

  function setLocale(newLocale: Locale) {
    setLocaleState(newLocale);
    localStorage.setItem("hu-locale", newLocale);
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
