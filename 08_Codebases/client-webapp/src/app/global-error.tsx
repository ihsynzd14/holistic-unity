"use client";

// Root-layout error boundary. Fires when the layout itself throws — at
// which point `src/app/error.tsx` is unreachable (it lives below the
// layout) and the providers tree is gone. Sentry's App Router guide
// explicitly recommends this file: without it, root-layout crashes are
// invisible in the dashboard. Renders its own <html>/<body> because the
// root layout has been replaced by the time we're here.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="it">
      <body>
        <div
          className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
          style={{
            background:
              "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
          }}
        >
          <div
            className="relative z-10 w-full max-w-sm rounded-[22px] border p-8 text-center shadow-xl backdrop-blur-xl"
            style={{
              background: "rgba(255, 255, 255, 0.85)",
              borderColor: "rgba(255, 255, 255, 0.6)",
            }}
          >
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "rgba(220, 53, 69, 0.1)" }}
            >
              <span className="text-2xl font-semibold" style={{ color: "#dc3545" }}>
                !
              </span>
            </div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: "#1f1f1f" }}
            >
              Qualcosa è andato storto
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#5a5a5a" }}>
              Ci scusiamo per l&apos;inconveniente. Riprova tra qualche istante.
            </p>
            {error.digest && (
              <p
                className="mt-3 font-mono text-[10px]"
                style={{ color: "#9a9a9a" }}
              >
                Codice errore: {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={() => reset()}
              className="mt-6 w-full rounded-full px-6 py-2.5 text-sm font-semibold text-white"
              style={{ background: "#7B2252" }}
            >
              Riprova
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
