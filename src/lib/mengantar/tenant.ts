import "server-only";
import { credentialAad, openCredential } from "@/lib/credential-crypto";
import { machineClient } from "@/lib/supabase/machine";
import { workerSecret } from "@/lib/worker-secret";
import { createMengantarPublicClient, MengantarError, type MengantarEnvironment } from "./public-api";

// Error code for a failed Mengantar call, for friendlyError.
export function mengantarFailure(error: unknown): string {
  if (error instanceof MengantarError) {
    if (error.code === "not_allowed") return "mengantar_key_refused";
    if (error.code === "rejected") return "mengantar_refused";
  }
  return "mengantar_unavailable";
}

export type TenantMengantar =
  | { ok: true; client: ReturnType<typeof createMengantarPublicClient>; environment: MengantarEnvironment }
  | { ok: false; reason: "not_configured" | "no_key" | "key_unreadable" };

// The Mengantar client for a tenant whose membership the caller has ALREADY verified with the
// user's session (requireWorkspace). Opens the sealed seller key inside the Worker; the key
// never leaves this function's closure. Fails closed when any piece of configuration is missing.
export async function tenantMengantar(tenantId: string): Promise<TenantMengantar> {
  const environment = workerSecret("MENGANTAR_ENV");
  const credentialKey = workerSecret("CREDENTIAL_KEY");
  const machine = machineClient();
  if ((environment !== "sandbox" && environment !== "production") || !credentialKey || !machine) {
    return { ok: false, reason: "not_configured" };
  }
  const { data, error } = await machine.rpc("machine_seller_key", { p_tenant: tenantId });
  if (error || !data) return { ok: false, reason: "no_key" };
  const sealed = data as { ciphertext: string; iv: string; version: number };
  try {
    const apiKey = await openCredential(sealed, credentialAad(tenantId, sealed.version), credentialKey);
    return { ok: true, client: createMengantarPublicClient(environment, apiKey), environment };
  } catch {
    return { ok: false, reason: "key_unreadable" };
  }
}
