import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * /welcome — onboarding flow. Auth-gated but otherwise full-screen
 * (no sidebar, no dashboard chrome). If the user has already completed
 * the onboarding (client_preferences.completed_at IS NOT NULL), bounce
 * them to the dashboard — we don't want them re-doing it accidentally.
 */
export default async function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: prefs } = await supabase
    .from("client_preferences")
    .select("completed_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (prefs?.completed_at) {
    redirect("/dashboard");
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F8EBD9 35%, #F0DFE5 70%, #E8C8D4 100%)",
      }}
    >
      {children}
    </div>
  );
}
