"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  LayoutDashboard,
  Sparkles,
  Search,
  Calendar,
  MessageCircle,
  Video,
  Bell,
  BookOpen,
  UserCircle,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

// Client-side navigation. Intentionally narrower than the therapist
// sidebar — clients don't manage services, availability, or earnings.
const navKeys = [
  { key: "dashboard" as const, href: "/dashboard", icon: LayoutDashboard },
  { key: "practices" as const, href: "/dashboard/pratiche", icon: Sparkles },
  { key: "therapists" as const, href: "/dashboard/therapists", icon: Search },
  { key: "bookings" as const, href: "/dashboard/bookings", icon: Calendar },
  { key: "messages" as const, href: "/dashboard/messages", icon: MessageCircle },
  { key: "sessions" as const, href: "/dashboard/sessions", icon: Video },
  { key: "notifications" as const, href: "/dashboard/notifications", icon: Bell },
  { key: "journal" as const, href: "/dashboard/journal", icon: BookOpen },
  { key: "account" as const, href: "/dashboard/account", icon: UserCircle },
];

interface SidebarProps {
  userName: string;
  userEmail: string;
}

export default function Sidebar({ userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useI18n();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-5">
        <Image
          src="/logo.png"
          alt="Holistic Unity"
          width={40}
          height={40}
          className="rounded-xl"
        />
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">
            {t.sidebar.brand}
          </h2>
          <p className="text-[11px] font-medium tracking-wide text-berry-muted">{t.sidebar.subtitle}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-berry/10 to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navKeys.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition-all duration-200 ${
                isActive
                  ? "bg-berry text-white shadow-md shadow-berry/15"
                  : "text-charcoal-light hover:bg-berry-subtle/50 hover:text-berry-dark"
              }`}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              {t.sidebar[item.key]}
            </Link>
          );
        })}
      </nav>

      {/* Gold accent line */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

      {/* User / Sign Out */}
      <div className="px-4 py-4">
        <div className="mb-1 truncate px-1 text-[12px] font-semibold text-charcoal">{userName}</div>
        <div className="mb-2.5 truncate px-1 text-[11px] font-medium text-charcoal-muted">{userEmail}</div>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-charcoal-muted transition-all duration-200 hover:bg-error-light hover:text-error"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          {t.sidebar.signOut}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-md shadow-berry/10 backdrop-blur-sm lg:hidden"
      >
        {mobileOpen ? (
          <X className="h-5 w-5 text-charcoal" />
        ) : (
          <Menu className="h-5 w-5 text-charcoal" />
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-charcoal/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-berry/5 bg-white/95 backdrop-blur-xl transition-transform duration-300 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden h-full w-[260px] flex-col border-r border-berry/5 bg-white/60 backdrop-blur-sm lg:flex">
        {sidebarContent}
      </aside>
    </>
  );
}
