import "server-only";
import { dbServer } from "@/lib/db/server";
import { geraiLogoDataUrl, type GeraiLogoState } from "./gerai-logo";

// User-scoped RPC (no service client/cache). A failed read is distinct from a gerai with no logo.
export async function readGeraiLogo(tenantId: string): Promise<GeraiLogoState | null> {
  try {
    const { data, error } = await (await dbServer()).rpc("tenant_logo", { p_tenant: tenantId });
    if (error || !data || !Number.isInteger(data.revision) || data.revision < 0
      || (data.logo !== null && !geraiLogoDataUrl(data.logo))) return null;
    return data as GeraiLogoState;
  } catch {
    return null;
  }
}
