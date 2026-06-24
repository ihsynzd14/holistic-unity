"use client";

import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ErrorText } from "@/components/ui/ErrorText";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const unauthorizedError = searchParams.get("error") === "unauthorized";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // After password sign-in the session is at aal1. The dashboard layout
    // will bounce to /verify-mfa or /enroll-mfa as needed, but we can
    // shortcut: check factors and route directly.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");

    // Audit: record this password-step sign-in even though MFA isn't
    // yet entered. Helps detect "attempted access" patterns.
    fetch("/api/security/log-login", { method: "POST" }).catch(() => {});

    if (verified.length > 0) {
      router.push("/verify-mfa");
    } else {
      router.push("/enroll-mfa");
    }
    router.refresh();
  }

  return (
    <>
      {unauthorizedError && (
        <div className="mb-5 rounded-2xl bg-error-light px-4 py-3 text-center text-sm text-error">
          Access denied. Admin accounts only.
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            required
          />
        </div>

        <div>
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
          />
        </div>

        {error && (
          <ErrorText>{error}</ErrorText>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark hover:shadow-xl hover:shadow-berry/25 hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Signing in...
            </span>
          ) : (
            "Sign In"
          )}
        </button>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4"
      style={{
        background: "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #C9A96E 0%, transparent 70%)" }}
        />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, #7B2252 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-sm animate-reveal">
        {/* Logo & Brand */}
        <div className="mb-8 text-center">
          <Image
            src="/logo.png"
            alt="Holistic Unity"
            width={72}
            height={72}
            className="mx-auto mb-4 rounded-2xl shadow-lg shadow-berry/15"
          />
          <DisplayHeading>
            Holistic Unity
          </DisplayHeading>
          <p className="mt-1 text-sm font-medium tracking-wide text-berry-muted">Admin Dashboard</p>
        </div>

        {/* Login Card */}
        <div className="rounded-[22px] border border-white/60 bg-white/80 p-8 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <Suspense fallback={<div className="py-8 text-center text-charcoal-muted">Loading...</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-berry-muted/60">
          Storm X Digital S.R.L.
        </p>
      </div>
    </div>
  );
}
