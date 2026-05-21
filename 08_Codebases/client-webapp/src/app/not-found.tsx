import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
      <div className="relative z-10 w-full max-w-sm rounded-[22px] border border-white/60 bg-white/85 p-8 text-center shadow-xl shadow-berry/10 backdrop-blur-xl">
        <p className="font-[family-name:var(--font-display)] text-5xl font-bold text-berry">
          404
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
          Pagina non trovata
        </h1>
        <p className="mt-2 text-sm text-charcoal-light">
          La pagina che cerchi non esiste o è stata spostata.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark"
        >
          Torna alla dashboard
        </Link>
      </div>
    </div>
  );
}
