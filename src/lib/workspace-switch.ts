import "server-only";
import type { Db } from "@/lib/db/client";

// Gerai switcher (UX-11 / SUP-14): the user's active memberships through their own session, so
// RLS scopes the list. Used by the workspace shell (to show "Ganti gerai" only when it matters)
// and by /pilih-gerai (to render for a user who already has a gerai selected).
export type SwitchableTenant = { id: string; name: string };

export async function listSwitchableTenants(db: Db, userId: string): Promise<SwitchableTenant[]> {
  const { data } = await db
    .from("memberships")
    .select("tenant_id, tenants(id, name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .returns<{ tenant_id: string; tenants: { id: string; name: string } | null }[]>();
  return (data ?? [])
    .filter((m) => m.tenants)
    .map((m) => ({ id: m.tenant_id, name: m.tenants!.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}
