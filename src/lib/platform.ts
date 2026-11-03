import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { requestScope } from "@/lib/hosts";
import { AuthUnavailableError } from "@/lib/auth/store";
import { currentUser, dbServer, machineClient } from "@/lib/db/server";

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
// level. The database re-checks both for every platform read and command. Only the owner host
// has a platform context (TEN-6): a Server Action id posted to another host finds no grant.
export const loadPlatform = cache(async (): Promise<PlatformSession | null> => {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return null;
  const user = await currentUser();
  if (!user || user.isAnonymous) return null;
  const db = await dbServer();
  const { data: grant } = await db.from("platform_grants")
    .select("capabilities").eq("user_id", user.id).is("revoked_at", null).maybeSingle();
  if (!grant) return null;
  return {
    userId: user.id,
    email: user.email,
    capabilities: grant.capabilities as Capability[],
    aal2: user.aal === "aal2",
    hasTotp: user.aal === "aal2" ? true : await hasVerifiedTotp(user.id),
  };
});

// The factor table is private to the database; only the machine identity reads it, and only for the
// signed-in user's own id. Without the machine identity or an answer from the store, fail closed.
async function hasVerifiedTotp(userId: string): Promise<boolean> {
  const machine = await machineClient();
  if (!machine) throw new AuthUnavailableError("auth_mfa_factor");
  const { data, error } = await machine.rpc("auth_mfa_factor", { p_user: userId });
  if (error) throw new AuthUnavailableError("auth_mfa_factor");
  return (data as { status?: string } | null)?.status === "verified";
}

// Non-holders get a plain 404 so the platform workspace does not advertise itself.
export async function requirePlatform(capability?: Capability): Promise<PlatformSession> {
  if (!(await currentUser())) redirect("/masuk");
  const session = await loadPlatform();
  if (!session) notFound();
  if (!session.aal2) redirect("/verifikasi-2fa");
  if (capability && !session.capabilities.includes(capability)) notFound();
  return session;
}

