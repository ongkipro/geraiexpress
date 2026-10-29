import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  // This anonymous RPC performs a real SQL read. Readiness must cover the data API and
  // schema, without minting a machine token or returning deployment details.
  let ok = false;
  try {
    const base = config("POSTGREST_URL");
    if (base) {
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
