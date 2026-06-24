import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import "@/app/globals.css";
import "@livekit/components-styles";

export const metadata = {
  title: "Video Session — Holistic Unity",
};

/**
 * Minimal layout for the standalone video call page.
 * No sidebar, no dashboard chrome — just the call.
 */
export default async function CallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Mirror the dashboard gate: only approved therapists may start calls.
  const { data: profileRow } = await supabase
    .from("therapist_profiles")
    .select("approval_status")
    .eq("id", user.id)
    .single();

  if (profileRow?.approval_status !== "approved") {
    await supabase.auth.signOut();
    redirect("/login?status=pending_review");
  }

  return (
    <div className="h-screen w-screen bg-charcoal text-white overflow-hidden">
      {children}
    </div>
  );
}
