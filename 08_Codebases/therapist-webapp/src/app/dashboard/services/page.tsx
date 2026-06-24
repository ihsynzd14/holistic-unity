"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Briefcase, Plus, Pencil, Trash2, Clock, Video,
  X, Check, Package, Sparkles, GripVertical, ToggleLeft, ToggleRight, Star,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

// Session format removed V1 — platform is virtual-only. See docs/flows/09-video-call.md

type TherapistService = {
  id: string;
  therapist_id: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  is_intro_call: boolean;
  is_active: boolean;
  pack_size: number | null;
  pack_price: number | null;
};

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120];
const CATEGORY_OPTIONS = [
  { value: "ThetaHealing", label: "ThetaHealing" },
  { value: "Reiki a Distanza", label: "Reiki a Distanza" },
  { value: "Family Constellation", label: "Costellazioni Familiari" },
  { value: "Systemic Constellation", label: "Costellazioni Sistemiche" },
  { value: "Naturopathy", label: "Naturopatia" },
  { value: "Ayurveda Consultation", label: "Consulenza Ayurveda" },
  { value: "Astrology", label: "Astrologia" },
  { value: "Human Design", label: "Human Design" },
  { value: "Numerology", label: "Numerologia" },
  // Sciamanesimo added 2026-05-13 alongside the practice row in DB.
  // Laura Meraviglia report 2026-05-14: had set "sciamanesimo" in her
  // profile categories but the dropdown when creating a service was
  // missing the option — discoverable mismatch between the profile
  // editor's THERAPY_CATEGORIES and this services-page CATEGORY_OPTIONS.
  // Keeping the two lists in sync until the day we move them to a
  // shared module (or read directly from `practices.slug`).
  { value: "Shamanism", label: "Sciamanesimo" },
  { value: "SEED – Energy Process", label: "SEED – Energy Process" },
  { value: "Quantum Touch Releasing", label: "Quantum Touch Releasing" },
];
const PACK_SIZES = [4, 6, 8, 10];

const emptyService: Omit<TherapistService, "id" | "therapist_id"> = {
  name: "",
  description: "",
  duration: 60,
  price: 0,
  category: "ThetaHealing",
  is_intro_call: false,
  is_active: true,
  pack_size: null,
  pack_price: null,
};

export default function ServicesPage() {
  const { t } = useI18n();
  const [services, setServices] = useState<TherapistService[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TherapistService | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyService);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currency, setCurrency] = useState("eur");
  const [saveError, setSaveError] = useState("");
  // Cached therapist user id — used to scope all mutations with
  // `.eq("therapist_id", therapistId)` as defence-in-depth in case RLS
  // ever allowed updates by service id alone.
  const [therapistId, setTherapistId] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setTherapistId(user.id);

    // Bug fix: `category` was being requested but the column doesn't
    // exist (real name is `categories[]` array). PostgREST silently
    // 400'd the whole query → currency stayed unset → fee math used
    // EUR fallback even for non-EUR therapists. Now we read both
    // `currency` and the real `categories` array.
    const { data: profile } = await supabase
      .from("therapist_profiles")
      .select("currency, categories")
      .eq("id", user.id)
      .single();
    if (profile?.currency) setCurrency(profile.currency);

    // Seed the system-managed Free Introductory Call once per therapist.
    // Idempotent: skipped if a row with is_intro_call=true already exists.
    const { count: introCount } = await supabase
      .from("therapist_services")
      .select("id", { count: "exact", head: true })
      .eq("therapist_id", user.id)
      .eq("is_intro_call", true);

    if ((introCount ?? 0) === 0) {
      // Use the therapist's first declared category, falling back
      // to ThetaHealing if the array is empty.
      const seedCategory = profile?.categories?.[0] || "ThetaHealing";
      await supabase.from("therapist_services").insert({
        therapist_id: user.id,
        name: "Free Introductory Call",
        description: "A 15-minute introductory call to discuss your needs and see if we're a good fit.",
        duration: 15,
        price: 0,
        category: seedCategory,
        is_intro_call: true,
        is_active: false, // therapist opts in via the row toggle
        pack_size: null,
        pack_price: null,
      });
    }

    const { data } = await supabase
      .from("therapist_services")
      .select("*")
      .eq("therapist_id", user.id)
      .order("is_intro_call", { ascending: false })
      .order("created_at", { ascending: true });

    setServices(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const currSymbol = currency === "eur" ? "€" : currency === "usd" ? "$" : currency === "gbp" ? "£" : "R$";

  function openCreate() {
    setForm(emptyService);
    setCreating(true);
    setEditing(null);
  }

  function openEdit(service: TherapistService) {
    setForm({
      name: service.name,
      description: service.description,
      duration: service.duration,
      price: service.price,
      category: service.category,
      is_intro_call: service.is_intro_call,
      is_active: service.is_active,
      pack_size: service.pack_size,
      pack_price: service.pack_price,
    });
    setEditing(service);
    setCreating(false);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setForm(emptyService);
  }

  async function saveService() {
    setSaving(true);
    setSaveError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      // `is_intro_call` is system-managed: every therapist gets a single
      // "Free Introductory Call" service auto-created at signup, which they
      // can only enable/disable + tweak via the row's toggle/pencil.
      // Manually-created services are always regular sessions (is_intro_call = false).
      // When editing the intro-call row we preserve its flag (and force price 0).
      const isIntroCallRow = editing?.is_intro_call === true;

      const payload = {
        therapist_id: user.id,
        name: form.name.trim(),
        description: form.description.trim(),
        duration: form.duration,
        price: isIntroCallRow ? 0 : form.price,
        category: form.category,
        is_intro_call: isIntroCallRow,
        is_active: form.is_active,
        // Intro calls don't support packs — they're always single sessions.
        pack_size: isIntroCallRow ? null : form.pack_size,
        pack_price: isIntroCallRow ? null : form.pack_price,
      };

      if (editing) {
        // Defence-in-depth: also scope the update by therapist_id so a
        // bug in RLS can't let a therapist edit another's service.
        const updateQuery = supabase.from("therapist_services").update(payload).eq("id", editing.id);
        const { error } = therapistId
          ? await updateQuery.eq("therapist_id", therapistId)
          : await updateQuery;
        if (error) throw error;
      } else {
        const { error } = await supabase.from("therapist_services").insert(payload);
        if (error) throw error;
      }

      closeForm();
      fetchServices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save service");
    } finally {
      setSaving(false);
    }
  }

  async function deleteService(id: string) {
    const service = services.find((s) => s.id === id);
    if (service?.is_intro_call) {
      setSaveError("La chiamata conoscitiva non può essere eliminata. Puoi disattivarla.");
      return;
    }
    setDeleting(id);
    setSaveError("");
    try {
      const supabase = createClient();
      // Defence-in-depth: scope by therapist_id so RLS bugs can't let a
      // therapist delete another's service.
      const deleteQuery = supabase.from("therapist_services").delete().eq("id", id);
      const { error } = therapistId
        ? await deleteQuery.eq("therapist_id", therapistId)
        : await deleteQuery;
      if (error) {
        if (error.message?.includes("violates foreign key") || error.code === "23503") {
          throw new Error("Non puoi eliminare un servizio con prenotazioni esistenti. Puoi disattivarlo.");
        }
        throw error;
      }
      fetchServices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore nell'eliminare il servizio");
    } finally {
      setDeleting(null);
    }
  }

  async function toggleServiceActive(id: string, currentActive: boolean) {
    setSaveError("");
    try {
      const supabase = createClient();
      // Defence-in-depth: scope by therapist_id.
      const toggleQuery = supabase
        .from("therapist_services")
        .update({ is_active: !currentActive })
        .eq("id", id);
      const { error } = therapistId
        ? await toggleQuery.eq("therapist_id", therapistId)
        : await toggleQuery;
      if (error) throw error;
      fetchServices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore nell'aggiornare il servizio");
    }
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  const showForm = creating || editing;

  return (
    <div className="space-y-8">
      <div className="animate-reveal flex items-center justify-between">
        <div>
          <DisplayHeading>{t.services.title}</DisplayHeading>
          <p className="mt-1 text-sm text-charcoal-muted">{t.services.subtitle}</p>
          {saveError && (
            <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
              <X className="h-4 w-4" /> {saveError}
            </p>
          )}
        </div>
        {!showForm && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            {t.services.newService}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="animate-reveal rounded-2xl border border-berry/10 bg-white/80 p-6 shadow-md backdrop-blur-sm">
          <div className="mb-6 flex items-center justify-between">
            <DisplayHeading as="h2" size="md">
              {editing ? t.services.editService : t.services.newService}
            </DisplayHeading>
            <button onClick={closeForm} className="rounded-xl p-2 text-charcoal-muted hover:bg-berry-subtle/50 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Name */}
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.services.serviceName}</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t.services.serviceNamePlaceholder}
                className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.services.description}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder={t.services.descriptionPlaceholder}
                className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all resize-none"
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.services.category}</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
              >
                {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            {/* Format removed V1 — all sessions are virtual (see docs/flows/09-video-call.md) */}

            {/* Duration */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.services.duration}</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm({ ...form, duration: d })}
                    className={`rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${
                      form.duration === d
                        ? "bg-berry text-white shadow-md shadow-berry/15"
                        : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
                    }`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.services.price} ({currSymbol})</label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.price || ""}
                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                placeholder="80"
                className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
              />
            </div>

            {/* Read-only intro-call notice (only when editing the system-managed Free Intro Call row) */}
            {editing?.is_intro_call && (
              <div className="md:col-span-2 flex items-start gap-3 rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
                <Sparkles className="h-4 w-4 text-gold mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-charcoal">{t.services.introCall}</p>
                  <p className="text-xs text-charcoal-muted mt-0.5">
                    {t.services.introCallDesc} {t.services.introCallSystemNote}
                  </p>
                </div>
              </div>
            )}

            {/* Pack — hidden for intro calls (always single session) */}
            {!editing?.is_intro_call && (
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <Package className="h-4 w-4 text-berry" />
                <label className="text-xs font-semibold text-charcoal-muted">{t.services.packSessions}</label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, pack_size: null, pack_price: null })}
                  className={`rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                    !form.pack_size
                      ? "bg-berry text-white shadow-md shadow-berry/15"
                      : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
                  }`}
                >
                  {t.services.packNone}
                </button>
                {PACK_SIZES.map((ps) => (
                  <button
                    key={ps}
                    type="button"
                    onClick={() => setForm({ ...form, pack_size: ps })}
                    className={`rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                      form.pack_size === ps
                        ? "bg-berry text-white shadow-md shadow-berry/15"
                        : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
                    }`}
                  >
                    {ps} {t.services.packSessions_label}
                  </button>
                ))}
              </div>
              {form.pack_size && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">
                    {t.services.packPricePerSession} ({currSymbol})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.pack_price || ""}
                    onChange={(e) => setForm({ ...form, pack_price: parseFloat(e.target.value) || 0 })}
                    placeholder={`es. ${Math.round((form.price || 80) * 0.85)}`}
                    className="w-full max-w-xs rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                  />
                  {form.pack_price && form.price > 0 && (
                    <p className="mt-1 text-xs text-success font-medium">
                      {t.services.packDiscount} {Math.round((1 - form.pack_price / form.price) * 100)}% — {t.services.packTotal}: {currSymbol}{(form.pack_price * form.pack_size).toFixed(2)}
                    </p>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Save / Cancel */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button onClick={closeForm} className="rounded-xl px-5 py-2.5 text-sm font-medium text-charcoal-muted hover:bg-charcoal/5 transition-all">
              {t.common.cancel}
            </button>
            <button
              onClick={saveService}
              disabled={saving || !form.name.trim() || (!editing?.is_intro_call && form.price <= 0)}
              className="flex items-center gap-2 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark disabled:opacity-50"
            >
              {saving ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <Check className="h-4 w-4" />
              )}
              {editing ? t.services.saveChanges : t.services.createService}
            </button>
          </div>
        </div>
      )}

      {/* Services list */}
      {services.length === 0 && !showForm ? (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center" style={{ animationDelay: "80ms" }}>
          <Briefcase className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">{t.services.noServices}</p>
          <p className="mt-1 text-sm text-charcoal-muted/70">{t.services.noServicesDesc}</p>
          <button
            onClick={openCreate}
            className="mt-4 flex items-center gap-2 mx-auto rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark"
          >
            <Plus className="h-4 w-4" />
            {t.services.addFirst}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((service, i) => {
            return (
              <div
                key={service.id}
                className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
                style={{ animationDelay: `${80 + i * 40}ms` }}
              >
                <div className={`flex items-start gap-4 ${!service.is_active ? "opacity-50" : ""}`}>
                  {/* Icon (Video icon since all sessions are virtual) */}
                  <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${
                    service.is_intro_call ? "bg-gold/10 text-gold" : "bg-berry-subtle text-berry"
                  }`}>
                    {service.is_intro_call ? (
                      <Sparkles className="h-5 w-5" strokeWidth={1.5} />
                    ) : (
                      <Video className="h-5 w-5" strokeWidth={1.5} />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-charcoal">{service.name}</p>
                      {service.is_intro_call && (
                        <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
                          INTRO
                        </span>
                      )}
                      <span className="rounded-full bg-berry-subtle px-2 py-0.5 text-[10px] font-medium text-berry">
                        {CATEGORY_OPTIONS.find((c) => c.value === service.category)?.label || service.category}
                      </span>
                      {!service.is_active && (
                        <span className="rounded-full bg-charcoal/10 px-2 py-0.5 text-[10px] font-medium text-charcoal-muted">
                          Disattivato
                        </span>
                      )}
                      {service.is_intro_call && service.is_active && (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5" /> Consigliato
                        </span>
                      )}
                    </div>
                    {service.description && (
                      <p className="mt-1 text-xs text-charcoal-muted line-clamp-2">{service.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-charcoal-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {service.duration} min
                      </span>
                      {service.pack_size && (
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" /> {t.services.packLabel} {service.pack_size} {t.services.sessions}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Price + Actions */}
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-lg font-bold text-charcoal">
                        {service.is_intro_call && service.price === 0 ? t.services.free : `${currSymbol}${service.price.toFixed(0)}`}
                      </p>
                      {service.pack_size && service.pack_price && (
                        <p className="text-[10px] text-success font-medium">
                          {currSymbol}{service.pack_price.toFixed(0)}/{t.services.sessions} x{service.pack_size}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Activate/Deactivate toggle */}
                      <button
                        onClick={() => toggleServiceActive(service.id, service.is_active)}
                        title={service.is_active ? "Disattiva servizio" : "Attiva servizio"}
                        className={`rounded-lg p-1.5 transition-all ${
                          service.is_active
                            ? "text-success hover:bg-success/10"
                            : "text-charcoal-muted hover:bg-charcoal/5"
                        }`}
                      >
                        {service.is_active ? (
                          <ToggleRight className="h-4 w-4" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openEdit(service)}
                        className="rounded-lg p-1.5 text-charcoal-muted hover:bg-berry-subtle/50 hover:text-berry transition-all"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {/* Hide delete button for intro call services */}
                      {!service.is_intro_call && (
                        <button
                          onClick={() => deleteService(service.id)}
                          disabled={deleting === service.id}
                          className="rounded-lg p-1.5 text-charcoal-muted hover:bg-error-light hover:text-error transition-all disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
