import { config } from "@/lib/config";
import { runtimeConfigProblems } from "@/lib/startup";

export const dynamic = "force-dynamic";

export async function GET() {
  // Readiness (T-105): the server configuration must load (the same validators as startup and sign-in:
  // the auth service, PostgREST URL, tracking secret) AND this anonymous RPC must perform a real SQL read,
  // covering the data API and schema without minting a machine token. registration_open=false is still
  // ready. Neither the configuration problems nor upstream details are returned.
  let ok = false;
  try {
    const base = config("POSTGREST_URL");
    if (base && runtimeConfigProblems().length === 0) {
      const response = await fetch(`${base.replace(/\/$/, "")}/rpc/registration_open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(2000),
      });
      const value: unknown = response.ok ? await response.json() : null;
      ok = typeof value === "boolean";
    }
  } catch {
    // Neither an upstream body nor a connection string belongs in a public health response.
  }
  return Response.json(
    { ok, service: "geraiexpress" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
