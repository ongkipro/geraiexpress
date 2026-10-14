"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { DROP_OFF_UNSUPPORTED } from "@/lib/mengantar/public-api";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { machineClient } from "@/lib/supabase/machine";
import { requireWorkspace } from "@/lib/workspace";
import { missingForQuote, parseDraft, type DraftField, type DraftValues } from "./draft";

export type DraftState = {
  ok?: string;
  warning?: string;
  error?: string;
  fieldErrors?: Partial<Record<DraftField, string>>;
  values?: DraftValues;
};

export async function createDraftAction() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_shipment_draft", { p_outlet: ws.outlet.id });
  if (error) redirect(`/pengiriman?galat=${encodeURIComponent(error.message)}`);
  redirect(`/pengiriman/${data}`);
}

// Saves the draft with optimistic concurrency, optionally saves contacts on explicit request,
// and (intent=quote) requests quotes for exactly the revision that was just saved.
export async function saveDraftAction(_: DraftState, form: FormData): Promise<DraftState> {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const expected = Number(form.get("revision"));
  const intent = form.get("intent") === "quote" ? "quote" : "save";
  const { values, update, errors } = parseDraft(form);
  if (Object.keys(errors).length) {
    return { error: "Periksa isian yang ditandai.", fieldErrors: errors, values };
  }
  // A real (non-demo) gerai quotes live from Mengantar; demo gerai use the SQL simulation.
  const live = !ws.isDemo;
  if (intent === "quote") {
    const missing = missingForQuote(update, live);
    if (missing.length) {
      return {
        error: "Lengkapi data yang ditandai sebelum cek ongkir.",
        fieldErrors: Object.fromEntries(missing.map((f) => [f, "Wajib diisi untuk cek ongkir."])),
        values,
      };
    }
  }

  const supabase = await supabaseServer();
  const senderContact = String(form.get("sender_contact_id") ?? "") || null;
  const recipientContact = String(form.get("recipient_contact_id") ?? "") || null;

  // Save the shipment first (optimistic revision), so a stale form never leaves orphan contacts.
  const { data: saved, error } = await supabase.from("shipments")
    .update({ ...update, sender_contact_id: senderContact, recipient_contact_id: recipientContact })
    .eq("id", id).eq("tenant_id", ws.tenant.id).eq("revision", expected)
    .select("revision").maybeSingle();
  if (error) return { error: friendlyError(error), values };
  if (!saved) {
    return {
      error: "Draf ini sudah diubah oleh orang lain atau sudah dikirim. Isian Anda masih di bawah; muat ulang untuk melihat versi terbaru.",
      values,
    };
  }
  let revision = saved.revision as number;

  // PR-2: saving a contact is an explicit choice, never a side effect of quoting. A failure is
  // reported, not swallowed; the draft itself is already safe.
  const saveContact = async (role: "sender" | "recipient"): Promise<string | "failed" | null> => {
    const name = update[`${role}_name`];
    const phone = update[`${role}_phone`];
    if (!name || !phone) return "failed";
    const { data: contact, error: ce } = await supabase.from("contacts")
      .insert({ tenant_id: ws.tenant.id, name, phone, is_sender: role === "sender", is_recipient: role === "recipient" })
      .select("id").single();
    if (ce || !contact) return "failed";
    if (role === "recipient" && update.recipient_address && update.recipient_area) {
      const { error: ae } = await supabase.from("contact_addresses").insert({
        tenant_id: ws.tenant.id, contact_id: contact.id, label: "Utama", address_line: update.recipient_address,
        area: update.recipient_area, postal_code: update.recipient_postal_code, is_primary: true,
      });
      if (ae) return "failed";
    }
    return contact.id as string;
  };
  const failures: string[] = [];
  let notLinked = false;
  const links: { sender_contact_id?: string; recipient_contact_id?: string } = {};
  for (const role of ["sender", "recipient"] as const) {
    const already = role === "sender" ? senderContact : recipientContact;
    if (form.get(`save_${role}`) !== "on" || already) continue;
    const result = await saveContact(role);
    if (result === "failed" || result === null) failures.push(role === "sender" ? "pengirim" : "penerima");
    else links[`${role}_contact_id`] = result;
  }
  if (Object.keys(links).length) {
    const { data: linked } = await supabase.from("shipments").update(links)
      .eq("id", id).eq("tenant_id", ws.tenant.id).eq("revision", revision).select("revision").maybeSingle();
    if (linked) revision = linked.revision as number;
    else notLinked = true;
  }

  revalidatePath(`/pengiriman/${id}`);
  const contactNote =
    (failures.length ? ` Kontak ${failures.join(" dan ")} belum tersimpan; simpan dari menu Kontak.` : "") +
    (notLinked ? " Kontak baru tersimpan, tetapi belum tertaut ke draf ini karena draf berubah." : "");
  if (intent === "quote") {
    // Re-quoting an unchanged revision reuses its current quotes instead of duplicating them.
    const { count } = await supabase.from("shipment_quotes").select("id", { count: "exact", head: true })
      .eq("tenant_id", ws.tenant.id).eq("shipment_id", id).eq("shipment_revision", revision)
      .gt("expires_at", new Date().toISOString());
    if (!count) {
      if (live) {
        const quoted = await liveQuotes(ws.tenant.id, ws.outlet.mengantarAreaId, id, revision, update);
        if (quoted.error) return { error: quoted.error + contactNote, values };
        if (quoted.count === 0) return { error: "Tidak ada layanan Mengantar untuk rute dan berat ini." + contactNote, values };
      } else {
        const { error: qe } = await supabase.rpc("request_quotes", { p_shipment: id, p_expected_revision: revision });
        if (qe) return { error: friendlyError(qe) + contactNote, values };
      }
    }
    return { ok: "Ongkir diperbarui. Pilih layanan lalu periksa ringkasan.", warning: contactNote.trim() || undefined };
  }
  return { ok: "Draf tersimpan.", warning: contactNote.trim() || undefined };
}

// T-023: live estimate through the tenant's own seller key (membership already verified by
// requireWorkspace), written by the machine identity so the tariff cannot be forged. The counter
// sees the normal tariff; the net cost after the account discount stays private.
// lazy: billable weight is the actual weight; volumetric weight and COD quotes come with T-024.
async function liveQuotes(tenantId: string, originAreaId: string | null, shipmentId: string, revision: number,
  update: Record<string, unknown>): Promise<{ count: number; error?: undefined } | { error: string; count?: undefined }> {
  if (!originAreaId) return { error: friendlyError({ message: "pickup_not_set" }) };
  const mengantar = await tenantMengantar(tenantId);
  if (!mengantar.ok) return { error: friendlyError({ message: `mengantar_${mengantar.reason}` }) };
  const machine = machineClient();
  if (!machine) return { error: friendlyError({ message: "mengantar_not_configured" }) };
  let estimates;
  try {
    estimates = await mengantar.client.estimate({
      originAreaId, destinationAreaId: String(update.recipient_area_id), weightGrams: Number(update.weight_grams),
    });
  } catch (error) {
    return { error: friendlyError({ message: mengantarFailure(error) }) };
  }
  const rows = estimates.filter((e) => !DROP_OFF_UNSUPPORTED.has(e.courier))
    .map((e) => ({ courier: e.courier, tariff: e.tariff, net: e.netShipping, eta: (e.etaText ?? "").slice(0, 40) }));
  const { data, error } = await machine.rpc("record_live_quotes", {
    p_tenant: tenantId, p_shipment: shipmentId, p_expected_revision: revision, p_rows: rows,
  });
  // invalid_input here means Mengantar sent data we could not store, not a form problem.
  if (error) return { error: friendlyError(error.message === "invalid_input" ? { message: "mengantar_data_unreadable" } : error) };
  return { count: Number(data) };
}

export type ConfirmState = { error?: string };

export async function confirmShipmentAction(_: ConfirmState, form: FormData): Promise<ConfirmState> {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("confirm_shipment", {
    p_shipment: id,
    p_quote: String(form.get("quote_id")),
    p_expected_revision: Number(form.get("revision")),
    p_idempotency_key: String(form.get("idempotency_key")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengiriman");
  redirect(`/pengiriman/${id}?terbit=1`);
}

export async function reconcileAction(form: FormData) {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("reconcile_shipment", { p_shipment: id });
  redirect(`/pengiriman/${id}${error ? `?galat=${encodeURIComponent(error.message)}` : "?rekonsiliasi=1"}`);
}

export async function requestLabelAction(form: FormData) {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("request_label", { p_shipment: id });
  if (error) redirect(`/pengiriman/${id}?galat=${encodeURIComponent(error.message)}`);
  redirect(`/pengiriman/${id}/label`);
}
