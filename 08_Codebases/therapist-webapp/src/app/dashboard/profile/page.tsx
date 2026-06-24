"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Save, Camera, MapPin, Globe, Star, Shield, CheckCircle, Check,
  Plus, Trash2, Award, Video, ImageIcon, X, Languages, Briefcase,
  Clock as ClockIcon, AlertTriangle, Upload, Link2,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";
import { TierIcon, type TierKey } from "@/components/ui/TierIcon";
import { TierLabel } from "@/components/ui/TierLabel";
import { TierPendingBanner, type TierRequestStatus } from "@/components/ui/TierPendingBanner";

type Certificate = {
  id: string;
  name: string;
  issuing_organization: string;
  year_obtained: number;
  is_verified: boolean;
};

// Therapy categories — `value` is the language-neutral slug stored on
// `therapist_profiles.categories[]` (matches `practices.slug` in DB).
// `label` is the display string for THIS locale (Italian today). When
// the platform goes multilingual, replace the literal label with a
// translation lookup; the slug `value` stays stable forever.
//
// Adding a new category here without first adding it to the
// `practices` table will cause saves to fail at the DB level — the
// `validate_therapist_categories` trigger rejects any slug not in
// `practices.slug`. Add it in Supabase first, then here.
const THERAPY_CATEGORIES = [
  { value: "theta-healing", label: "ThetaHealing" },
  { value: "reiki", label: "Reiki" },
  { value: "costellazioni-familiari", label: "Costellazioni Familiari" },
  { value: "costellazioni-sistemiche", label: "Costellazioni Sistemiche" },
  { value: "naturopatia", label: "Naturopatia" },
  { value: "ayurveda", label: "Ayurveda" },
  { value: "astrologia", label: "Astrologia" },
  { value: "human-design", label: "Human Design" },
  { value: "numerologia", label: "Numerologia" },
  { value: "sciamanesimo", label: "Sciamanesimo" },
  { value: "seed-energy-process", label: "SEED – Energy Process" },
  { value: "quantum-touch-releasing", label: "Quantum Touch Releasing" },
];

const LANGUAGES = [
  { value: "Italian", label: "Italiano" },
  { value: "English", label: "Inglese" },
  { value: "French", label: "Francese" },
  { value: "Spanish", label: "Spagnolo" },
  { value: "German", label: "Tedesco" },
  { value: "Portuguese", label: "Portoghese" },
  { value: "Other", label: "Altro" },
];

// ISO 3166-1 alpha-2 list focused on launch markets.
// Feel free to extend as the platform scales.
const COUNTRIES = [
  { value: "IT", label: "Italia" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Deutschland" },
  { value: "ES", label: "España" },
  { value: "PT", label: "Portugal" },
  { value: "NL", label: "Nederland" },
  { value: "CH", label: "Switzerland" },
  { value: "AT", label: "Österreich" },
  { value: "BE", label: "Belgique" },
  { value: "IE", label: "Ireland" },
  { value: "SE", label: "Sverige" },
  { value: "NO", label: "Norge" },
  { value: "DK", label: "Danmark" },
  { value: "FI", label: "Suomi" },
  { value: "PL", label: "Polska" },
  { value: "CZ", label: "Česko" },
  { value: "GR", label: "Ελλάδα" },
  { value: "BR", label: "Brasil" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "JP", label: "日本" },
  { value: "MX", label: "México" },
  { value: "AR", label: "Argentina" },
  { value: "CO", label: "Colombia" },
  { value: "CL", label: "Chile" },
  { value: "RO", label: "România" },
  { value: "HU", label: "Magyarország" },
  { value: "TR", label: "Türkiye" },
];

const MAX_GALLERY_IMAGES = 6;
// Photo upload size limit. Original value was 5MB which was tight for
// modern smartphones — iPhone 14+ default JPEG at 12MP is routinely
// 4-8MB, and 48MP shots from iPhone 15 Pro can reach 15MB.
// Sara Barbieri reported 2026-05-09 that her uploads were failing; her
// existing successful avatar was already 2.49MB (close to old limit)
// and she had clearly tried a higher-resolution shot. Bumped to 10MB
// which comfortably covers >90% of modern phone JPEGs. The bucket
// itself has no server-side limit, so this client check is the only
// gate. If we keep seeing edge cases, the next step is client-side
// canvas resize to 1500×1500 max before upload.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_PHOTO_MB = MAX_PHOTO_BYTES / (1024 * 1024);
const PROFILE_BUCKET = "profile-photos";

// Bio length cap. Previously hard-coded to 500 (with silent slice on
// type), which was tight for professional bios — Marcello had 772
// chars saved from before the limit was imposed and the counter
// rendered "(772/500)" with no visual cue that it was over. Raised
// to 1500 (in line with LinkedIn About section) and the counter now
// shows red when over, with the save handler refusing instead of
// silently truncating.
const MAX_BIO_CHARS = 1500;

// ── Video intro URL parsing ─────────────────────────────────────────
//
// The video_intro_url field is a YouTube/Vimeo URL — NOT an upload.
// The client app at dashboard/therapists/[id] mirrors this parsing
// (videoEmbedUrl + parseYouTubeId in that file) and rejects anything
// outside this allowlist. We replicate the parser here so that:
//   1. We can give the therapist live feedback (✓ valid / ✗ invalid)
//      as they type, rather than letting them save garbage that the
//      client app then silently refuses to render.
//   2. We can show a thumbnail preview confirming "this is the right
//      video". Luz Elsy Duarte (2026-05-07) accidentally pasted an
//      iOS PHAsset identifier into this field — a live preview would
//      have caught it immediately.
//   3. We can refuse save() on invalid input, removing the "fills in
//      → saves → silently broken on profile detail page" failure mode.
function parseYouTubeId(u: URL): string | null {
  if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
  if (u.pathname.startsWith("/embed/")) return u.pathname.slice(7).split("/")[0] || null;
  if (u.pathname.startsWith("/shorts/")) return u.pathname.slice(8).split("/")[0] || null;
  return u.searchParams.get("v");
}

type VideoIntroParseResult =
  | { valid: false; reason: "empty" }
  | { valid: false; reason: "malformed_url" }
  | { valid: false; reason: "unsupported_host"; host: string }
  | { valid: false; reason: "missing_id" }
  | { valid: true; provider: "youtube" | "vimeo"; id: string; thumbnailUrl: string | null };

function parseVideoIntroUrl(input: string): VideoIntroParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, reason: "empty" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { valid: false, reason: "malformed_url" };
  }
  // YouTube
  if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
    const id = parseYouTubeId(u);
    if (!id) return { valid: false, reason: "missing_id" };
    return {
      valid: true,
      provider: "youtube",
      id,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }
  // Vimeo
  if (u.hostname.includes("vimeo.com")) {
    const m = u.pathname.match(/\/(\d+)/);
    if (!m) return { valid: false, reason: "missing_id" };
    return {
      valid: true,
      provider: "vimeo",
      id: m[1],
      // Vimeo thumbnails require an async oEmbed call — we skip the
      // preview thumbnail for Vimeo and just confirm "valid Vimeo
      // link" via the green check + provider label.
      thumbnailUrl: null,
    };
  }
  return { valid: false, reason: "unsupported_host", host: u.hostname };
}

export default function ProfilePage() {
  const { t, locale } = useI18n();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  // Tier lives on the base `therapist_profiles` table — the
  // `my_therapist_profile` view doesn't include it (would need a
  // DROP + CREATE to pick up the new column), so we fetch it
  // separately. RLS on the base table already lets a therapist read
  // their own row.
  const [tier, setTier] = useState<TierKey | null>(null);
  // Self-declared tier the therapist wants to be promoted to. Admin
  // reviews and either flips `tier` to match (approved) or leaves it
  // alone (rejected). `requested_tier` and `tier_request_status` live
  // on the same row as `tier`, fetched in the same query.
  const [requestedTier, setRequestedTier] = useState<TierKey | null>(null);
  const [tierRequestStatus, setTierRequestStatus] =
    useState<TierRequestStatus | null>(null);
  // Local form state for the selector — defaults to whatever is in the
  // DB (so the radio shows the current claim, not a blank slate).
  const [selectedRequestTier, setSelectedRequestTier] = useState<TierKey | null>(null);
  const [submittingTierRequest, setSubmittingTierRequest] = useState(false);
  const [tierRequestError, setTierRequestError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Public profile slug (read from therapist_profiles) + copy-link toast.
  const [slug, setSlug] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [certifications, setCertifications] = useState<Certificate[]>([]);
  const [showCertForm, setShowCertForm] = useState(false);
  const [certForm, setCertForm] = useState({ name: "", issuing_organization: "", year_obtained: new Date().getFullYear() });
  const [serviceCount, setServiceCount] = useState(0);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [yearsExperience, setYearsExperience] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["Italian"]);
  const [videoIntroUrl, setVideoIntroUrl] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);

  // Upload state
  const [photoUploading, setPhotoUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const loadProfile = useCallback(async () => {
    const supabase = createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    const [{ data: userData }, { data: profileData }, { data: certs }, { count: svcCount }, { data: tierRow }] = await Promise.all([
      supabase.from("users").select("*").eq("id", authUser.id).single(),
      // Use my_therapist_profile (security-definer view scoped to
      // auth.uid()) so we can SELECT * — the base therapist_profiles
      // table has column-level grants that block `*` for everyone
      // outside service_role. See dashboard/page.tsx for full context.
      supabase.from("my_therapist_profile").select("*").eq("id", authUser.id).single(),
      supabase.from("certifications").select("*").eq("therapist_id", authUser.id).order("year_obtained", { ascending: false }),
      supabase.from("therapist_services").select("id", { count: "exact", head: true }).eq("therapist_id", authUser.id),
      supabase
        .from("therapist_profiles")
        .select("tier, requested_tier, tier_request_status, slug")
        .eq("id", authUser.id)
        .maybeSingle(),
    ]);

    setUser(userData);
    setProfile(profileData);
    const tierData = tierRow as {
      tier?: TierKey;
      requested_tier?: TierKey | null;
      tier_request_status?: TierRequestStatus | null;
      slug?: string | null;
    } | null;
    setTier(tierData?.tier ?? null);
    setRequestedTier(tierData?.requested_tier ?? null);
    setTierRequestStatus(tierData?.tier_request_status ?? null);
    setSlug(tierData?.slug ?? null);
    setSelectedRequestTier(tierData?.requested_tier ?? tierData?.tier ?? null);
    setCertifications(certs || []);
    setServiceCount(svcCount ?? 0);
    setDisplayName(profileData?.display_name || userData?.display_name || "");
    setTagline(profileData?.tagline || "");
    setBio(profileData?.bio || "");
    setCity(profileData?.city || userData?.city || "");
    setCountry(profileData?.country || userData?.country || "");
    setPhone(userData?.phone_number || "");
    setYearsExperience(profileData?.years_experience || 0);
    setCategories(profileData?.categories || []);
    setLanguages(profileData?.languages || ["Italian"]);
    setVideoIntroUrl(profileData?.video_intro_url || "");
    setPhotoUrl(profileData?.photo_url || null);
    setGalleryUrls(
      Array.isArray(profileData?.gallery_image_urls)
        ? (profileData?.gallery_image_urls as string[])
        : []
    );
    setLoading(false);
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Calculate completeness score
  function calcCompleteness(): number {
    let score = 0;
    if (displayName) score += 15;
    if (tagline) score += 10;
    if (bio) score += 15;
    if (photoUrl) score += 10;
    if (categories.length > 0) score += 10;
    if (serviceCount > 0) score += 15;
    if (certifications.length > 0) score += 10;
    if (videoIntroUrl) score += 5;
    if (city) score += 5;
    if ((profile?.stripe_account_status as string) === "active") score += 5;
    return Math.min(score, 100);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    // Refuse to save a video_intro_url that the client-side renderer
    // would reject anyway. Without this gate, a bad value (PHAsset
    // UUID, blank-with-spaces, random text) gets persisted and the
    // public profile page silently drops the video preview. Better
    // to fail loud at save time so the therapist sees the error and
    // can fix it. Empty is fine (the field is optional).
    if (videoIntroUrl.trim().length > 0) {
      const videoParse = parseVideoIntroUrl(videoIntroUrl);
      if (!videoParse.valid) {
        setSaveError(
          "Il campo 'Video di presentazione' contiene un valore non valido. Inserisci un URL YouTube o Vimeo, oppure lascia il campo vuoto.",
        );
        setSaving(false);
        return;
      }
    }
    // Block save when bio exceeds the cap. We removed the silent
    // slice-on-type so users can see the real count, but we still
    // need to enforce the cap somewhere — at save time gives them
    // a chance to edit before losing content.
    if (bio.length > MAX_BIO_CHARS) {
      setSaveError(
        `La bio supera il limite di ${MAX_BIO_CHARS} caratteri (attualmente ${bio.length}). Accorciala prima di salvare.`,
      );
      setSaving(false);
      return;
    }
    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { setSaving(false); return; }

      // Calculate profile completeness
      let completeness = 0;
      if (displayName) completeness += 15;
      if (tagline) completeness += 10;
      if (bio) completeness += 15;
      if (photoUrl) completeness += 10;
      if (categories.length > 0) completeness += 10;
      if (certifications.length > 0) completeness += 10;
      if (videoIntroUrl) completeness += 5;
      if (city) completeness += 5;
      if ((profile?.stripe_account_status as string) === "active") completeness += 5;

      // Check services separately
      const { count: svcCount } = await supabase
        .from("therapist_services")
        .select("id", { count: "exact", head: true })
        .eq("therapist_id", authUser.id);
      if (svcCount && svcCount > 0) completeness += 15;

      const [usersResult, profileResult] = await Promise.all([
        supabase.from("users").update({
          display_name: displayName,
          city,
          country: country || null,
          phone_number: phone,
        }).eq("id", authUser.id),
        supabase.from("therapist_profiles").update({
          display_name: displayName,
          tagline,
          bio,
          city,
          country: country || null,
          years_experience: yearsExperience,
          categories,
          languages,
          video_intro_url: videoIntroUrl || null,
          profile_completeness: Math.min(completeness, 100),
        }).eq("id", authUser.id),
      ]);

      if (usersResult.error || profileResult.error) {
        throw new Error(usersResult.error?.message || profileResult.error?.message || "Save failed");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      loadProfile();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Submit (or re-submit) the therapist's tier request. Goes through
   * `/api/me/tier-request` which uses service-role to bypass the
   * `protect_therapist_admin_columns` trigger. Same server-side logic
   * runs from the first-login `/onboarding/tier` page — Practitioner
   * picks are auto-approved, Trainer / Supervisor land as pending.
   */
  async function handleRequestTier() {
    if (!selectedRequestTier) return;
    setTierRequestError("");
    setSubmittingTierRequest(true);
    try {
      const res = await fetch("/api/me/tier-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selectedRequestTier }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTierRequestError(
          data.error || "Impossibile inviare la richiesta",
        );
        return;
      }
      // Update local UI state so the banner reflects the new request
      // without a full reload. Practitioner is auto-approved server-side
      // so we mirror that here.
      setRequestedTier(selectedRequestTier);
      if (selectedRequestTier === "practitioner") {
        setTierRequestStatus("approved");
        setTier("practitioner");
      } else {
        setTierRequestStatus("pending");
      }
    } catch {
      setTierRequestError("Errore di rete. Riprova.");
    } finally {
      setSubmittingTierRequest(false);
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");

    if (!file.type.startsWith("image/")) {
      // Some browsers (notably older Safari / non-image picks) leave
      // file.type empty or set application/octet-stream. Tell the user
      // exactly what's happening rather than the generic "File must be
      // an image" that they can't action on.
      setUploadError(
        `Il file selezionato non è riconosciuto come immagine (tipo: ${file.type || "sconosciuto"}). Prova a salvarla come JPG o PNG e riprova.`,
      );
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      const actualMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(
        `Immagine troppo grande (${actualMb} MB, massimo ${MAX_PHOTO_MB} MB). Riducila prima di caricarla: su iPhone usa "Impostazioni → Foto → Trasferisci su Mac o PC → Automatico", oppure ridimensionala con un app foto o un sito come tinypng.com.`,
      );
      return;
    }

    setPhotoUploading(true);
    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      // Deterministic path overwrites previous avatar. Cache-bust via timestamp query param.
      const path = `${authUser.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      // Write the photo URL to BOTH tables:
      //   - therapist_profiles.photo_url drives the public profile page.
      //   - users.photo_url is the canonical avatar that Stream Chat reads at
      //     connectUser time (see dashboard/messages/page.tsx).
      // Updating only therapist_profiles left the two columns to drift, so an
      // operator could have a profile photo yet show NO avatar in chat (it
      // fell back to a generic initials/ui-avatars image). Keeping them in
      // sync here is the fix.
      const [profileResult, userResult] = await Promise.all([
        supabase
          .from("therapist_profiles")
          .update({ photo_url: publicUrl })
          .eq("id", authUser.id),
        supabase
          .from("users")
          .update({ photo_url: publicUrl })
          .eq("id", authUser.id),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (userResult.error) throw userResult.error;

      setPhotoUrl(publicUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError("");

    const remainingSlots = MAX_GALLERY_IMAGES - galleryUrls.length;
    if (remainingSlots <= 0) {
      setUploadError(`Max ${MAX_GALLERY_IMAGES} gallery photos`);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);
    // Pre-validation pass: collect every issue so the user sees ALL
    // problems at once rather than just the last file's. Previously
    // each setUploadError overwrote the previous one, hiding earlier
    // failures behind whichever file iterated last.
    const validationIssues: string[] = [];
    for (const file of filesToUpload) {
      if (!file.type.startsWith("image/")) {
        validationIssues.push(
          `${file.name}: non riconosciuto come immagine (tipo: ${file.type || "sconosciuto"}), saltato.`,
        );
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        const actualMb = (file.size / (1024 * 1024)).toFixed(1);
        validationIssues.push(
          `${file.name}: ${actualMb} MB, oltre il limite di ${MAX_PHOTO_MB} MB. Riducila prima di caricarla.`,
        );
        continue;
      }
    }
    if (validationIssues.length > 0) {
      setUploadError(validationIssues.join(" • "));
    }

    setGalleryUploading(true);
    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      const newUrls: string[] = [...galleryUrls];
      for (const file of filesToUpload) {
        if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES) continue;

        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const uuid = crypto.randomUUID();
        const path = `${authUser.id}/gallery/${uuid}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from(PROFILE_BUCKET)
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) {
          setUploadError(`Upload failed: ${upErr.message}`);
          continue;
        }

        const { data: urlData } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path);
        newUrls.push(urlData.publicUrl);
      }

      const { error: updateError } = await supabase
        .from("therapist_profiles")
        .update({ gallery_image_urls: newUrls })
        .eq("id", authUser.id);
      if (updateError) throw updateError;

      setGalleryUrls(newUrls);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setGalleryUploading(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  async function removeGalleryImage(url: string) {
    setUploadError("");
    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      // Best-effort delete from Storage. Parse path from public URL.
      const marker = `/storage/v1/object/public/${PROFILE_BUCKET}/`;
      const idx = url.indexOf(marker);
      if (idx >= 0) {
        const storagePath = url.substring(idx + marker.length).split("?")[0];
        await supabase.storage.from(PROFILE_BUCKET).remove([storagePath]);
      }

      const newUrls = galleryUrls.filter((u) => u !== url);
      const { error: updateError } = await supabase
        .from("therapist_profiles")
        .update({ gallery_image_urls: newUrls })
        .eq("id", authUser.id);
      if (updateError) throw updateError;

      setGalleryUrls(newUrls);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function addCertification() {
    if (!certForm.name.trim()) return;
    const supabase = createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    await supabase.from("certifications").insert({
      therapist_id: authUser.id,
      name: certForm.name.trim(),
      issuing_organization: certForm.issuing_organization.trim(),
      year_obtained: certForm.year_obtained,
    });

    setShowCertForm(false);
    setCertForm({ name: "", issuing_organization: "", year_obtained: new Date().getFullYear() });
    loadProfile();
  }

  async function deleteCertification(id: string) {
    const supabase = createClient();
    await supabase.from("certifications").delete().eq("id", id);
    loadProfile();
  }

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function toggleLanguage(lang: string) {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  const rating = (profile?.average_rating as number) || 0;
  const reviews = (profile?.total_reviews as number) || 0;
  const approvalStatus = (profile?.approval_status as string) || "draft";
  const approved = approvalStatus === "approved";
  const completeness = (profile?.profile_completeness as number) || 0;

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoUpload}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleGalleryUpload}
      />

      <div className="animate-reveal flex items-center justify-between">
        <div>
          <DisplayHeading>{t.profile.title}</DisplayHeading>
          <p className="mt-1 text-sm text-charcoal-muted">{t.profile.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1 text-sm font-medium text-success animate-reveal">
              <CheckCircle className="h-4 w-4" />
              {t.common.saved}
            </span>
          )}
          {saveError && (
            <span className="flex items-center gap-1 text-sm font-medium text-red-500 animate-reveal">
              <AlertTriangle className="h-4 w-4" />
              {saveError}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50"
          >
            {saving ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t.common.save}
          </button>
        </div>
      </div>

      {/* Profile completeness */}
      <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "20ms" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-charcoal">{t.profile.completeness}</p>
          <p className="text-sm font-bold text-berry">{completeness}%</p>
        </div>
        <div className="h-2.5 rounded-full bg-berry-subtle/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              completeness >= 80 ? "bg-success" : completeness >= 50 ? "bg-gold" : "bg-berry"
            }`}
            style={{ width: `${completeness}%` }}
          />
        </div>
        {completeness < 80 && (
          <p className="mt-2 text-xs text-charcoal-muted">
            {t.profile.completeToAppear}
          </p>
        )}
      </div>

      {/* Profile header card */}
      <Card className="animate-reveal" style={{ animationDelay: "40ms" }}>
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="relative group">
            <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-berry-subtle to-berry-muted/30 flex items-center justify-center text-2xl font-bold text-berry overflow-hidden">
              {photoUrl ? (
                <NextImage
                  src={photoUrl}
                  alt="Profile"
                  width={96}
                  height={96}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{displayName ? displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() : "T"}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading}
              className="absolute inset-0 flex items-center justify-center rounded-2xl bg-charcoal/40 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100 disabled:bg-charcoal/60"
            >
              {photoUploading ? (
                <svg className="h-6 w-6 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <Camera className="h-6 w-6 text-white" />
              )}
            </button>
          </div>

          {/* Info */}
          <div className="flex-1">
            {tier && (
              <div className="mb-2 flex items-center gap-2.5">
                <span className="inline-flex flex-shrink-0 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-berry/5">
                  <TierIcon tier={tier} size={38} />
                </span>
                <TierLabel tier={tier} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <DisplayHeading as="h2" size="md">
                {displayName || t.profile.fullName}
              </DisplayHeading>
              {approved && (
                <span className="flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-[10px] font-semibold text-success">
                  <CheckCircle className="h-3 w-3" />
                  {t.common.verified}
                </span>
              )}
              {approvalStatus === "pending_review" && (
                <span className="flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-[10px] font-semibold text-warning">
                  <ClockIcon className="h-3 w-3" />
                  {t.common.inReview}
                </span>
              )}
            </div>
            {tagline && <p className="mt-0.5 text-sm text-berry">{tagline}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-charcoal-muted">
              {(city || country) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[city, COUNTRIES.find((c) => c.value === country)?.label].filter(Boolean).join(", ")}
                </span>
              )}
              {rating > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 text-gold" fill="currentColor" />
                  {rating.toFixed(1)} ({reviews} {t.profile.reviews})
                </span>
              )}
              {yearsExperience > 0 && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> {yearsExperience} {t.profile.yearsExp}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Upload errors (photo or gallery) */}
        {uploadError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {uploadError}
          </div>
        )}

        <p className="mt-3 text-[11px] text-charcoal-muted">{t.profile.photoHint}</p>
      </Card>

      {/* Public profile link — shareable on the therapist's own site */}
      <Card className="animate-reveal" style={{ animationDelay: "50ms" }}>
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-charcoal">
              {locale === "en" ? "Your public link" : "Il tuo link pubblico"}
            </h3>
            <p className="mt-1 text-xs text-charcoal-muted">
              {locale === "en"
                ? "Share this link so clients can find and book you — put it on your website or social profiles."
                : "Condividi questo link per farti trovare e prenotare — mettilo sul tuo sito o sui social."}
            </p>
          </div>
          {slug ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-berry/10 bg-cream px-3 py-2 text-xs text-charcoal">
                {`${process.env.NEXT_PUBLIC_PUBLIC_APP_URL ?? "https://app.holisticunity.app"}/t/${slug}`}
              </code>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${process.env.NEXT_PUBLIC_PUBLIC_APP_URL ?? "https://app.holisticunity.app"}/t/${slug}`,
                    );
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  } catch {
                    /* clipboard blocked — no-op */
                  }
                }}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-berry px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-berry-dark"
              >
                {linkCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                {linkCopied
                  ? locale === "en"
                    ? "Copied!"
                    : "Copiato!"
                  : locale === "en"
                    ? "Copy link"
                    : "Copia link"}
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-berry/10 bg-cream px-3 py-2 text-xs text-charcoal-muted">
              {locale === "en"
                ? "Your link will be available once your profile is approved."
                : "Il link sarà disponibile dopo l'approvazione del tuo profilo."}
            </p>
          )}
        </div>
      </Card>

      {/* Tier self-declaration */}
      <Card className="animate-reveal" style={{ animationDelay: "60ms" }}>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-charcoal">Il tuo livello professionale</h3>
            <p className="mt-1 text-xs text-charcoal-muted">
              Indica il livello che pensi di qualificare. L&apos;amministrazione verifica
              i certificati che hai caricato prima di mostrare il badge sul profilo pubblico.
            </p>
          </div>

          <TierPendingBanner
            status={tierRequestStatus}
            requestedTier={requestedTier}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            {([
              {
                tier: "practitioner" as const,
                title: "Praticante certificato",
                requirements:
                  "Hai completato un percorso formativo certificato e operi con i clienti.",
              },
              {
                tier: "trainer" as const,
                title: "Forma altri praticanti",
                requirements:
                  "Almeno 5 anni di esperienza professionale e attività di docenza. Certificazione avanzata nel tuo metodo.",
              },
              {
                tier: "supervisor" as const,
                title: "Livello supervisore",
                requirements:
                  "Formatore di formatori, certificazione completa, esperienza pluriennale come supervisore di altri terapisti.",
              },
            ]).map(({ tier: tierOpt, title, requirements }) => {
              const isSelected = selectedRequestTier === tierOpt;
              return (
                <label
                  key={tierOpt}
                  className={`flex cursor-pointer flex-col gap-3 rounded-2xl border-2 p-4 transition-all ${
                    isSelected
                      ? "border-berry bg-berry-subtle/30 shadow-sm"
                      : "border-berry/10 bg-white/70 hover:border-berry/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="requested_tier"
                    value={tierOpt}
                    checked={isSelected}
                    onChange={() => setSelectedRequestTier(tierOpt)}
                    className="sr-only"
                  />
                  <TierLabel tier={tierOpt} compact />
                  <div>
                    <p className="text-sm font-semibold text-charcoal">{title}</p>
                    <p className="mt-1 text-xs text-charcoal-muted">{requirements}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {tierRequestError && (
            <p className="flex items-center gap-2 text-xs text-error">
              <AlertTriangle className="h-3.5 w-3.5" />
              {tierRequestError}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-berry/5 pt-4">
            <p className="text-xs text-charcoal-muted">
              {tier && (
                <>
                  Badge attuale: <strong className="text-charcoal">{tier}</strong>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={handleRequestTier}
              disabled={
                submittingTierRequest ||
                !selectedRequestTier ||
                (selectedRequestTier === requestedTier &&
                  tierRequestStatus === "pending")
              }
              className="rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark active:scale-[0.97] disabled:opacity-50"
            >
              {submittingTierRequest
                ? "Invio in corso..."
                : tierRequestStatus === "pending" &&
                    selectedRequestTier === requestedTier
                  ? "Richiesta inviata"
                  : "Invia richiesta"}
            </button>
          </div>
        </div>
      </Card>

      {/* Form sections */}
      <div className="animate-reveal space-y-6" style={{ animationDelay: "80ms" }}>
        {/* Personal Info */}
        <Card>
          <h3 className="text-sm font-bold text-charcoal mb-4">{t.profile.personalInfo}</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.fullName}</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.tagline}</label>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder={t.profile.taglinePlaceholder}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                />
              </div>
            </div>

            <div>
              {(() => {
                const bioOver = bio.length > MAX_BIO_CHARS;
                return (
                  <>
                    <label className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-charcoal-muted">
                      <span>{t.profile.bio}</span>
                      <span
                        className={
                          bioOver
                            ? "font-medium text-error"
                            : bio.length > MAX_BIO_CHARS * 0.9
                              ? "font-medium text-warning"
                              : "text-charcoal-muted/50"
                        }
                      >
                        {bio.length}/{MAX_BIO_CHARS}
                        {bioOver && ` (−${bio.length - MAX_BIO_CHARS})`}
                      </span>
                    </label>
                    <textarea
                      value={bio}
                      // No truncation on type — users see the real
                      // count and the visual + save-block tells them
                      // when they're over. Silent truncation was the
                      // old behaviour and it lost content unannounced.
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      placeholder={t.profile.bioPlaceholder}
                      aria-invalid={bioOver ? "true" : "false"}
                      className={
                        "w-full rounded-xl border bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:ring-2 transition-all resize-none " +
                        (bioOver
                          ? "border-error/40 focus:border-error focus:ring-error/15"
                          : "border-berry/10 focus:border-berry/30 focus:ring-berry/10")
                      }
                    />
                    {bioOver && (
                      <p className="mt-1.5 text-[11px] text-error">
                        La bio supera il limite di {MAX_BIO_CHARS} caratteri. Accorciala prima di salvare — il salvataggio è bloccato.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.city}</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t.profile.cityPlaceholder}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.country}</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                >
                  <option value="">{t.profile.countryPlaceholder}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.phone}</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t.profile.phonePlaceholder}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.yearsExperience}</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all"
                />
              </div>
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-charcoal-muted">{t.profile.email}</label>
              <input
                value={(user?.email as string) || ""}
                disabled
                className="w-full rounded-xl border border-cream-dark bg-cream-dark/50 px-4 py-2.5 text-sm text-charcoal-muted cursor-not-allowed"
              />
            </div>
          </div>
        </Card>

        {/* Gallery */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-berry" />
              <h3 className="text-sm font-bold text-charcoal">{t.profile.gallery}</h3>
              <span className="text-xs text-charcoal-muted">
                ({galleryUrls.length}/{MAX_GALLERY_IMAGES})
              </span>
            </div>
            {galleryUrls.length < MAX_GALLERY_IMAGES && (
              <button
                onClick={() => galleryInputRef.current?.click()}
                disabled={galleryUploading}
                className="flex items-center gap-1 rounded-full border border-berry/20 px-3 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all disabled:opacity-50"
              >
                {galleryUploading ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                {t.profile.galleryUpload}
              </button>
            )}
          </div>

          <p className="mb-3 text-[11px] text-charcoal-muted">{t.profile.galleryHint}</p>

          {galleryUrls.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-berry/10 bg-berry-subtle/20">
              <p className="text-xs text-charcoal-muted">{t.profile.galleryEmpty}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {galleryUrls.map((url) => (
                <div key={url} className="relative group aspect-[4/3] rounded-xl overflow-hidden border border-berry/10">
                  <NextImage
                    src={url}
                    alt="Gallery"
                    fill
                    sizes="(max-width: 640px) 50vw, 33vw"
                    unoptimized
                    className="object-cover"
                  />
                  <button
                    onClick={() => removeGalleryImage(url)}
                    className="absolute top-2 right-2 rounded-full bg-charcoal/70 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-error"
                    aria-label={t.profile.galleryRemove}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Categories */}
        <Card>
          <h3 className="text-sm font-bold text-charcoal mb-3">{t.profile.specializations}</h3>
          <div className="flex flex-wrap gap-2">
            {THERAPY_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => toggleCategory(cat.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  categories.includes(cat.value)
                    ? "bg-berry text-white shadow-md shadow-berry/15"
                    : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </Card>

        {/* Languages */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Languages className="h-4 w-4 text-berry" />
            <h3 className="text-sm font-bold text-charcoal">{t.profile.languages}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.value}
                onClick={() => toggleLanguage(lang.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  languages.includes(lang.value)
                    ? "bg-berry text-white shadow-md shadow-berry/15"
                    : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </Card>

        {/* Certifications */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-berry" />
              <h3 className="text-sm font-bold text-charcoal">{t.profile.certifications}</h3>
            </div>
            {!showCertForm && (
              <button
                onClick={() => setShowCertForm(true)}
                className="flex items-center gap-1 rounded-full border border-berry/20 px-3 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
              >
                <Plus className="h-3 w-3" />
                {t.common.add}
              </button>
            )}
          </div>

          {/* Cert form */}
          {showCertForm && (
            <div className="mb-4 rounded-xl border border-berry/10 bg-berry-subtle/20 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  value={certForm.name}
                  onChange={(e) => setCertForm({ ...certForm, name: e.target.value })}
                  placeholder={t.profile.certName}
                  className="rounded-lg border border-berry/10 bg-white px-3 py-2 text-xs text-charcoal outline-none focus:border-berry/30"
                />
                <input
                  value={certForm.issuing_organization}
                  onChange={(e) => setCertForm({ ...certForm, issuing_organization: e.target.value })}
                  placeholder={t.profile.certOrg}
                  className="rounded-lg border border-berry/10 bg-white px-3 py-2 text-xs text-charcoal outline-none focus:border-berry/30"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={certForm.year_obtained}
                    onChange={(e) => setCertForm({ ...certForm, year_obtained: parseInt(e.target.value) })}
                    min={1970}
                    max={new Date().getFullYear()}
                    className="flex-1 rounded-lg border border-berry/10 bg-white px-3 py-2 text-xs text-charcoal outline-none focus:border-berry/30"
                  />
                  <button
                    onClick={addCertification}
                    disabled={!certForm.name.trim()}
                    className="rounded-lg bg-berry px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setShowCertForm(false)}
                    className="rounded-lg px-2 py-2 text-xs text-charcoal-muted hover:bg-charcoal/5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cert list */}
          {certifications.length === 0 ? (
            <p className="text-xs text-charcoal-muted text-center py-4">
              {t.profile.noCertifications}
            </p>
          ) : (
            <div className="space-y-2">
              {certifications.map((cert) => (
                <div key={cert.id} className="flex items-center gap-3 rounded-xl border border-berry/5 bg-white/50 px-4 py-3">
                  <Award className="h-4 w-4 text-gold flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-charcoal">{cert.name}</p>
                    <p className="text-xs text-charcoal-muted">
                      {cert.issuing_organization} &middot; {cert.year_obtained}
                    </p>
                  </div>
                  {cert.is_verified && (
                    <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
                  )}
                  <button
                    onClick={() => deleteCertification(cert.id)}
                    className="rounded-lg p-1 text-charcoal-muted hover:text-error hover:bg-error-light transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Video Intro — YouTube/Vimeo URL with live validation + preview */}
        {(() => {
          const parsed = parseVideoIntroUrl(videoIntroUrl);
          const isEmpty = parsed.valid === false && parsed.reason === "empty";
          const isValid = parsed.valid;
          const showError = !isEmpty && !isValid;
          // Error message based on the specific failure mode — much
          // better than a generic "Invalid URL". Italian-only for now;
          // when the platform goes EN/PT, swap to t.* lookups.
          const errorMsg: string | null = showError
            ? parsed.reason === "malformed_url"
              ? "Non sembra un URL valido — controlla che inizi con https://"
              : parsed.reason === "missing_id"
                ? "URL riconosciuto come YouTube/Vimeo ma manca l'id del video"
                : parsed.reason === "unsupported_host"
                  ? `Solo link YouTube o Vimeo sono supportati (host attuale: ${(parsed as { host: string }).host})`
                  : "URL non valido"
            : null;
          return (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Video className="h-4 w-4 text-berry" />
                <h3 className="text-sm font-bold text-charcoal">{t.profile.videoIntro}</h3>
              </div>
              <div className="relative">
                <input
                  value={videoIntroUrl}
                  onChange={(e) => setVideoIntroUrl(e.target.value)}
                  placeholder={t.profile.videoIntroPlaceholder}
                  className={
                    "w-full rounded-xl border bg-white/70 px-4 py-2.5 pr-10 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:ring-2 transition-all " +
                    (isValid
                      ? "border-success/40 focus:border-success focus:ring-success/15"
                      : showError
                        ? "border-error/40 focus:border-error focus:ring-error/15"
                        : "border-berry/10 focus:border-berry/30 focus:ring-berry/10")
                  }
                  aria-invalid={showError ? "true" : "false"}
                />
                {isValid && (
                  <CheckCircle className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-success" />
                )}
                {showError && (
                  <AlertTriangle className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-error" />
                )}
              </div>
              {errorMsg && (
                <p className="mt-1.5 text-[11px] text-error">{errorMsg}</p>
              )}
              {isValid && (
                <div className="mt-3 rounded-xl border border-success/20 bg-success/5 p-3">
                  <div className="flex items-start gap-3">
                    {parsed.thumbnailUrl ? (
                      <NextImage
                        src={parsed.thumbnailUrl}
                        alt="Anteprima video"
                        width={128}
                        height={80}
                        unoptimized
                        className="h-20 w-32 flex-shrink-0 rounded-lg object-cover shadow-sm"
                      />
                    ) : (
                      <div className="flex h-20 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-berry/10 text-berry">
                        <Video className="h-6 w-6" />
                      </div>
                    )}
                    <div className="flex-1 text-[11px] leading-relaxed text-charcoal-light">
                      <p className="font-semibold text-success">
                        {parsed.provider === "youtube" ? "Video YouTube" : "Video Vimeo"} riconosciuto
                      </p>
                      <p className="mt-0.5 text-charcoal-muted">
                        ID: <code className="rounded bg-cream/60 px-1 py-0.5 text-[10px]">{parsed.id}</code>
                      </p>
                      <p className="mt-1 text-charcoal-muted">
                        Salvando, questa anteprima sarà mostrata ai clienti sul tuo profilo pubblico.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-charcoal-muted leading-relaxed">
                {t.profile.videoIntroHint}
              </p>
            </Card>
          );
        })()}
      </div>
    </div>
  );
}
