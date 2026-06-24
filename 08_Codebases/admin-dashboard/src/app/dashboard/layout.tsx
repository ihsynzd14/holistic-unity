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

  // MFA enforcement — admin dashboard is the highest-privilege surface
  // (service-role, all-user data, payout controls). 2FA is MANDATORY:
  //   1. If no factor enrolled → /enroll-mfa (one-time setup)
  //   2. If enrolled but session is still aal1 (just signed in with
  //      password) → /verify-mfa (enter TOTP code)
  //
  // The pages live outside the dashboard layout so the redirect doesn't
  // loop. Enforcement here (server-side, in the layout) means client
  // pages can never even render before MFA is satisfied.
  const [{ data: factors }, { data: aalData }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const verifiedFactors = (factors?.totp ?? []).filter((f) => f.status === "verified");
  const aal = aalData?.currentLevel ?? "aal1";

  if (verifiedFactors.length === 0) {
    redirect("/enroll-mfa");
  }
  if (aal !== "aal2") {
    redirect("/verify-mfa");
  }

  return (
    <div className="flex h-full">
      <Sidebar userId={user.id} userEmail={user.email || ""} />
      <main className="flex-1 overflow-y-auto bg-cream p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
