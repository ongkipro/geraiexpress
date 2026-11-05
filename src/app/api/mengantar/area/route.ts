import { loadWorkspace } from "@/lib/workspace";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { dbServer } from "@/lib/db/server";
import type { AreaOption } from "@/lib/mengantar/public-api";
import { LIMITS, limiterFor } from "../../../../lib/limiter";

type CatalogueArea = Omit<AreaOption, "zip"> & { postal_code: string };

// T-100 / T-023: reference catalogue first, with the caller's verified membership (demo included).
// Only a genuine catalogue miss may use the non-demo tenant's own connected seller key.
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });

export async function GET(request: Request) {
  const loaded = await loadWorkspace();
  if (loaded.kind !== "ready") return json({ error: "unauthorized" }, 401);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 60) return json({ areas: [] });
  const db = await dbServer();
  const { data, error } = await db.rpc("search_mengantar_areas", { p_query: q, p_limit: 30 });
  if (error) return json({ error: "mengantar_unavailable" }, 503);
  const areas = ((data ?? []) as CatalogueArea[]).map(({ postal_code, ...area }) => ({ ...area, zip: postal_code }));
  if (areas.length || loaded.workspace.isDemo) return json({ areas, source: "catalogue" });
  const mengantar = await tenantMengantar(loaded.workspace.tenant.id);
  if (!mengantar.ok) return json({ error: `mengantar_${mengantar.reason}` }, 503);
  // Only live provider calls spend this tenant's budget; catalogue hits and demo misses never do.
  if (!(await limiterFor("MENGANTAR_AREA_LIMITER").limit({ key: loaded.workspace.tenant.id })).success) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(LIMITS.MENGANTAR_AREA_LIMITER.periodSeconds) });
  }
  try {
    return json({ areas: (await mengantar.client.searchAreas(q)).slice(0, 30), source: "mengantar" });
  } catch (error) {
    return json({ error: mengantarFailure(error) }, 502);
  }
}
