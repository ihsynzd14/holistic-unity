"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText, CheckCircle, AlertCircle, Loader2, Save,
  Receipt, ChevronRight, Globe2,
} from "lucide-react";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

interface BillingAddress {
  street: string;
  cap: string;
  city: string;
  province: string;
  country: string;
}

interface BillingData {
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  vat_number: string | null;
  vat_validated_at: string | null;
  tax_id_foreign: string | null;
  billing_email: string | null;
  billing_address: BillingAddress | null;
  fic_client_id: number | null;
}

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const COUNTRY_OPTIONS = [
  { code: "IT", label: "🇮🇹 Italia" },
  { code: "FR", label: "🇫🇷 Francia" },
  { code: "DE", label: "🇩🇪 Germania" },
  { code: "ES", label: "🇪🇸 Spagna" },
  { code: "NL", label: "🇳🇱 Paesi Bassi" },
  { code: "BE", label: "🇧🇪 Belgio" },
  { code: "AT", label: "🇦🇹 Austria" },
  { code: "PT", label: "🇵🇹 Portogallo" },
  { code: "IE", label: "🇮🇪 Irlanda" },
  { code: "GB", label: "🇬🇧 Regno Unito" },
  { code: "CH", label: "🇨🇭 Svizzera" },
  { code: "US", label: "🇺🇸 Stati Uniti" },
  { code: "CA", label: "🇨🇦 Canada" },
  { code: "AU", label: "🇦🇺 Australia" },
  { code: "BR", label: "🇧🇷 Brasile" },
  { code: "AR", label: "🇦🇷 Argentina" },
];

const emptyAddress: BillingAddress = {
  street: "", cap: "", city: "", province: "", country: "IT",
};

type Region = "IT_BUSINESS" | "IT_PRIVATE" | "EU" | "UK" | "ROW";

/**
 * Country-specific Tax ID label / hint / placeholder for the EU/UK
 * "local Tax ID" field. Falls back to a generic English label for
 * countries we haven't enumerated yet — better than showing "Tax ID"
 * to a Spanish therapist who's looking for "NIF".
 */
function localTaxIdLabel(country: string, region: Region): string {
  const c = (country || "").toUpperCase();
  if (c === "ES") return "NIF / NIE (codice fiscale spagnolo)";
  if (c === "FR") return "Numéro fiscal de référence";
  if (c === "DE") return "Steuer-Identifikationsnummer";
  if (c === "NL") return "Burgerservicenummer (BSN)";
  if (c === "PT") return "Número de Identificação Fiscal (NIF)";
  if (c === "BE") return "Numéro de Registre national";
  if (c === "AT") return "Steuernummer";
  if (c === "IE") return "PPS Number";
  if (c === "GB") return "UTR / National Insurance Number";
  return region === "UK" ? "Local Tax ID" : "Tax ID locale";
}
function localTaxIdHint(country: string): string {
  const c = (country || "").toUpperCase();
  if (c === "ES") return "8 cifre + 1 lettera (NIF) oppure X/Y/Z + 7 cifre + 1 lettera (NIE)";
  if (c === "FR") return "13 cifre rilasciate dall'amministrazione fiscale";
  if (c === "DE") return "11 cifre della Steuer-IdNr (non la USt-IdNr)";
  if (c === "GB") return "10 cifre UTR (per autonomi) o National Insurance Number (NI)";
  return "Codice fiscale nazionale rilasciato dal tuo paese";
}
function localTaxIdPlaceholder(country: string): string {
  const c = (country || "").toUpperCase();
  if (c === "ES") return "12345678Z";
  if (c === "FR") return "1234567890123";
  if (c === "DE") return "12345678901";
  if (c === "GB") return "1234567890";
  return "";
}

/**
 * Dashboard > Dati di fatturazione.
 *
 * Country-aware form. The set of fields rendered depends on:
 *   - the legal address country
 *   - whether the therapist has a P.IVA / VAT (B2B vs B2C)
 *
 * The save endpoint validates server-side and reflects the same
 * country-dependent rules (see `/api/billing/profile`).
 */
export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [linked, setLinked] = useState(false);

  // IT
  const [pIva, setPIva] = useState("");
  const [cf, setCf] = useState("");
  const [sdi, setSdi] = useState("");
  const [pec, setPec] = useState("");
  const [forfettario, setForfettario] = useState(false);
  // Cross-border
  const [vatNumber, setVatNumber] = useState("");
  const [vatValidatedAt, setVatValidatedAt] = useState<string | null>(null);
  const [taxIdForeign, setTaxIdForeign] = useState("");
  // Common
  const [billingEmail, setBillingEmail] = useState("");
  const [address, setAddress] = useState<BillingAddress>(emptyAddress);

  useEffect(() => { void load(); }, []);

  async function load() {
    setError("");
    try {
      const res = await fetch("/api/billing/profile");
      if (!res.ok) throw new Error("Caricamento fallito");
      const { data } = (await res.json()) as { data: BillingData | null };
      if (data) {
        setPIva(data.p_iva ?? "");
        setCf(data.codice_fiscale ?? "");
        setSdi(data.codice_destinatario ?? "");
        setPec(data.pec_email ?? "");
        setForfettario(!!data.regime_forfettario);
        setVatNumber(data.vat_number ?? "");
        setVatValidatedAt(data.vat_validated_at);
        setTaxIdForeign(data.tax_id_foreign ?? "");
        setBillingEmail(data.billing_email ?? "");
        setAddress(data.billing_address ?? emptyAddress);
        setLinked(!!data.fic_client_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  // Compute the active legal/fiscal region from country + P.IVA presence.
  const region: Region = useMemo(() => {
    const c = (address.country || "IT").toUpperCase();
    if (c === "IT") return pIva.trim() ? "IT_BUSINESS" : "IT_PRIVATE";
    if (c === "GB") return "UK";
    if (EU_COUNTRIES.has(c)) return "EU";
    return "ROW";
  }, [address.country, pIva]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSavedAt(null);
    try {
      const res = await fetch("/api/billing/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_iva: pIva,
          codice_fiscale: cf,
          codice_destinatario: sdi,
          pec_email: pec,
          regime_forfettario: forfettario,
          vat_number: vatNumber,
          tax_id_foreign: taxIdForeign,
          billing_email: billingEmail,
          billing_address: address,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Salvataggio fallito");
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Loader2 className="h-7 w-7 animate-spin text-berry" />
      </LoadingContainer>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="animate-reveal">
        <DisplayHeading>
          Dati di fatturazione
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          Necessari per emettere automaticamente la fattura della commissione mensile (20%).
        </p>
      </div>

      <RegionInfoBanner region={region} />

      <form onSubmit={handleSubmit} className="animate-reveal space-y-6" style={{ animationDelay: "80ms" }}>
        {/* COUNTRY first — drives the rest of the form */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
            Paese di residenza fiscale
          </h2>
          <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
            <Field label="Stato" required>
              <select
                value={address.country || "IT"}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
                className={inputCls}
                required
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* IT BUSINESS / IT PRIVATE: P.IVA + CF + SDI/PEC + forfettario */}
        {(region === "IT_BUSINESS" || region === "IT_PRIVATE") && (
          <>
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                Identità fiscale
              </h2>
              <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
                <Field label="Partita IVA" hint="11 cifre — vuoto se sei privato/occasionale">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={11}
                    value={pIva}
                    onChange={(e) => setPIva(e.target.value.replace(/\D/g, ""))}
                    placeholder="01234567890"
                    className={inputCls}
                  />
                </Field>
                <Field
                  label="Codice fiscale"
                  hint={region === "IT_PRIVATE" ? "Obbligatorio se non hai P.IVA" : "Solo se diverso dalla P.IVA"}
                  required={region === "IT_PRIVATE"}
                >
                  <input
                    type="text"
                    maxLength={16}
                    value={cf}
                    onChange={(e) => setCf(e.target.value.toUpperCase())}
                    placeholder="RSSMRA80A01H501Z"
                    className={inputCls}
                    required={region === "IT_PRIVATE"}
                  />
                </Field>
                {region === "IT_BUSINESS" && (
                  <label className="flex items-start gap-3 rounded-xl border border-berry/10 bg-berry-subtle/20 p-3 text-xs text-charcoal-light cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forfettario}
                      onChange={(e) => setForfettario(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-semibold text-charcoal">Regime forfettario</span> (L. 190/2014)
                      <br />
                      <span className="text-charcoal-muted">
                        Fattura emessa senza IVA con dicitura art. 1 c. 54-89.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </section>

            {region === "IT_BUSINESS" && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                  Recapito fattura elettronica
                </h2>
                <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
                  <p className="text-xs text-charcoal-muted">
                    Indica almeno uno dei due — il codice destinatario ha priorità se presente.
                  </p>
                  <Field label="Codice destinatario SDI" hint="7 caratteri alfanumerici">
                    <input
                      type="text"
                      maxLength={7}
                      value={sdi}
                      onChange={(e) => setSdi(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      placeholder="M5UXCR1"
                      className={`${inputCls} font-mono uppercase tracking-wider`}
                    />
                  </Field>
                  <Field label="Indirizzo PEC" hint="Se non hai un codice destinatario">
                    <input
                      type="email"
                      value={pec}
                      onChange={(e) => setPec(e.target.value.toLowerCase())}
                      placeholder="nome@pec.it"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </section>
            )}

            {region === "IT_PRIVATE" && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                  Recapito fattura
                </h2>
                <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
                  <p className="text-xs text-charcoal-muted mb-3">
                    La fattura sarà inviata via SDI con codice &ldquo;0000000&rdquo;: la
                    troverai nel tuo Cassetto fiscale dell&apos;Agenzia Entrate.
                    Inserisci facoltativamente un&apos;email per ricevere copia di cortesia in PDF.
                  </p>
                  <Field label="Email per copia cortesia" hint="Opzionale">
                    <input
                      type="email"
                      value={billingEmail}
                      onChange={(e) => setBillingEmail(e.target.value.toLowerCase())}
                      placeholder="nome@gmail.com"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </section>
            )}
          </>
        )}

        {/* EU / UK */}
        {(region === "EU" || region === "UK") && (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
              Identità fiscale {region === "UK" ? "UK" : "UE"}
            </h2>
            <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
              <Field
                label={region === "UK" ? "VAT Number UK (opzionale)" : "VAT Number UE (opzionale)"}
                hint={region === "UK" ? "Es. GB123456789 — solo se hai partita IVA UK" : "Es. FR12345678901 — solo se hai partita IVA UE"}
              >
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                  placeholder={region === "UK" ? "GB123456789" : "FR12345678901"}
                  className={`${inputCls} font-mono uppercase`}
                />
              </Field>
              {vatNumber && (
                <p className="text-[11px] text-charcoal-muted">
                  {vatValidatedAt
                    ? `✓ Validato il ${new Date(vatValidatedAt).toLocaleDateString("it-IT")}`
                    : "La validazione automatica avverrà alla prossima emissione fattura tramite VIES (UE) o HMRC (UK)."}
                </p>
              )}
              {/*
                Local Tax ID — covers the case where the therapist is NOT
                subject to VAT (private/occasional, Spanish residents in
                Canary Islands without IGIC obligation, German
                freelancers below the Kleinunternehmer threshold, etc.)
                and therefore has only a national tax id (NIF/NIE,
                Numéro fiscal, Steuer-IdNr, ...).
                The label adapts to the country so the therapist
                immediately recognises which document we're asking for.
                Optional when a VAT number is already entered, mandatory
                otherwise — at least one fiscal identifier is needed for
                the cross-border invoice.
              */}
              <Field
                label={localTaxIdLabel(address.country, region)}
                hint={localTaxIdHint(address.country)}
                required={!vatNumber}
              >
                <input
                  type="text"
                  value={taxIdForeign}
                  onChange={(e) => setTaxIdForeign(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                  placeholder={localTaxIdPlaceholder(address.country)}
                  className={`${inputCls} font-mono uppercase`}
                  required={!vatNumber}
                />
              </Field>
              <Field label="Email per ricezione fattura" required>
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value.toLowerCase())}
                  placeholder="billing@example.com"
                  className={inputCls}
                  required
                />
              </Field>
              <p className="text-[11px] text-charcoal-muted">
                {region === "UK"
                  ? "Con VAT UK valido: reverse charge ai sensi dell'Art. 7-ter DPR 633/72. Senza VAT (con solo Tax ID locale): IVA italiana 22% applicata."
                  : "Con VAT UE valido: reverse charge ai sensi dell'Art. 44 Direttiva 2006/112/CE. Senza VAT (con solo Tax ID locale): IVA italiana 22% applicata (regime OSS). Per residenti in Canarie/Ceuta/Melilla, Azzorre/Madeira o DOM-TOM la fattura sarà invece &ldquo;fuori campo IVA Art. 7-ter&rdquo;."}
              </p>
            </div>
          </section>
        )}

        {/* ROW (extra-EU) */}
        {region === "ROW" && (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
              Identità fiscale (Extra-UE)
            </h2>
            <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
              <Field label="Tax ID locale" hint="Es. EIN/SSN/ITIN (US), BN (CA), ABN (AU)" required>
                <input
                  type="text"
                  value={taxIdForeign}
                  onChange={(e) => setTaxIdForeign(e.target.value)}
                  placeholder="12-3456789"
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Email per ricezione fattura" required>
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value.toLowerCase())}
                  placeholder="billing@example.com"
                  className={inputCls}
                  required
                />
              </Field>
              <p className="text-[11px] text-charcoal-muted">
                Operazione fuori campo IVA — Art. 7-ter DPR 633/72. Fattura inviata in PDF all&apos;email indicata.
              </p>
            </div>
          </section>
        )}

        {/* Address — common to all regions */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
            Indirizzo legale
          </h2>
          <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm space-y-4">
            <Field label="Via e numero civico" required>
              <input
                type="text"
                value={address.street}
                onChange={(e) => setAddress({ ...address, street: e.target.value })}
                placeholder="Via Roma 1"
                className={inputCls}
                required
              />
            </Field>
            <div className={`grid gap-3 ${address.country === "IT" ? "grid-cols-3" : "grid-cols-2"}`}>
              <Field label={address.country === "IT" ? "CAP" : "Codice postale"} required={address.country === "IT"}>
                <input
                  type="text"
                  inputMode={address.country === "IT" ? "numeric" : "text"}
                  maxLength={address.country === "IT" ? 5 : 12}
                  value={address.cap}
                  onChange={(e) =>
                    setAddress({
                      ...address,
                      cap: address.country === "IT"
                        ? e.target.value.replace(/\D/g, "")
                        : e.target.value,
                    })
                  }
                  placeholder={address.country === "IT" ? "20100" : ""}
                  className={inputCls}
                  required={address.country === "IT"}
                />
              </Field>
              <Field label="Città" required>
                <input
                  type="text"
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  placeholder="Milano"
                  className={inputCls}
                  required
                />
              </Field>
              {address.country === "IT" && (
                <Field label="Prov." hint="2 lettere" required>
                  <input
                    type="text"
                    maxLength={2}
                    value={address.province}
                    onChange={(e) =>
                      setAddress({
                        ...address,
                        province: e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                      })
                    }
                    placeholder="MI"
                    className={`${inputCls} uppercase`}
                    required
                  />
                </Field>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl bg-error-light px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {savedAt && !error && (
          <div className="rounded-xl bg-success/10 px-4 py-3 text-sm text-success flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Dati salvati. La prossima fattura del 1° del mese verrà emessa con questi dati.
          </div>
        )}
        {linked && (
          <p className="text-[11px] text-charcoal-muted/70 flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Cliente FIC già collegato — modifiche minori a indirizzo/SDI saranno applicate alla prossima fattura.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/15 hover:bg-berry-dark transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Salvataggio…" : "Salva dati"}
        </button>
      </form>

      <Link
        href="/dashboard/invoices"
        className="animate-reveal flex items-center justify-between rounded-2xl border border-berry/10 bg-white/60 px-5 py-4 hover:bg-berry-subtle/30 transition-all"
        style={{ animationDelay: "200ms" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-berry-subtle/40">
            <Receipt className="h-4 w-4 text-berry" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-charcoal">Storico fatture commissione</p>
            <p className="text-xs text-charcoal-muted">Le fatture emesse da Storm X mensilmente</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-charcoal-muted" />
      </Link>
    </div>
  );
}

function RegionInfoBanner({ region }: { region: Region }) {
  const messages: Record<Region, { title: string; body: string }> = {
    IT_BUSINESS: {
      title: "Italia · B2B",
      body: "Storm X emette fattura elettronica via SDI il 1° del mese, con commissione 20% e IVA 22% inclusa (o senza IVA se in regime forfettario).",
    },
    IT_PRIVATE: {
      title: "Italia · Privato",
      body: "Senza P.IVA emettiamo fattura B2C tramite SDI con codice destinatario \"0000000\". La troverai nel tuo Cassetto Fiscale.",
    },
    EU: {
      title: "Unione Europea",
      body: "Con VAT valido (validato VIES): fattura senza IVA in reverse charge. Senza VAT: fattura con IVA italiana 22% (regime OSS).",
    },
    UK: {
      title: "Regno Unito",
      body: "Con VAT GB valido (validato HMRC): fattura senza IVA in reverse charge. Senza VAT: IVA italiana 22%.",
    },
    ROW: {
      title: "Extra-Unione Europea",
      body: "Operazione fuori campo IVA. Fattura emessa in PDF inviata all'email indicata.",
    },
  };
  const m = messages[region];
  return (
    <div
      className="animate-reveal rounded-2xl border border-berry/5 bg-berry-subtle/30 p-4 text-xs text-charcoal-light flex items-start gap-3"
      style={{ animationDelay: "40ms" }}
    >
      <Globe2 className="h-4 w-4 flex-shrink-0 text-berry mt-0.5" />
      <div>
        <p className="font-semibold text-berry-dark mb-1">{m.title}</p>
        <p>{m.body}</p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-berry/10 bg-white/80 px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-muted/40 focus:border-berry/30 focus:outline-none focus:ring-1 focus:ring-berry/20";

function Field({
  label, hint, required, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-charcoal">
          {label}
          {required && <span className="ml-0.5 text-berry">*</span>}
        </span>
        {hint && <span className="text-[10px] text-charcoal-muted/70">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
