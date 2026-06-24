"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  CreditCard, Bell, Shield, ShieldCheck, ExternalLink,
  ChevronRight, HelpCircle,
  AlertTriangle, CheckCircle, Clock, Link as LinkIcon,
  Mail, MessageCircle, Globe, Calendar, Copy, Check, Unlink,
  MapPin, FileCheck, Receipt,
} from "lucide-react";
import { getFeeConfig } from "@/lib/payments/fee-config";
import { disableMfa } from "@/lib/auth/mfa";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type StripeStatus = {
  connected: boolean;
  status: string;
  accountId: string | null;
};

type CalendarIntegration = {
  id: string;
  provider: "google" | "microsoft";
  calendar_email: string | null;
  connected_at: string;
};

type EmailNotifPrefs = {
  email_bookings: boolean;
  email_messages: boolean;
  email_payments: boolean;
  email_reminders: boolean;
};

const defaultEmailPrefs: EmailNotifPrefs = {
  email_bookings: true,
  email_messages: true,
  email_payments: true,
  email_reminders: true,
};

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [stripe, setStripe] = useState<StripeStatus>({ connected: false, status: "not_connected", accountId: null });
  const [emailPrefs, setEmailPrefs] = useState<EmailNotifPrefs>(defaultEmailPrefs);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [stripeError, setStripeError] = useState("");
  const [stripeLoading, setStripeLoading] = useState(false);
  const [calendarIntegrations, setCalendarIntegrations] = useState<CalendarIntegration[]>([]);
  const [icalUrl, setIcalUrl] = useState("");
  const [icalCopied, setIcalCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [stripeCountry, setStripeCountry] = useState<string | null>(null);
  const [vatNumber, setVatNumber] = useState("");
  const [vatValidatedAt, setVatValidatedAt] = useState<string | null>(null);
  const [vatInput, setVatInput] = useState("");
  const [vatValidating, setVatValidating] = useState(false);
  const [vatResult, setVatResult] = useState<{ valid?: boolean; error?: string } | null>(null);
  // 2FA / MFA state
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [confirmDisableMfa, setConfirmDisableMfa] = useState(false);

  // Stripe Connect — country picker shown ONCE before the very first
  // onboarding click. The choice is permanent (Stripe doesn't allow
  // changing the account country after creation), so we surface it
  // explicitly with a warning rather than silently defaulting to IT.
  const [pickedCountry, setPickedCountry] = useState<string>("");

  const fetchSettings = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUserEmail(user.email || "");

    // Load Stripe status + country/VAT. Use my_therapist_profile
    // (security-definer view scoped to auth.uid()) so we can read
    // sensitive cols like stripe_connected_account_id and vat_number
    // — the base table has column-level grants that block them for
    // anon/authenticated.
    const { data: profile } = await supabase
      .from("my_therapist_profile")
      .select("stripe_connected_account_id, stripe_account_status, stripe_country, vat_number, vat_validated_at")
      .eq("id", user.id)
      .single();

    if (profile) {
      setStripe({
        connected: profile.stripe_account_status === "active",
        status: profile.stripe_account_status || "not_connected",
        accountId: profile.stripe_connected_account_id,
      });
      setStripeCountry(profile.stripe_country || null);
      if (profile.vat_number) {
        setVatNumber(profile.vat_number);
        setVatInput(profile.vat_number);
      }
      if (profile.vat_validated_at) setVatValidatedAt(profile.vat_validated_at);

      // Recovery layer: if Stripe says we have an account but our DB
      // shows a non-active state, the `account.updated` webhook may
      // have raced the capability activation OR been dropped entirely.
      // Hit the sync endpoint to reconcile from Stripe's live state.
      //
      // Originally this only triggered for `onboarding_pending`, but
      // 3 therapists in May 2026 (Laura, Luz Elsy, Roberta) got stuck
      // in `restricted` — Stripe said `charges_enabled=true` but our
      // DB was wrong and the cron also wouldn't re-sweep `restricted`.
      // Including `restricted` here makes settings-page mount the
      // second resilient recovery path alongside the cron.
      if (
        profile.stripe_connected_account_id &&
        (profile.stripe_account_status === "onboarding_pending" ||
          profile.stripe_account_status === "restricted")
      ) {
        // Fire-and-forget; if Stripe now reports active, the response
        // includes the updated status and we patch local state.
        fetch("/api/stripe/sync-status", { method: "POST" })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.changed && data?.status) {
              setStripe((prev) => ({
                ...prev,
                connected: data.status === "active",
                status: data.status,
              }));
            }
          })
          .catch(() => {/* silent — page still usable */});
      }
    }

    // Load email notification preferences from profile
    const { data: prefsData } = await supabase
      .from("therapist_profiles")
      .select("email_notifications")
      .eq("id", user.id)
      .single();
    if (prefsData?.email_notifications) {
      setEmailPrefs({ ...defaultEmailPrefs, ...prefsData.email_notifications });
    }

    // Load calendar integrations
    const { data: integrations } = await supabase
      .from("therapist_calendar_integrations")
      .select("id, provider, calendar_email, connected_at")
      .eq("therapist_id", user.id);
    if (integrations) setCalendarIntegrations(integrations);

    // Generate iCal feed URL
    try {
      const res = await fetch("/api/ical/token");
      const data = await res.json();
      if (data.url) setIcalUrl(data.url);
    } catch { /* ignore — will be generated client-side as fallback */ }

    // MFA status — true if therapist has at least one verified TOTP factor
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).some((f) => f.status === "verified");
      setMfaEnrolled(verified);
    } catch { /* ignore — defaults to "not enrolled" */ }

    setLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  async function handleDisableMfa() {
    setMfaLoading(true);
    setMfaError("");
    try {
      const supabase = createClient();
      await disableMfa(supabase);
      // Sync therapist_profiles.has_mfa = false so the public badge
      // disappears. Best-effort.
      try {
        await fetch("/api/security/mfa-status", { method: "POST" });
      } catch {}
      setMfaEnrolled(false);
      setConfirmDisableMfa(false);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setMfaLoading(false);
    }
  }

  // Persist email prefs to Supabase
  async function updateEmailPref(key: keyof EmailNotifPrefs) {
    const updated = { ...emailPrefs, [key]: !emailPrefs[key] };
    setEmailPrefs(updated);
    setSavingPrefs(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("therapist_profiles")
          .update({ email_notifications: updated })
          .eq("id", user.id);
      }
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 2000);
    } catch { /* silent — preference will still be in state */ }
    setSavingPrefs(false);
  }

  async function openStripeDashboard() {
    if (!stripe.accountId) return;
    setStripeError("");
    setStripeLoading(true);
    try {
      // Express Connect accounts need a single-use login link generated
      // server-side; the bare dashboard.stripe.com URL only opens the
      // generic login screen.
      const res = await fetch("/api/stripe/dashboard", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        // window.open() AFTER an await breaks the user-gesture chain and
        // gets killed by popup blockers in most browsers, leaving the
        // therapist looking at a button that does nothing. Using
        // top-level navigation is reliable; Stripe's dashboard handles
        // the return naturally via the user clicking back.
        window.location.href = data.url;
      } else {
        setStripeError(data.error || t.common.error);
      }
    } catch {
      setStripeError(t.common.error);
    } finally {
      setStripeLoading(false);
    }
  }

  async function startStripeOnboarding() {
    setStripeError("");
    // The country picker is REQUIRED only when creating a brand-new
    // Stripe account (no `stripe.accountId` yet). For a therapist who
    // already started onboarding (status `onboarding_pending` /
    // `restricted` with an existing account id) we just need to mint
    // a fresh `account_link` to resume the same Stripe account — the
    // country was already locked in at creation time and Stripe
    // doesn't allow changing it. Without this branch, the previous
    // sprint's regression made the "Collega Stripe" button
    // permanently disabled for any therapist who got stuck mid-flow:
    // the country picker UI was hidden (it only renders when
    // `!stripe.accountId`), so they had nothing to fill in.
    const isNewAccount = !stripe.accountId;
    if (isNewAccount && !pickedCountry) {
      setStripeError(
        "Seleziona prima il paese di residenza fiscale: Stripe non permette di cambiarlo dopo la creazione dell'account.",
      );
      return;
    }
    setStripeLoading(true);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // For a resume, the body has no country — the Edge Function
        // ignores it (the existing account is reused via `accountId`).
        body: JSON.stringify(isNewAccount ? { country: pickedCountry } : {}),
      });
      const data = await res.json();
      if (data.url) {
        // Same popup-blocker reasoning as openStripeDashboard above.
        // The Stripe Connect onboarding URL has its own return-to-app
        // redirect baked in via the Edge Function's `return_url`, so the
        // therapist comes back here automatically when they're done.
        window.location.href = data.url;
      } else {
        setStripeError(data.error || t.common.error);
      }
    } catch {
      setStripeError(t.common.error);
    } finally {
      setStripeLoading(false);
    }
  }

  function copyIcalUrl() {
    navigator.clipboard.writeText(icalUrl);
    setIcalCopied(true);
    setTimeout(() => setIcalCopied(false), 2000);
  }

  async function disconnectCalendar(provider: "google" | "microsoft") {
    setDisconnecting(provider);
    setStripeError(""); // reuse the existing error slot for any settings-page error
    try {
      const res = await fetch(`/api/calendar/${provider}/disconnect`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // Surface the error so the user knows the disconnect didn't work
        // and can retry — instead of silently flipping the UI while the
        // DB row stays put.
        const data = await res.json().catch(() => ({}));
        setStripeError(data.error || t.common.error);
        setDisconnecting(null);
        return;
      }
      setCalendarIntegrations((prev) => prev.filter((i) => i.provider !== provider));
    } catch {
      setStripeError(t.common.error);
    } finally {
      setDisconnecting(null);
    }
  }

  async function validateVat() {
    if (!vatInput.trim()) return;
    setVatValidating(true);
    setVatResult(null);
    try {
      const res = await fetch("/api/stripe/validate-vat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vat_number: vatInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVatResult({ error: data.error || t.settings.vatServiceUnavailable });
      } else if (data.valid) {
        setVatResult({ valid: true });
        setVatNumber(data.vat_number);
        setVatValidatedAt(new Date().toISOString());
      } else {
        setVatResult({ valid: false, error: t.settings.vatInvalid });
      }
    } catch {
      setVatResult({ error: t.settings.vatServiceUnavailable });
    } finally {
      setVatValidating(false);
    }
  }

  const feeConfig = stripeCountry ? getFeeConfig(stripeCountry) : null;
  const showVatSection = feeConfig?.requiresVatNumber === true;

  const googleIntegration = calendarIntegrations.find((i) => i.provider === "google");
  const microsoftIntegration = calendarIntegrations.find((i) => i.provider === "microsoft");
  const hasGoogleConfig = true; // Will check env vars server-side
  const hasMicrosoftConfig = true;

  function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
      <button
        onClick={onChange}
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-berry" : "bg-charcoal-muted/20"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    );
  }

  const stripeStatusConfig: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
    active: { label: t.settings.stripeActive, icon: CheckCircle, color: "text-success", bg: "bg-success/10" },
    onboarding_pending: { label: t.settings.stripePending, icon: Clock, color: "text-warning", bg: "bg-warning/10" },
    restricted: { label: t.settings.stripeRestricted, icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" },
    disabled: { label: t.settings.stripeNotConnected, icon: AlertTriangle, color: "text-error", bg: "bg-error/10" },
    not_connected: { label: t.settings.stripeNotConnected, icon: LinkIcon, color: "text-charcoal-muted", bg: "bg-charcoal/5" },
  };

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="animate-reveal">
        <DisplayHeading>{t.settings.title}</DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">{t.settings.subtitle}</p>
      </div>

      {/* Stripe Connect */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "40ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.payments}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stripeStatusConfig[stripe.status]?.bg || "bg-charcoal/5"}`}>
              <CreditCard className={`h-5 w-5 ${stripeStatusConfig[stripe.status]?.color || "text-charcoal-muted"}`} strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-charcoal">Stripe Connect</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {(() => {
                  const cfg = stripeStatusConfig[stripe.status] || stripeStatusConfig.not_connected;
                  const StatusIcon = cfg.icon;
                  return (
                    <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                  );
                })()}
              </div>
            </div>
            {stripe.connected ? (
              <button
                onClick={openStripeDashboard}
                className="flex items-center gap-1.5 rounded-full border border-berry/20 px-4 py-2 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Dashboard
              </button>
            ) : (
              <button
                onClick={startStripeOnboarding}
                // Disable rule:
                //   - while a request is in flight (always)
                //   - OR when this is a brand-new onboarding AND the
                //     therapist hasn't picked a country yet
                // Resume of an existing Stripe account (`stripe.accountId`
                // already set, status `onboarding_pending` / `restricted`)
                // does NOT need a fresh country — Stripe locked it at
                // account creation. Forgetting this branch was the bug
                // therapists reported as "non mi ci fa neanche più
                // ritornare in stripe connect".
                disabled={stripeLoading || (!stripe.accountId && !pickedCountry)}
                className="flex items-center gap-1.5 rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-md shadow-berry/15 hover:bg-berry-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !stripe.accountId && !pickedCountry
                    ? "Seleziona il paese di residenza prima di continuare"
                    : stripe.accountId
                      ? "Riprendi l'onboarding Stripe già iniziato"
                      : undefined
                }
              >
                {stripeLoading ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <LinkIcon className="h-3.5 w-3.5" />
                )}
                {stripeLoading
                  ? t.settings.stripeOpening
                  : stripe.accountId
                    ? "Riprendi onboarding"
                    : t.settings.stripeConnect}
              </button>
            )}
          </div>
          {/*
            Restricted state needs explanation. The therapist has
            submitted everything and Stripe is doing the legally
            required KYC/AML review. Without this copy, the
            confusing label ("Stripe sta verificando") combined
            with a visible "Riprendi onboarding" button looks like
            they still have work to do — Laura Meraviglia 2026-05-14:
            "ho già fatto l'onboarding ma il portale dice ancora in corso".
          */}
          {stripe.status === "restricted" && (
            <p className="mt-4 rounded-xl bg-warning/5 border border-warning/15 px-4 py-3 text-xs leading-relaxed text-charcoal-muted">
              {t.settings.stripeRestrictedDesc}
            </p>
          )}
          {/*
            Country picker — visible only when the therapist has NOT yet
            created a Stripe account (`!stripe.accountId`). Stripe locks
            the account country at creation time, so we must collect it
            up-front. Once the account exists this section disappears
            (the `stripe_country` is shown elsewhere as part of the
            connected status).

            The list is the intersection of:
              - Stripe Connect Express supported countries
              - countries where we know the payout corridor works for our
                Italian-incorporated platform
            Extending the list requires verifying the corridor in
            Stripe Dashboard before adding here AND in the Edge Function
            `STRIPE_CONNECT_COUNTRIES` set.
          */}
          {!stripe.connected && !stripe.accountId && (
            <div className="mt-3 rounded-xl border border-berry/15 bg-cream/40 p-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-charcoal mb-2">
                Paese di residenza fiscale
              </label>
              <p className="text-[11px] text-charcoal-muted mb-2 leading-relaxed">
                <strong>Scelta permanente.</strong> Stripe non permette di
                modificare il paese dell&apos;account dopo la creazione —
                seleziona quello in cui paghi le tasse e dove avrai il
                conto bancario su cui ricevere i bonifici.
              </p>
              <select
                value={pickedCountry}
                onChange={(e) => setPickedCountry(e.target.value)}
                className="w-full rounded-xl border border-berry-subtle bg-white px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
              >
                <option value="">— Seleziona —</option>
                <optgroup label="UE">
                  <option value="IT">🇮🇹 Italia</option>
                  <option value="ES">🇪🇸 Spagna</option>
                  <option value="FR">🇫🇷 Francia</option>
                  <option value="DE">🇩🇪 Germania</option>
                  <option value="PT">🇵🇹 Portogallo</option>
                  <option value="NL">🇳🇱 Paesi Bassi</option>
                  <option value="BE">🇧🇪 Belgio</option>
                  <option value="AT">🇦🇹 Austria</option>
                  <option value="IE">🇮🇪 Irlanda</option>
                  <option value="LU">🇱🇺 Lussemburgo</option>
                  <option value="FI">🇫🇮 Finlandia</option>
                  <option value="SE">🇸🇪 Svezia</option>
                  <option value="DK">🇩🇰 Danimarca</option>
                  <option value="GR">🇬🇷 Grecia</option>
                  <option value="PL">🇵🇱 Polonia</option>
                  <option value="CZ">🇨🇿 Repubblica Ceca</option>
                  <option value="RO">🇷🇴 Romania</option>
                  <option value="HU">🇭🇺 Ungheria</option>
                  <option value="HR">🇭🇷 Croazia</option>
                  <option value="SI">🇸🇮 Slovenia</option>
                  <option value="SK">🇸🇰 Slovacchia</option>
                  <option value="BG">🇧🇬 Bulgaria</option>
                  <option value="EE">🇪🇪 Estonia</option>
                  <option value="LV">🇱🇻 Lettonia</option>
                  <option value="LT">🇱🇹 Lituania</option>
                  <option value="MT">🇲🇹 Malta</option>
                  <option value="CY">🇨🇾 Cipro</option>
                </optgroup>
                <optgroup label="EFTA">
                  <option value="CH">🇨🇭 Svizzera</option>
                  <option value="NO">🇳🇴 Norvegia</option>
                  <option value="IS">🇮🇸 Islanda</option>
                  <option value="LI">🇱🇮 Liechtenstein</option>
                </optgroup>
                <optgroup label="UK">
                  <option value="GB">🇬🇧 Regno Unito</option>
                </optgroup>
              </select>
              {pickedCountry === "ES" && (
                <p className="mt-2 text-[11px] text-charcoal-muted bg-cream rounded-md px-2 py-1.5">
                  📍 Se risiedi nelle <strong>Isole Canarie, Ceuta o Melilla</strong>,
                  questi territori sono <em>fuori dalla zona IVA UE</em>:
                  l&apos;account Stripe sarà comunque ES, ma la nostra fattura
                  della commissione sarà emessa &ldquo;fuori campo IVA Art. 7-ter&rdquo;.
                  Indica il CAP esatto nei dati di fatturazione.
                </p>
              )}
            </div>
          )}
          {!stripe.connected && (
            <p className="mt-3 text-xs text-charcoal-muted bg-warning-light rounded-lg px-3 py-2">
              {t.settings.paymentsDesc}
            </p>
          )}
          {stripeError && (
            <p className="mt-2 text-xs text-error bg-error-light rounded-lg px-3 py-2">
              {stripeError}
            </p>
          )}
        </div>
      </div>

      {/* VAT & Country — shown when Stripe is connected */}
      {stripe.connected && (
        <div className="animate-reveal space-y-3" style={{ animationDelay: "60ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.vatSection}</h2>
          <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
            {/* Detected country */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-berry-subtle/30">
                <MapPin className="h-4 w-4 text-berry" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-charcoal-muted">{t.settings.detectedCountry}</p>
                <p className="text-sm font-semibold text-charcoal">
                  {stripeCountry ? stripeCountry.toUpperCase() : t.settings.countryNotDetected}
                  {feeConfig && <span className="ml-2 text-xs font-normal text-charcoal-muted">({feeConfig.region})</span>}
                </p>
              </div>
            </div>

            {/* VAT number input — only for EU/UK therapists */}
            {showVatSection && (
              <div className="space-y-2 pt-2 border-t border-berry/5">
                <p className="text-xs text-charcoal-muted">{t.settings.vatSectionDesc}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={vatInput}
                    onChange={(e) => setVatInput(e.target.value.toUpperCase())}
                    placeholder={t.settings.vatNumberPlaceholder}
                    className="flex-1 rounded-lg border border-berry/10 bg-white/80 px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-muted/40 focus:border-berry/30 focus:outline-none focus:ring-1 focus:ring-berry/20"
                  />
                  <button
                    onClick={validateVat}
                    disabled={vatValidating || !vatInput.trim()}
                    className="flex items-center gap-1.5 rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark transition-all disabled:opacity-50"
                  >
                    {vatValidating ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <FileCheck className="h-3.5 w-3.5" />
                    )}
                    {vatValidating ? t.settings.vatValidating : t.settings.vatValidate}
                  </button>
                </div>
                {/* Validation result */}
                {vatResult?.valid === true && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {t.settings.vatValid}: {vatNumber}
                  </p>
                )}
                {vatResult?.valid === false && (
                  <p className="text-xs text-error">{vatResult.error || t.settings.vatInvalid}</p>
                )}
                {vatResult?.error && vatResult.valid === undefined && (
                  <p className="text-xs text-warning">{vatResult.error}</p>
                )}
                {/* Last validated date */}
                {vatValidatedAt && !vatResult && (
                  <p className="text-[11px] text-charcoal-muted/60">
                    {t.settings.vatLastValidated}: {new Date(vatValidatedAt).toLocaleDateString()}
                    {vatNumber && ` — ${vatNumber}`}
                  </p>
                )}
              </div>
            )}

            {/* Non-VAT regions info */}
            {feeConfig && !feeConfig.requiresVatNumber && stripeCountry && (
              <p className="text-xs text-charcoal-muted/60 pt-2 border-t border-berry/5">
                {t.settings.vatNotRequired}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Fatturazione elettronica (Italia) */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "70ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
          Fatturazione elettronica
        </h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm divide-y divide-berry/5">
          <Link
            href="/dashboard/billing"
            className="flex items-center justify-between p-4 hover:bg-berry-subtle/20 transition-all"
          >
            <div className="flex items-center gap-3">
              <FileCheck className="h-4 w-4 text-charcoal-muted" />
              <div>
                <p className="text-sm font-medium text-charcoal">Dati di fatturazione</p>
                <p className="text-xs text-charcoal-muted">
                  P.IVA, codice destinatario SDI, indirizzo
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-charcoal-muted" />
          </Link>
          <Link
            href="/dashboard/invoices"
            className="flex items-center justify-between p-4 hover:bg-berry-subtle/20 transition-all"
          >
            <div className="flex items-center gap-3">
              <Receipt className="h-4 w-4 text-charcoal-muted" />
              <div>
                <p className="text-sm font-medium text-charcoal">Fatture commissione</p>
                <p className="text-xs text-charcoal-muted">
                  Storico fatture mensili emesse da Storm X Digital
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-charcoal-muted" />
          </Link>
        </div>
      </div>

      {/* Email Notification Preferences */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "80ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.notificationPrefs}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-4 w-4 text-berry" />
            <p className="text-sm font-semibold text-charcoal">{t.settings.emailNotifications}</p>
          </div>
          <p className="text-xs text-charcoal-muted mb-4">{t.settings.notificationPrefsDesc}</p>
          <div className="space-y-3">
            {[
              { key: "email_bookings" as const, label: t.settings.notifBookings },
              { key: "email_messages" as const, label: t.settings.notifMessages },
              { key: "email_payments" as const, label: t.settings.notifPayments },
              { key: "email_reminders" as const, label: t.settings.notifReminders },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-1">
                <p className="text-sm text-charcoal">{item.label}</p>
                <Toggle
                  checked={emailPrefs[item.key]}
                  onChange={() => updateEmailPref(item.key)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Sync */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "120ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.calendarSync}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-4 w-4 text-berry" />
              <p className="text-sm font-semibold text-charcoal">{t.settings.calendarSync}</p>
            </div>
            <p className="text-xs text-charcoal-muted">{t.settings.calendarSyncDesc}</p>
          </div>

          {/* iCal Feed */}
          <div className="rounded-xl border border-berry/10 bg-berry-subtle/20 p-4 space-y-2">
            <p className="text-xs font-semibold text-charcoal">{t.settings.icalFeed}</p>
            <p className="text-[11px] text-charcoal-muted">{t.settings.icalFeedDesc}</p>
            {icalUrl ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={icalUrl}
                  className="flex-1 rounded-lg border border-berry/10 bg-white/80 px-3 py-1.5 text-[11px] text-charcoal-muted font-mono truncate"
                />
                <button
                  onClick={copyIcalUrl}
                  className="flex items-center gap-1 rounded-lg border border-berry/20 px-3 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
                >
                  {icalCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {icalCopied ? t.settings.copied : t.settings.copyLink}
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-charcoal-muted/60 italic">{t.common.loading}</p>
            )}
            <p className="text-[10px] text-charcoal-muted/50">{t.settings.icalInstructions}</p>
          </div>

          {/* Google Calendar */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-charcoal">{t.settings.googleCalendar}</p>
              {googleIntegration ? (
                <p className="text-xs text-success flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {t.settings.calendarConnectedAs} {googleIntegration.calendar_email}
                </p>
              ) : (
                <p className="text-xs text-charcoal-muted">{t.settings.googleCalendarDesc}</p>
              )}
            </div>
            {googleIntegration ? (
              <button
                onClick={() => disconnectCalendar("google")}
                disabled={disconnecting === "google"}
                className="flex items-center gap-1 rounded-full border border-error/20 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/5 transition-all disabled:opacity-50"
              >
                <Unlink className="h-3 w-3" />
                {disconnecting === "google" ? t.settings.googleDisconnecting : t.settings.googleDisconnect}
              </button>
            ) : (
              <a
                href="/api/calendar/google/authorize"
                className="flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-all"
              >
                <LinkIcon className="h-3 w-3" />
                {t.settings.googleConnect}
              </a>
            )}
          </div>

          {/* Microsoft Outlook */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#0078D4" d="M21.17 2H7.83A1.83 1.83 0 0 0 6 3.83v4.34l8.74 3.04L24 7.83V3.83A1.83 1.83 0 0 0 21.17 2z"/><path fill="#0364B8" d="M24 7.83H6v5.09l8.74 2.4L24 12.92z"/><path fill="#0078D4" d="M6 12.92v5.25A1.83 1.83 0 0 0 7.83 20h13.34A1.83 1.83 0 0 0 24 18.17v-5.25H6z"/><path fill="#0A2767" opacity=".5" d="M14.4 6.58H6V19h8.4a1.41 1.41 0 0 0 1.4-1.4V8a1.41 1.41 0 0 0-1.4-1.42z"/><path fill="#0364B8" d="M13.2 7.83H6v11.34h7.2a1.41 1.41 0 0 0 1.4-1.4V9.23a1.41 1.41 0 0 0-1.4-1.4z"/><path fill="#0078D4" d="M13.2 7.83H6v9.84h7.2a1.41 1.41 0 0 0 1.4-1.4V9.23a1.41 1.41 0 0 0-1.4-1.4z"/><path fill="#0A2767" d="M0 7.83h13.2a1.41 1.41 0 0 1 1.4 1.4v7.54a1.41 1.41 0 0 1-1.4 1.4H0a1.41 1.41 0 0 1-1.4-1.4V9.23A1.41 1.41 0 0 1 0 7.83z" transform="translate(1.4)"/><path fill="white" d="M4.06 10.59a3.34 3.34 0 0 1 1.28-1.35 3.76 3.76 0 0 1 1.97-.5 3.47 3.47 0 0 1 1.8.46 3.11 3.11 0 0 1 1.2 1.28 4.05 4.05 0 0 1 .42 1.88 4.26 4.26 0 0 1-.44 1.97 3.18 3.18 0 0 1-1.24 1.34 3.56 3.56 0 0 1-1.84.48 3.5 3.5 0 0 1-1.82-.47 3.14 3.14 0 0 1-1.2-1.3 4.1 4.1 0 0 1-.43-1.9 4.2 4.2 0 0 1 .3-1.89zm1.52 3.1a1.88 1.88 0 0 0 .66.73 1.72 1.72 0 0 0 .97.27 1.77 1.77 0 0 0 1.02-.3 1.9 1.9 0 0 0 .65-.83 3.08 3.08 0 0 0 .23-1.22 2.92 2.92 0 0 0-.24-1.22 1.86 1.86 0 0 0-.67-.8 1.77 1.77 0 0 0-1-.28 1.73 1.73 0 0 0-.99.28 1.94 1.94 0 0 0-.65.81 3.02 3.02 0 0 0-.23 1.2 3.05 3.05 0 0 0 .25 1.36z"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-charcoal">{t.settings.outlookCalendar}</p>
              {microsoftIntegration ? (
                <p className="text-xs text-success flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {t.settings.calendarConnectedAs} {microsoftIntegration.calendar_email}
                </p>
              ) : (
                <p className="text-xs text-charcoal-muted">{t.settings.outlookCalendarDesc}</p>
              )}
            </div>
            {microsoftIntegration ? (
              <button
                onClick={() => disconnectCalendar("microsoft")}
                disabled={disconnecting === "microsoft"}
                className="flex items-center gap-1 rounded-full border border-error/20 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/5 transition-all disabled:opacity-50"
              >
                <Unlink className="h-3 w-3" />
                {disconnecting === "microsoft" ? t.settings.outlookDisconnecting : t.settings.outlookDisconnect}
              </button>
            ) : (
              <a
                href="/api/calendar/microsoft/authorize"
                className="flex items-center gap-1.5 rounded-full bg-[#0078D4] px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#006CBE] transition-all"
              >
                <LinkIcon className="h-3 w-3" />
                {t.settings.outlookConnect}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "160ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.language}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="h-4 w-4 text-berry" />
            <p className="text-sm font-semibold text-charcoal">{t.settings.language}</p>
          </div>
          <p className="text-xs text-charcoal-muted mb-4">{t.settings.languageDesc}</p>
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
      </div>

      {/* Security — 2FA opt-in */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "150ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.security}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${
                mfaEnrolled ? "bg-success/10 text-success" : "bg-charcoal/5 text-charcoal-muted"
              }`}
            >
              {mfaEnrolled ? (
                <ShieldCheck className="h-5 w-5" strokeWidth={1.5} />
              ) : (
                <Shield className="h-5 w-5" strokeWidth={1.5} />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-charcoal">
                {t.settings.mfaTitle}
                {mfaEnrolled && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">
                    <CheckCircle className="h-2.5 w-2.5" />
                    {t.settings.mfaActive}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-charcoal-muted">
                {mfaEnrolled ? t.settings.mfaActiveDesc : t.settings.mfaInactiveDesc}
              </p>
              {mfaError && (
                <p className="mt-2 text-xs text-error">{mfaError}</p>
              )}
            </div>
          </div>

          {!mfaEnrolled && (
            <Link
              href="/enroll-mfa"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark"
            >
              <Shield className="h-3.5 w-3.5" />
              {t.settings.mfaEnableCta}
            </Link>
          )}

          {mfaEnrolled && !confirmDisableMfa && (
            <button
              type="button"
              onClick={() => setConfirmDisableMfa(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-error/20 px-4 py-2 text-xs font-medium text-error transition-all hover:bg-error/5"
            >
              {t.settings.mfaDisableCta}
            </button>
          )}

          {mfaEnrolled && confirmDisableMfa && (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning-light/40 p-3">
              <p className="text-xs text-charcoal-light">
                {t.settings.mfaDisableConfirm}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleDisableMfa}
                  disabled={mfaLoading}
                  className="rounded-full bg-error px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-error/90 disabled:opacity-50"
                >
                  {mfaLoading ? t.common.loading : t.settings.mfaDisableYes}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisableMfa(false)}
                  className="rounded-full px-4 py-1.5 text-xs font-medium text-charcoal-muted hover:bg-charcoal/5"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Account */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "160ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.account}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm divide-y divide-berry/5">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-charcoal-muted" />
              <div>
                <p className="text-sm font-medium text-charcoal">{t.profile.email}</p>
                <p className="text-xs text-charcoal-muted">{userEmail}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-charcoal-muted" />
              <p className="text-sm text-charcoal">{t.settings.accountDesc}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-charcoal-muted" />
          </div>
        </div>
      </div>

      {/* Support */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "200ms" }}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">{t.settings.support}</h2>
        <div className="rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm divide-y divide-berry/5">
          <a href="mailto:support@holisticunity.app" className="flex items-center justify-between p-4 hover:bg-berry-subtle/20 transition-all">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-4 w-4 text-charcoal-muted" />
              <p className="text-sm text-charcoal">{t.settings.contactSupport}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-charcoal-muted" />
          </a>
          <a href="https://holisticunity.app/help" target="_blank" rel="noopener" className="flex items-center justify-between p-4 hover:bg-berry-subtle/20 transition-all">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-4 w-4 text-charcoal-muted" />
              <p className="text-sm text-charcoal">{t.settings.helpCenter}</p>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-charcoal-muted" />
          </a>
        </div>
      </div>

      {/* Delete Account */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "240ms" }}>
        <div className="rounded-2xl border border-error/10 bg-error/5 p-5">
          <p className="text-sm font-semibold text-error mb-1">{t.settings.deleteAccount}</p>
          <p className="text-xs text-charcoal-muted mb-2">{t.settings.deleteAccountWarning}</p>
          <a
            href="mailto:support@holisticunity.app?subject=Delete%20Account%20Request"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-error hover:underline"
          >
            <Mail className="h-3 w-3" />
            {t.settings.contactSupport}
          </a>
        </div>
      </div>

      {/* Version */}
      <div className="animate-reveal text-center py-4" style={{ animationDelay: "280ms" }}>
        <p className="text-[11px] text-charcoal-muted/50">Holistic Unity Therapist Portal v1.0.0</p>
      </div>
    </div>
  );
}
