"use client";

// Runtime-error boundary. Next.js auto-renders this whenever a server
// component throws or a client component crashes during render. Keeps
// users off the default Next.js dark error screen and gives a branded
// "something went wrong — try again" escape hatch.

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep a console trace for developers — no PII is emitted, just the
    // message + Next.js error digest that maps to server logs.
    console.error("[client-webapp] unhandled error:", error.message, error.digest);
  }, [error]);

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
      <div className="relative z-10 w-full max-w-sm rounded-[22px] border border-white/60 bg-white/85 p-8 text-center shadow-xl shadow-berry/10 backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <span className="text-2xl text-error">!</span>
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
          Qualcosa è andato storto
        </h1>
        <p className="mt-2 text-sm text-charcoal-light">
          Ci scusiamo per l&apos;inconveniente. Puoi riprovare o tornare alla dashboard.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-charcoal-muted/70">
            Codice errore: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => reset()}
            className="rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark"
          >
            Riprova
          </button>
          <Link
            href="/dashboard"
            className="rounded-full border border-berry/20 px-6 py-2.5 text-sm font-medium text-berry-dark transition-all hover:bg-berry-subtle/50"
          >
            Torna alla dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
