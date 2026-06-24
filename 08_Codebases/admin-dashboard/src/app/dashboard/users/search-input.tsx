"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

export function SearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    setQuery(value);
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("q", value);
        params.delete("page"); // Reset to page 1 on new search
      } else {
        params.delete("q");
      }
      router.push(`/dashboard/users?${params.toString()}`);
    });
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search by name or email..."
        className="w-64 rounded-xl border border-berry/10 bg-white/70 px-4 py-2 text-sm text-charcoal placeholder-charcoal-muted/50 outline-none transition-all focus:border-berry/30 focus:ring-2 focus:ring-berry/10 backdrop-blur-sm"
      />
      {isPending && (
        <svg className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
    </div>
  );
}
