import { createAdminClient } from "@/lib/supabase/admin";
import { Suspense } from "react";
import { SearchInput } from "./search-input";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

const PAGE_SIZE = 50;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ role?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const roleFilter = params.role || "all";
  const searchQuery = params.q || "";
  const page = Math.max(1, parseInt(params.page || "1"));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = createAdminClient();
  let query = supabase.from("users").select("id, email, display_name, photo_url, role, phone_number, marketing_consent, city, country, auth_provider, is_email_verified, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (roleFilter !== "all") query = query.eq("role", roleFilter);
  if (searchQuery) query = query.or(`display_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
  const { data: users, count } = await query;
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <DisplayHeading>Users</DisplayHeading>
          <p className="mt-1 text-sm text-charcoal-muted">All registered users on the platform {count != null && `(${count})`}</p>
        </div>
        <Suspense fallback={null}><SearchInput /></Suspense>
      </div>
      <div className="mt-6 flex gap-1.5 rounded-2xl bg-white/60 p-1.5 backdrop-blur-sm border border-berry/5 shadow-sm w-fit">
        {["all", "client", "therapist"].map((role) => (
          <a key={role} href={role === "all" ? "/dashboard/users" : `/dashboard/users?role=${role}`}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${roleFilter === role ? "bg-berry text-white shadow-md shadow-berry/15" : "text-charcoal-muted hover:text-charcoal hover:bg-berry-subtle/30"}`}>
            {role === "all" ? "All" : role.charAt(0).toUpperCase() + role.slice(1) + "s"}
          </a>
        ))}
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
        <table className="min-w-full divide-y divide-berry/5">
          <thead className="bg-cream-dark/50">
            <tr>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">User</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Role</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Provider</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Phone</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Location</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-berry/5">
            {(users || []).map((u: any) => (
              <tr key={u.id} className="transition-colors hover:bg-berry-subtle/10">
                <td className="whitespace-nowrap px-6 py-4"><div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-berry-subtle to-berry-muted/20 text-xs font-bold text-berry-dark">{u.display_name?.[0]?.toUpperCase() || "?"}</div>
                  <div><p className="text-sm font-semibold text-charcoal">{u.display_name || "\u2014"}</p><p className="text-xs text-charcoal-muted">{u.email || "No email"}</p></div>
                </div></td>
                <td className="whitespace-nowrap px-6 py-4"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.role === "therapist" ? "bg-berry-subtle/60 text-berry-dark" : u.role === "client" ? "bg-info-light text-info" : "bg-cream-dark text-charcoal-muted"}`}>{u.role || "No role"}</span></td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-charcoal-muted capitalize">{u.auth_provider || "\u2014"}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-charcoal">
                  {u.phone_number ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular-nums">{u.phone_number}</span>
                      <span
                        title={u.marketing_consent ? "Consenso marketing: s\u00ec \u2014 contattabile" : "Nessun consenso marketing \u2014 non contattare per promozioni"}
                        className={`h-2 w-2 flex-shrink-0 rounded-full ${u.marketing_consent ? "bg-success" : "bg-charcoal-muted/30"}`}
                      />
                    </span>
                  ) : (
                    <span className="text-charcoal-muted">{"\u2014"}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-charcoal-muted">{u.city ? `${u.city}${u.country ? `, ${u.country}` : ""}` : "\u2014"}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-charcoal-muted">{new Date(u.created_at).toLocaleDateString("it-IT")}</td>
              </tr>
            ))}
            {(!users || users.length === 0) && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-charcoal-muted">No users found</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {page > 1 && (
            <a href={`/dashboard/users?role=${roleFilter}${searchQuery ? `&q=${searchQuery}` : ""}&page=${page - 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Previous</a>
          )}
          <span className="text-sm text-charcoal-muted">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`/dashboard/users?role=${roleFilter}${searchQuery ? `&q=${searchQuery}` : ""}&page=${page + 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Next</a>
          )}
        </div>
      )}
    </div>
  );
}
