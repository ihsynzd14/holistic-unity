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

  // The /api/livekit/token endpoint already enforces that only the
  // booking's client or therapist can join — no extra DB check needed
  // here. The Edge Function is the source of truth for room access.

  return (
    <div className="h-screen w-screen bg-charcoal text-white overflow-hidden">
      {children}
    </div>
  );
}
