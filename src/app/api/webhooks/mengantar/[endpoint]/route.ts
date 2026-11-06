import { config } from "@/lib/config";
import { cleanupRpc } from "@/lib/mengantar/machine-deps";
import { keyMaterialFromReader } from "@/lib/credential-crypto";
import { handleMengantarWebhook, type WebhookDeps } from "@/lib/mengantar/webhook-ingest";

// T-045 / ADR-0003: Mengantar status webhook. Reachable only on the cookie-less hooks host (src/lib/hosts.ts
// family "hook"); the proxy strips cookies. All checks live in src/lib/mengantar/webhook-ingest.ts.
export const dynamic = "force-dynamic";

function deps(): WebhookDeps | null {
  const rpc = cleanupRpc({ POSTGREST_URL: config("POSTGREST_URL"), AUTH_JWT_SECRET: config("AUTH_JWT_SECRET") });
  let credentialKey: string | undefined;
  try { credentialKey = keyMaterialFromReader(config); } catch { credentialKey = undefined; }
  if (!rpc || !credentialKey) return null;
  return { rpc, credentialKey, now: () => Date.now(), log: (event) => console.log(JSON.stringify(event)) };
}

export async function POST(request: Request, { params }: { params: Promise<{ endpoint: string }> }) {
  return handleMengantarWebhook(request, (await params).endpoint, deps());
}
