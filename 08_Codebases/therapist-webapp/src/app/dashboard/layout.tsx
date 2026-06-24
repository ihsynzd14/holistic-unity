import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "./sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch therapist user data
  const { data: userData } = await supabase
    .from("users")
    .select("display_name, role")
    .eq("id", user.id)
    .single();

  // Only therapists can access this portal
  if (userData?.role !== "therapist") {
    redirect("/login?error=not_therapist");
  }

  // Defence-in-depth: even if a user with a valid therapist session lands
  // here (e.g. via a stale cookie from before admin un-approval), block
  // dashboard access unless the profile is explicitly "approved". The
  // login form already enforces this; this is the belt-and-braces check.
  const { data: profileRow } = await supabase
    .from("therapist_profiles")
    .select("approval_status")
    .eq("id", user.id)
    .single();

  if (profileRow?.approval_status !== "approved") {
    await supabase.auth.signOut();
    redirect("/login?status=pending_review");
  }

  // MFA enforcement (MANDATORY for therapists since 2026-04-25). If the
  // therapist hasn't enrolled a TOTP factor, force them through the
  // 4-step enrollment wizard at /enroll-mfa. If they have a factor but
  // their current session is still at aal1 (just signed in with
  // password), bounce to /verify-mfa to upgrade.
  const [{ data: factors }, { data: aalData }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const hasVerifiedFactor = (factors?.totp ?? []).some((f) => f.status === "verified");
  const aal = aalData?.currentLevel ?? "aal1";
  if (!hasVerifiedFactor) {
    redirect("/enroll-mfa");
  }
  if (aal !== "aal2") {
    redirect("/verify-mfa");
  }

  // Tier onboarding: a brand-new therapist hasn't declared what credential
  // level they qualify for yet (requested_tier IS NULL). Force them through
  // the picker once so we have a self-claim on record. After they submit,
  // requested_tier is set and this redirect stops firing — they can later
  // change their request from the profile page.
  const { data: tierRow } = await supabase
    .from("therapist_profiles")
    .select("requested_tier")
    .eq("id", user.id)
    .maybeSingle();
  if (tierRow && tierRow.requested_tier === null) {
    redirect("/onboarding/tier");
  }

  return (
    <div className="flex h-full">
      <Sidebar
        userId={user.id}
        userName={userData?.display_name || "Terapista"}
        userEmail={user.email || ""}
      />
      <main className="flex-1 overflow-y-auto bg-cream p-4 pt-16 lg:p-6 lg:pt-6 lg:pl-8">
        {children}
      </main>
    </div>
  );
}
