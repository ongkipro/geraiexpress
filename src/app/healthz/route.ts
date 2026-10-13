export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, service: "geraiexpress" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
