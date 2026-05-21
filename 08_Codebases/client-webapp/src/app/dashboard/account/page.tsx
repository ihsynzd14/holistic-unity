"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { validatePasswordShape, isPasswordBreached } from "@/lib/security/password";
import { User, Phone, Mail, Lock, Globe, LogOut, CheckCircle2, Monitor, Trash2, AlertTriangle, Sparkles } from "lucide-react";

type LoginEvent = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  is_new_device: boolean;
  created_at: string;
};

function shortenUa(ua: string | null): string {
  if (!ua) return "Unknown";
  const platform = /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux" : "Unknown";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} \u00b7 ${platform}`;
}

export default function ClientAccountPage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [savedProfile, setSavedProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [recentLogins, setRecentLogins] = useState<LoginEvent[]>([]);

  // Research-data consent — backed by client_preferences.research_consent.
  // Default false because GDPR Art. 7(2) treats silence as non-consent
  // for special-category-adjacent data (onboarding answers can be combined
  // into health-related profiles).
  const [researchConsent, setResearchConsent] = useState(false);
  const [researchConsentSaving, setResearchConsentSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setEmail(user.email ?? "");
      const { data } = await supabase
        .from("users")
        .select("display_name, phone_number, gender")
        .eq("id", user.id)
        .maybeSingle();
      setDisplayName(data?.display_name ?? "");
      setGender((data as { display_name: string | null; phone_number: string | null; gender: string | null } | null)?.gender ?? "");
      setPhone(data?.phone_number ?? "");

      // Recent logins for forensic visibility (RLS limits to current user)
      const { data: events } = await supabase
        .from("login_events")
        .select("id, ip_address, user_agent, is_new_device, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentLogins((events as LoginEvent[]) ?? []);

      // Pull current research_consent flag (may be NULL if user
      // never went through the new onboarding — treated as false).
      const { data: prefs } = await supabase
        .from("client_preferences")
        .select("research_consent")
        .eq("user_id", user.id)
        .maybeSingle();
      setResearchConsent(prefs?.research_consent === true);

      setLoading(false);
    }
    void load();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    setSavedProfile(false);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("users")
      .update({
        display_name: displayName.trim(),
        phone_number: phone.trim(),
        gender: gender || null,
      })
      .eq("id", user.id);
    setSavingProfile(false);
    if (error) {
      setProfileError(error.message || t.account.saveError);
      return;
    }
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2500);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavedPassword(false);
    setPasswordError("");
    const shapeError = validatePasswordShape(newPassword);
    if (shapeError) {
      setPasswordError(shapeError);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError(t.account.passwordMismatch);
      return;
    }
    setSavingPassword(true);
    // Block known-breached passwords on rotation as well — the same HIBP
    // gate that guards /register, so an existing user cannot rotate INTO a
    // compromised credential.
    const breached = await isPasswordBreached(newPassword);
    if (breached) {
      setSavingPassword(false);
      setPasswordError(
        "Questa password è apparsa in fughe di dati pubbliche. Sceglierne una diversa.",
      );
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      setPasswordError(error.message);
      return;
    }
    setNewPassword("");
    setNewPasswordConfirm("");
    setSavedPassword(true);
    setTimeout(() => setSavedPassword(false), 3000);
  }

  /// Persists a research_consent flip. Stamps research_consent_at only
  /// when consent goes TRUE (audit trail per GDPR Art. 7(1)). When the
  /// row doesn't exist (rare — user pre-dates the onboarding rewrite),
  /// upsert creates it with sensible defaults.
  async function updateResearchConsent(next: boolean) {
    setResearchConsentSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("client_preferences")
        .upsert(
          {
            user_id: user.id,
            research_consent: next,
            research_consent_at: next ? nowIso : null,
          },
          { onConflict: "user_id" },
        );
      if (error) {
        // Revert UI on failure
        setResearchConsent(!next);
      } else {
        setResearchConsent(next);
      }
    } finally {
      setResearchConsentSaving(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // GDPR Article 17 — right to erasure. Calls the delete-user-account
  // Edge Function which:
  //   • deletes Stripe customer + payment methods
  //   • marks Stream Chat user as deleted
  //   • anonymizes public.users via the delete_user_account() RPC
  //   • removes the auth.users row so the user can't log back in
  // Two-step confirmation in the UI: open the danger panel, then the
  // user types "ELIMINA" to unlock the final button.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Sessione scaduta. Accedi di nuovo.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/delete-user-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Impossibile eliminare l'account. Contatta il supporto.");
      }
      // Session is already invalidated server-side by the Edge Function,
      // but signOut locally clears any cached tokens in the browser.
      await supabase.auth.signOut();
      router.push("/login?account_deleted=1");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      setDeleteError(msg);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-8">
      <div className="animate-reveal">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">
          {t.account.title}
        </h1>
        <p className="mt-1 text-sm text-charcoal-muted">{t.account.subtitle}</p>
      </div>

      {/* Profile */}
      <form onSubmit={saveProfile} className="animate-reveal space-y-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "40ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
          {t.account.personalInfo}
        </h2>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-charcoal-light">
            <User className="h-3.5 w-3.5" /> {t.account.fullName}
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-berry-subtle bg-white px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
            {t.account.genderLabel}
          </label>
          <div className="flex gap-2">
            {(
              [
                { value: "female", label: t.account.genderFemale },
                { value: "male",   label: t.account.genderMale },
              ] as Array<{ value: string; label: string }>
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGender(gender === opt.value ? "" : opt.value)}
                className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                  gender === opt.value
                    ? "border-berry bg-berry text-white"
                    : "border-berry-subtle bg-white text-charcoal-light hover:border-berry/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-charcoal-light">
            <Phone className="h-3.5 w-3.5" /> {t.account.phone}
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-berry-subtle bg-white px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-charcoal-light">
            <Mail className="h-3.5 w-3.5" /> {t.account.email}
          </label>
          <input
            value={email}
            disabled
            className="w-full rounded-xl border border-berry-subtle bg-cream-dark/30 px-4 py-2.5 text-sm text-charcoal-muted"
          />
          <p className="mt-1 text-[11px] text-charcoal-muted/70">{t.account.emailHint}</p>
        </div>

        {profileError && <p className="text-sm text-error">{profileError}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark disabled:opacity-50"
          >
            {savingProfile ? t.account.saving : t.account.save}
          </button>
          {savedProfile && (
            <span className="flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.account.saved}
            </span>
          )}
        </div>
      </form>

      {/* Password */}
      <form onSubmit={changePassword} className="animate-reveal space-y-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "80ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
          {t.account.security}
        </h2>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-charcoal-light">
            <Lock className="h-3.5 w-3.5" /> {t.account.newPassword}
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-xl border border-berry-subtle bg-white px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
          <p className="mt-1 text-[11px] text-charcoal-muted/70">{t.account.passwordHint}</p>
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-charcoal-light">
            <Lock className="h-3.5 w-3.5" /> {t.account.confirmNewPassword}
          </label>
          <input
            type="password"
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-xl border border-berry-subtle bg-white px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
        </div>

        {passwordError && <p className="text-sm text-error">{passwordError}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingPassword || !newPassword || !newPasswordConfirm}
            className="rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark disabled:opacity-50"
          >
            {savingPassword ? t.account.saving : t.account.changePassword}
          </button>
          {savedPassword && (
            <span className="flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.account.passwordChanged}
            </span>
          )}
        </div>
      </form>

      {/* Language */}
      <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "120ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted mb-3 flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> {t.account.language}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setLocale("it")}
            className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-medium transition-all ${
              locale === "it"
                ? "bg-berry text-white shadow-md shadow-berry/15"
                : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
            }`}
          >
            Italiano
          </button>
          <button
            onClick={() => setLocale("en")}
            className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-medium transition-all ${
              locale === "en"
                ? "bg-berry text-white shadow-md shadow-berry/15"
                : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
            }`}
          >
            English
          </button>
        </div>
      </div>

      {/* Recent logins — privacy + security forensics */}
      {recentLogins.length > 0 && (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "180ms" }}>
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-charcoal-muted">
            <Monitor className="h-3.5 w-3.5" /> {t.account.recentLogins}
          </h2>
          <p className="mb-3 text-xs text-charcoal-muted">{t.account.recentLoginsHint}</p>
          <div className="space-y-1.5">
            {recentLogins.map((ev) => {
              const date = new Date(ev.created_at);
              return (
                <div key={ev.id} className="flex items-start justify-between gap-2 rounded-lg border border-berry/5 bg-cream-dark/20 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-charcoal">
                      {date.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-charcoal-muted" title={ev.user_agent ?? ""}>
                      {shortenUa(ev.user_agent)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <code className="rounded bg-charcoal/5 px-1.5 py-0.5 font-mono text-[10px] text-charcoal-muted">
                      {ev.ip_address ?? "—"}
                    </code>
                    {ev.is_new_device && (
                      <span className="rounded-full bg-warning-light px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-dark">
                        {t.account.newDevice}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Research-data consent (opt-in, GDPR-explicit). Sits between
          security/forensic info and the destructive actions so it
          doesn't get lost — privacy controls deserve visibility. */}
      <div
        className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm"
        style={{ animationDelay: "200ms" }}
      >
        <h2 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-charcoal-muted">
          <Sparkles className="h-3.5 w-3.5" /> Dati e ricerca
        </h2>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={researchConsent}
            disabled={researchConsentSaving}
            onChange={(e) => updateResearchConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-berry disabled:opacity-50"
          />
          <span className="text-sm text-charcoal">
            <strong className="block font-semibold text-charcoal">
              Aiuta l&apos;ecosistema olistico (opzionale)
            </strong>
            <span className="mt-1 block text-xs text-charcoal-muted">
              Acconsento all&apos;uso anonimo e aggregato delle mie risposte di
              onboarding per generare report di settore. Nessun dato personale
              identificabile viene condiviso. Puoi cambiare idea in qualsiasi
              momento.
            </span>
          </span>
        </label>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="animate-reveal flex w-full items-center justify-center gap-2 rounded-2xl border border-error/20 bg-white/70 px-5 py-3 text-sm font-medium text-error transition-all hover:bg-error-light"
        style={{ animationDelay: "160ms" }}
      >
        <LogOut className="h-4 w-4" />
        {t.account.signOut}
      </button>

      {/* Danger zone — GDPR Art. 17 right to erasure. Two-step confirm:
          open the panel, then type "ELIMINA" to unlock the final button.
          Irreversible: the Edge Function orchestrates Stripe/Stream
          cleanup + anonymises the public.users row + deletes the auth
          user so the email can't log back in. */}
      <div
        className="animate-reveal rounded-2xl border border-error/20 bg-error/5 p-5"
        style={{ animationDelay: "200ms" }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" strokeWidth={1.75} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-error">
              {t.account.deleteAccount ?? "Elimina account"}
            </h3>
            <p className="mt-1 text-xs text-charcoal-muted">
              {t.account.deleteAccountWarning ??
                "Questa azione è irreversibile. Tutti i tuoi dati verranno eliminati permanentemente."}
            </p>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-error/30 bg-white/70 px-4 py-2 text-xs font-semibold text-error transition-all hover:bg-error-light"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.account.deleteAccount ?? "Elimina il mio account"}
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-medium text-charcoal-light">
                  Per confermare, scrivi <span className="font-bold text-error">ELIMINA</span> qui sotto:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="ELIMINA"
                  autoComplete="off"
                  className="w-full rounded-xl border border-error/30 bg-white px-4 py-2.5 text-sm text-charcoal placeholder-charcoal-muted/40 outline-none focus:border-error focus:ring-2 focus:ring-error/10"
                />
                {deleteError && (
                  <p className="text-xs text-error" role="alert">
                    {deleteError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== "ELIMINA" || deleting}
                    className="flex items-center gap-1.5 rounded-full bg-error px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-error/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Elimina definitivamente
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText("");
                      setDeleteError("");
                    }}
                    disabled={deleting}
                    className="rounded-full border border-charcoal/15 bg-white/70 px-4 py-2 text-xs font-medium text-charcoal-muted transition-all hover:bg-charcoal/5 disabled:opacity-40"
                  >
                    Annulla
                  </button>
                </div>
                <p className="text-[10px] text-charcoal-muted">
                  Alternativa: se preferisci, puoi scrivere a{" "}
                  <a href="mailto:support@holisticunity.app?subject=Delete%20Account%20Request" className="text-error hover:underline">
                    support@holisticunity.app
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
