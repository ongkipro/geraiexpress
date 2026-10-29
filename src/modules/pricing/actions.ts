"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { formatPercentBps, parsePercentToBps } from "./percent";

export type DiscountState = { error?: string; ok?: string; version?: number };

const STATUSES = new Set(["owner_stated", "provider_observed", "provider_verified"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PR-23 / DATA-9 / UX-12: create the next version of a tenant's gerai discount terms (an empty
// tenant is the platform default template). The capability, aal2 and the live grant are enforced by
// the database function; requirePlatform only keeps non-holders out of the action. The remainder is
// never an input: it is derived in the read model.
export async function setGeraiDiscountAction(_: DiscountState, form: FormData): Promise<DiscountState> {
  await requirePlatform("integration_operations");
  const tenant = String(form.get("tenant_id") ?? "");
  if (tenant !== "" && !UUID.test(tenant)) return { error: friendlyError({ message: "not_found" }) };
  const basisPoints = parsePercentToBps(String(form.get("percent") ?? ""));
  if (basisPoints === null) return { error: "Isi diskon gerai sebagai persen antara 0 dan 100 dengan maksimal dua desimal, misalnya 12,5." };
  const status = tenant === "" ? "owner_stated" : String(form.get("status") ?? "");
  if (!STATUSES.has(status)) return { error: friendlyError({ message: "invalid_input" }) };

  const db = await dbServer();
  const { data, error } = await db.rpc("platform_set_gerai_discount", {
    p_tenant: tenant === "" ? null : tenant,
    p_expected_version: Number(form.get("expected_version") ?? 0),
    p_bps: basisPoints,
    p_effective: String(form.get("effective") ?? ""),
    p_status: status,
    p_source: String(form.get("source") ?? ""),
    p_verification: status === "provider_verified" ? String(form.get("verification") ?? "") : null,
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) {
    // A stale screen reloads the current version; the typed values stay in the form.
    if (error.message === "stale_state") {
      revalidatePath("/admin/diskon", "layout");
      return { error: "Versi diskon berubah sejak halaman dibuka. Versi terbaru sudah dimuat; periksa lagi sebelum menyimpan." };
    }
    if (error.message === "discount_above_observed") {
      const observed = /observed_bps=(\d+)/.exec(error.details ?? "")?.[1];
      if (observed !== undefined) {
        const y = formatPercentBps(Number(observed));
        return {
          error: `Diskon gerai ${formatPercentBps(basisPoints)} melebihi diskon Mengantar tertinggi yang teramati (${y}). GeraiExpress tidak menanggung selisihnya, sehingga nilai ini tidak dapat disimpan. Turunkan diskon gerai menjadi ${y} atau lebih rendah.`,
        };
      }
    }
    if (error.message === "provider_observed_mismatch") {
      const observed = /observed_bps=(\d+)/.exec(error.details ?? "")?.[1];
      if (observed !== undefined) {
        return {
          error: `Status Teramati dari Mengantar hanya untuk nilai yang sama persis dengan diskon Mengantar tertinggi yang teramati (${formatPercentBps(Number(observed))}). Samakan nilainya atau pilih status Pernyataan pemilik.`,
        };
      }
    }
    return { error: friendlyError(error) };
  }
  revalidatePath("/admin/diskon", "layout");
  return { ok: `Versi ${data as number} disimpan dan tercatat di audit.`, version: data as number };
}
