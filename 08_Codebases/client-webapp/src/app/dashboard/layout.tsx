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

  // Fetch the user row. We use `maybeSingle` because for a brand-new
  // signup the public.users row may not exist yet (DB trigger lag, or
  // first login after email confirmation) — in that case we lazily
  // provision it as a client account so the dashboard can still render.
  const { data: userData } = await supabase
    .from("users")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  let role = userData?.role;
  let displayName = userData?.display_name;

  if (!userData) {
    // Lazy provision — the auth.users row exists (we have a session)
    // but public.users does not. Create it as a client.
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fallbackName = (meta.display_name as string) || (meta.full_name as string) || "";
    await supabase.from("users").upsert(
      {
        id: user.id,
        email: user.email,
        display_name: fallbackName,
        phone_number: (meta.phone as string) || "",
        role: "client",
      },
      { onConflict: "id" },
    );
    role = "client";
    displayName = fallbackName;
  }

  // This portal is for clients ONLY. Therapists have their own portal at
  // therapistportal.holisticunity.app — bounce them with an explanatory
  // querystring instead of a generic redirect, so the login page can show
  // a helpful banner.
  if (role === "therapist") {
    await supabase.auth.signOut();
    redirect("/login?error=wrong_portal");
  }

  // Onboarding gate: clients must complete /welcome before reaching the
  // dashboard. This is the "obbligatorio" mode — see
  // src/app/welcome/page.tsx for the flow itself. Soft fail: if the
  // client_preferences table doesn't exist yet (migration not applied)
  // we don't block — we let the user through and degrade gracefully.
  // NOTE: redirect() throws a special NEXT_REDIRECT — must run OUTSIDE
  // any try/catch so the error bubbles up to the framework.
  let needsOnboarding = false;
  const { data: prefs, error: prefsErr } = await supabase
    .from("client_preferences")
    .select("completed_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!prefsErr && !prefs?.completed_at) {
    needsOnboarding = true;
  }
  if (needsOnboarding) {
    redirect("/welcome");
  }

  return (
    <div className="flex h-full">
      <Sidebar
        userId={user.id}
        userName={displayName || "Cliente"}
        userEmail={user.email || ""}
      />
      <main className="flex-1 overflow-y-auto bg-cream p-4 pt-16 lg:p-6 lg:pt-6 lg:pl-8">
        {children}
      </main>
    </div>
  );
}
