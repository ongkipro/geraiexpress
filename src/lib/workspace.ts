import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const TENANT_COOKIE = "ge_tenant";

export type Workspace = {
  userId: string;
  email: string | null;
  isDemo: boolean;
  role: "tenant_admin" | "operator";
  tenant: { id: string; name: string };
  outlet: { id: string; name: string; pickupAddress: string | null; pickupArea: string | null };
};

type MembershipRow = {
  tenant_id: string;
  role: Workspace["role"];
  tenants: { id: string; name: string; is_demo: boolean } | null;
};

// Resolves the current user and the tenant they may act in. The ge_tenant cookie is only a
// selector; it must match one of the user's active memberships (RLS returns only those).
export const loadWorkspace = cache(async (): Promise<
  | { kind: "anonymous" }
  | { kind: "no-access"; email: string | null; isAnonymous: boolean }
  | { kind: "choose"; tenants: { id: string; name: string }[] }
  | { kind: "ready"; workspace: Workspace }
> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { kind: "anonymous" };

  const { data: rows } = await supabase
    .from("memberships")
    .select("tenant_id, role, tenants(id, name, is_demo)")
    .eq("user_id", auth.user.id)
    .eq("status", "active")
    .returns<MembershipRow[]>();
  const memberships = (rows ?? []).filter((m) => m.tenants);
  if (memberships.length === 0) {
    return { kind: "no-access", email: auth.user.email ?? null, isAnonymous: auth.user.is_anonymous ?? false };
  }

  const selector = (await cookies()).get(TENANT_COOKIE)?.value;
  const chosen =
    memberships.find((m) => m.tenant_id === selector) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) {
    return { kind: "choose", tenants: memberships.map((m) => ({ id: m.tenant_id, name: m.tenants!.name })) };
  }

  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, name, pickup_address, pickup_area")
    .eq("tenant_id", chosen.tenant_id)
    .order("created_at")
    .limit(1);
  const outlet = outlets?.[0];
  if (!outlet) return { kind: "no-access", email: auth.user.email ?? null, isAnonymous: false };

  return {
    kind: "ready",
    workspace: {
      userId: auth.user.id,
      email: auth.user.email ?? null,
      isDemo: chosen.tenants!.is_demo,
      role: chosen.role,
      tenant: { id: chosen.tenant_id, name: chosen.tenants!.name },
      outlet: {
        id: outlet.id,
        name: outlet.name,
        pickupAddress: outlet.pickup_address,
        pickupArea: outlet.pickup_area,
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
