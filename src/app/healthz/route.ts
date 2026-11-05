import { config } from "@/lib/config";
import { runtimeConfigProblems } from "@/lib/startup";
import { mintStaticJwt } from "../../lib/auth/jwt";
import { schemaReady } from "../../lib/schema-version";

export const dynamic = "force-dynamic";

async function rpc(base: string, fn: string, signal: AbortSignal, bearer?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(`${base}/rpc/${fn}`, {
    method: "POST", headers, body: "{}", cache: "no-store", redirect: "error", signal,
  });
  if (response.ok) return await response.json();
  // PostgREST answers an unknown function with 404 PGRST202: the database predates public.schema_version
  // (the first deploy of T-109 before its migration), which is "schema behind", not an outage.
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    if (body?.code === "PGRST202") return MISSING;
  }
  return null;
}

const MISSING = Symbol("missing function");

export async function GET() {
  // Readiness (T-105, T-109): the server configuration must load (the same validators as startup and
  // sign-in: the auth service, PostgREST URL, tracking secret), the anonymous registration_open RPC must
  // perform a real SQL read, AND the applied schema must not be older than the image expects
  // (public.schema_version, machine-only, against EXPECTED_SCHEMA_VERSION). A newer schema is ready
  // (forward-compatible). registration_open=false is still ready. Neither the configuration problems nor
  // upstream details are returned; only a schema behind the image is named, so a deploy can tell
  // "migrate first" from an outage.
  let ok = false;
  let reason: "schema_behind" | undefined;
  try {
    const url = config("POSTGREST_URL");
    const jwtSecret = config("AUTH_JWT_SECRET");
    if (url && jwtSecret && runtimeConfigProblems().length === 0) {
      const base = url.replace(/\/$/, "");
      const signal = AbortSignal.timeout(2000);
      const machine = await mintStaticJwt(jwtSecret, "service_role", 60);
      const [open, version] = await Promise.all([
        rpc(base, "registration_open", signal),
        rpc(base, "schema_version", signal, machine),
      ]);
      if (typeof open === "boolean") {
        ok = schemaReady(version);
        if (!ok && (version === MISSING || (typeof version === "string" && /^[0-9]{14}$/.test(version)))) {
          reason = "schema_behind";
        }
      }
    }
  } catch {
    // Neither an upstream body nor a connection string belongs in a public health response.
  }
  return Response.json(
    { ok, service: "geraiexpress", ...(reason ? { reason } : {}) },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
