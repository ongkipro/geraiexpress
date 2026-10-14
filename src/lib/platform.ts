import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Capability =
  | "tenant_governance"
  | "platform_monitoring"
  | "integration_operations"
  | "access_governance"
  | "audit_review";

export const CAPABILITY_LABELS: Record<Capability, string> = {
  tenant_governance: "Tata kelola gerai",
  platform_monitoring: "Pemantauan platform",
  integration_operations: "Operasi integrasi",
  access_governance: "Tata kelola akses admin",
  audit_review: "Tinjau audit",
};

export type PlatformSession = {
  userId: string;
  email: string | null;
  capabilities: Capability[];
  aal2: boolean;
  hasTotp: boolean;
};

// PR-24 / IAM-7: the platform grant is read from the database on each request (a revoked grant
// stops working immediately); the second factor comes from the verified session's assurance
// level. The database re-checks both for every platform read and command.
export const loadPlatform = cache(async (): Promise<PlatformSession | null> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || auth.user.is_anonymous) return null;
  const { data: grant } = await supabase.from("platform_grants")
    .select("capabilities").eq("user_id", auth.user.id).is("revoked_at", null).maybeSingle();
  if (!grant) return null;
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  return {
    userId: auth.user.id,
    email: auth.user.email ?? null,
    capabilities: grant.capabilities as Capability[],
    aal2: aal?.currentLevel === "aal2",
    hasTotp: (factors?.totp ?? []).some((f) => f.status === "verified"),
  };
});

// Non-holders get a plain 404 so the platform workspace does not advertise itself.
export async function requirePlatform(capability?: Capability): Promise<PlatformSession> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/masuk");
  const session = await loadPlatform();
  if (!session) notFound();
  if (!session.aal2) redirect("/verifikasi-2fa");
  if (capability && !session.capabilities.includes(capability)) notFound();
  return session;
}
