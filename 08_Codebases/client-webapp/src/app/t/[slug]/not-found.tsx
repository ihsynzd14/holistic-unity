import { cookies } from "next/headers";
import Link from "next/link";

const STR = {
  it: {
    title: "Operatore non trovato",
    body: "Questo profilo non esiste o non è più disponibile.",
    explore: "Scopri Holistic Unity",
    login: "Accedi",
  },
  en: {
    title: "Therapist not found",
    body: "This profile doesn't exist or is no longer available.",
    explore: "Discover Holistic Unity",
    login: "Sign in",
  },
} as const;

export default async function TherapistNotFound() {
  const c = await cookies();
  const t = c.get("hu-locale")?.value === "en" ? STR.en : STR.it;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-cream px-5">
      <div className="max-w-md text-center">
        <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-berry">
          Holistic Unity
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight text-charcoal">
          {t.title}
        </h1>
        <p className="mt-3 text-charcoal-light">{t.body}</p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <a
            href="https://holisticunity.app"
            className="rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark"
          >
            {t.explore}
          </a>
          <Link
            href="/login"
            className="text-sm font-semibold text-berry underline-offset-2 hover:underline"
          >
            {t.login}
          </Link>
        </div>
      </div>
    </main>
  );
}
