import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Standalone layout for the post-Stripe-Checkout return page.
 * Auth-gated (Stripe only redirects logged-in users back from checkout)
 * but no sidebar / dashboard chrome — keeps the screen focused on the
 * booking confirmation.
 */
export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen bg-cream px-4 py-6 lg:py-12">{children}</main>
  );
}
