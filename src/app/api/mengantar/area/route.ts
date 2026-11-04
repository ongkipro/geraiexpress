import { loadWorkspace } from "@/lib/workspace";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { dbServer } from "@/lib/db/server";
import type { AreaOption } from "@/lib/mengantar/public-api";

type CatalogueArea = Omit<AreaOption, "zip"> & { postal_code: string };

// T-100 / T-023: reference catalogue first, with the caller's verified membership (demo included).
// Only a genuine catalogue miss may use the non-demo tenant's own connected seller key.
// lazy: add a per-visitor limiter (src/lib/limiter.ts) if fallback quota pressure is observed.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

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
  try {
    return json({ areas: (await mengantar.client.searchAreas(q)).slice(0, 30), source: "mengantar" });
  } catch (error) {
    return json({ error: mengantarFailure(error) }, 502);
  }
}
