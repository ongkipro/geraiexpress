"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";

export type PickupState = { ok?: string; error?: string };

// T-023: a tenant admin points the outlet at one of the seller's saved Mengantar pickup addresses.
// The chosen id is re-read from Mengantar with the tenant's own key, so the stored address and
// area are the provider's, not whatever the form sent. The database re-checks the admin role.
export async function setOutletPickupAction(_: PickupState, form: FormData): Promise<PickupState> {
  const ws = await requireWorkspace();
  if (ws.isDemo) return { error: friendlyError({ message: "demo_restricted" }) };
  if (ws.role !== "tenant_admin") return { error: friendlyError({ message: "admin_required" }) };
  const chosen = String(form.get("pickup_address_id") ?? "");
  const mengantar = await tenantMengantar(ws.tenant.id);
  if (!mengantar.ok) return { error: friendlyError({ message: `mengantar_${mengantar.reason}` }) };
  let addresses;
  try {
    addresses = await mengantar.client.listPickupAddresses();
  } catch (error) {
    return { error: friendlyError({ message: mengantarFailure(error) }) };
  }
  const address = addresses.find((a) => a.id === chosen);
  if (!address) return { error: friendlyError({ message: "pickup_not_found" }) };
  const { error } = await (await dbServer()).rpc("set_outlet_mengantar_pickup", {
    p_outlet: ws.outlet.id, p_address_id: address.id, p_area_id: address.areaId,
    p_address: address.address, p_area: address.area,
  });
  if (error) return { error: friendlyError(error.message === "invalid_input" ? { message: "mengantar_data_unreadable" } : error) };
  revalidatePath("/pengaturan");
  return { ok: `Alamat pickup diatur: ${address.name || address.address}.` };
}
