import { loadWorkspace } from "@/lib/workspace";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";

// T-023: recipient area search for a connected (non-demo) gerai, through the tenant's own seller
// key. The tenant comes from the caller's verified membership, never from the request.
// lazy: no per-user rate limit beyond the 3-character minimum and the client's debounce; add a
// Workers rate limit binding if Mengantar reports quota pressure.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const loaded = await loadWorkspace();
  if (loaded.kind !== "ready") return json({ error: "unauthorized" }, 401);
  if (loaded.workspace.isDemo) return json({ error: "demo_restricted" }, 403);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 60) return json({ areas: [] });
  const mengantar = await tenantMengantar(loaded.workspace.tenant.id);
  if (!mengantar.ok) return json({ error: `mengantar_${mengantar.reason}` }, 503);
  try {
    return json({ areas: (await mengantar.client.searchAreas(q)).slice(0, 30) });
  } catch (error) {
    return json({ error: mengantarFailure(error) }, 502);
  }
}
