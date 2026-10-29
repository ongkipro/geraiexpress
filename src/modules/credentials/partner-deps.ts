import "server-only";
import { keyMaterialFromReader } from "@/lib/credential-crypto";
import { DEFAULT_PARTNER_ID, type PartnerOnboardingDeps } from "@/lib/mengantar/partner-onboarding";
import type { Db } from "@/lib/db/client";
import { machineClient } from "@/lib/db/server";
import { config } from "@/lib/config";
import { configuredPartnerDocuments } from "./partner-config";

// T-032/T-034: begin/status/recovery use the caller's session; the seller binding and sealed key are
// written only through the machine identity (service_role-only RPCs), and only for the tenant of
// the server-verified workspace. No machine identity => null (fail closed, nothing is called).
export async function partnerDeps(db: Db): Promise<PartnerOnboardingDeps | null> {
  const machine = await machineClient();
  if (!machine) return null;
  return {
    rpc: (fn, args) => db.rpc(fn, args),
    machineRpc: (fn, args) => machine.rpc(fn, args),
    environment: config("MENGANTAR_ENV"),
    partnerId: config("PARTNER_ID") ?? DEFAULT_PARTNER_ID,
    partnerSecret:
      config("MENGANTAR_PARTNER_SECRET") ?? config("GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET"),
    credentialKey: keyMaterialFromReader(config),
    consentDocuments: configuredPartnerDocuments(),
  };
}
