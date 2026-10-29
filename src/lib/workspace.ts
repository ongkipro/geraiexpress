import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestScope } from "@/lib/hosts";
import { currentUser, dbServer } from "@/lib/db/server";

export const TENANT_COOKIE = "ge_tenant";

export type Workspace = {
  userId: string;
  email: string | null;
  isDemo: boolean;
  role: "tenant_admin" | "operator";
  // How many active gerai the user belongs to (already read for the selector): the shell shows
  // "Ganti gerai" from it without a second memberships query.
  activeMembershipCount: number;
  tenant: { id: string; name: string };
  outlet: {
    id: string; name: string; pickupAddress: string | null; pickupArea: string | null;
    // Mengantar saved pickup address and its area (set by a tenant admin; T-023).
    mengantarPickupId: string | null; mengantarAreaId: string | null;
  };
};

type MembershipRow = {
  tenant_id: string;
  role: Workspace["role"];
  tenants: { id: string; name: string; is_demo: boolean } | null;
};

// Resolves the current user and the tenant they may act in. The ge_tenant cookie is only a
// selector; it must match one of the user's active memberships (RLS returns only those). The
// owner, hooks and public hosts have no tenant context (TEN-6): a Server Action id posted there
// finds no workspace, whatever session or cookie arrives.
export const loadWorkspace = cache(async (): Promise<
  | { kind: "anonymous" }
  | { kind: "no-access"; email: string | null; isAnonymous: boolean }
  | { kind: "choose"; tenants: { id: string; name: string }[] }
  | { kind: "ready"; workspace: Workspace }
> => {
  const scope = await requestScope();
  if (scope !== "tenant" && scope !== "shared") return { kind: "anonymous" };
  const user = await currentUser();
  if (!user) return { kind: "anonymous" };
  const db = await dbServer();

  const { data: rows } = await db
    .from("memberships")
    .select("tenant_id, role, tenants(id, name, is_demo)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<MembershipRow[]>();
  const memberships = (rows ?? []).filter((m) => m.tenants);
  if (memberships.length === 0) {
    return { kind: "no-access", email: user.email, isAnonymous: user.isAnonymous };
  }

  const selector = (await cookies()).get(TENANT_COOKIE)?.value;
  const chosen =
    memberships.find((m) => m.tenant_id === selector) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) {
    return { kind: "choose", tenants: memberships.map((m) => ({ id: m.tenant_id, name: m.tenants!.name })) };
  }

  const { data: outlets } = await db
    .from("outlets")
    .select("id, name, pickup_address, pickup_area, mengantar_pickup_address_id, mengantar_area_id")
    .eq("tenant_id", chosen.tenant_id)
    .order("created_at")
    .limit(1);
  const outlet = outlets?.[0];
  if (!outlet) return { kind: "no-access", email: user.email, isAnonymous: false };

  return {
    kind: "ready",
    workspace: {
      userId: user.id,
      email: user.email,
      isDemo: chosen.tenants!.is_demo,
      role: chosen.role,
      activeMembershipCount: memberships.length,
      tenant: { id: chosen.tenant_id, name: chosen.tenants!.name },
      outlet: {
        id: outlet.id,
        name: outlet.name,
        pickupAddress: outlet.pickup_address,
        pickupArea: outlet.pickup_area,
        mengantarPickupId: outlet.mengantar_pickup_address_id,
        mengantarAreaId: outlet.mengantar_area_id,
      },
    },
  };
});

export async function requireWorkspace(): Promise<Workspace> {
  const result = await loadWorkspace();
  if (result.kind === "anonymous") redirect("/masuk");
  if (result.kind === "no-access") redirect("/akses");
  if (result.kind === "choose") redirect("/pilih-gerai");
  return result.workspace;
}
