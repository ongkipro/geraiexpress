"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env, supabaseServer } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { DROP_OFF_UNSUPPORTED, estimateTwoPassCod, InvalidOrderRequest } from "@/lib/mengantar/public-api";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { machineClient } from "@/lib/supabase/machine";
import { workerSecret } from "@/lib/worker-secret";
import { checkPayment, dispatchOperation, payUnpaidShipmentBatch, reconcileOperation, type DispatchSummary } from "@/lib/mengantar/dispatcher";
import { dispatcherDeps } from "@/lib/mengantar/machine-deps";
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
        area: update.recipient_area, area_id: update.recipient_area_id ?? null, postal_code: update.recipient_postal_code, is_primary: true,
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
        // Quote from the shipment's own outlet (dispatch uses the same outlet's pickup).
        const { data: origin } = await supabase.from("shipments").select("outlets(mengantar_area_id)")
          .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle<{ outlets: { mengantar_area_id: string | null } | null }>();
        const quoted = await liveQuotes(ws.tenant.id, origin?.outlets?.mengantar_area_id ?? null, id, revision, update);
        if (quoted.error) return { error: quoted.error + contactNote, values };
        if (quoted.count === 0) {
          const emptyMsg = update.is_cod === true ? friendlyError({ message: "cod_not_supported" }) : "Tidak ada layanan Mengantar untuk rute dan berat ini.";
          return { error: emptyMsg + contactNote, values };
        }
      } else {
        const { error: qe } = await supabase.rpc("request_quotes", { p_shipment: id, p_expected_revision: revision });
        if (qe) return { error: friendlyError(qe) + contactNote, values };
      }
    }
    return { ok: "Ongkir diperbarui. Pilih layanan lalu periksa ringkasan.", warning: contactNote.trim() || undefined };
  }
  return { ok: "Draf tersimpan.", warning: contactNote.trim() || undefined };
}

// T-023 / T-025: live estimate through the tenant's own seller key (membership already verified by
// requireWorkspace), written by the machine identity so the tariff cannot be forged. The counter
// sees the normal tariff (plus COD fee when COD is requested); the net cost after the account
// discount stays private.
async function liveQuotes(tenantId: string, originAreaId: string | null, shipmentId: string, revision: number,
  update: Record<string, unknown>): Promise<{ count: number; error?: undefined } | { error: string; count?: undefined }> {
  if (!originAreaId) return { error: friendlyError({ message: "pickup_not_set" }) };
  const isCod = update.is_cod === true;
  const goodsValueIdr = Number(update.goods_value_idr ?? 0);
  if (isCod && (!Number.isSafeInteger(goodsValueIdr) || goodsValueIdr < 1000)) {
    return { error: friendlyError({ message: "cod_goods_value_required" }) };
  }
  const mengantar = await tenantMengantar(tenantId);
  if (!mengantar.ok) return { error: friendlyError({ message: `mengantar_${mengantar.reason}` }) };
  const machine = machineClient();
  if (!machine) return { error: friendlyError({ message: "mengantar_not_configured" }) };
  const dims = {
    ...(typeof update.length_cm === "number" ? { lengthCm: update.length_cm } : {}),
    ...(typeof update.width_cm === "number" ? { widthCm: update.width_cm } : {}),
    ...(typeof update.height_cm === "number" ? { heightCm: update.height_cm } : {}),
  };
  let estimates;
  try {
    if (isCod) {
      estimates = await estimateTwoPassCod((input) => mengantar.client.estimate(input), {
        originAreaId,
        destinationAreaId: String(update.recipient_area_id),
        weightGrams: Number(update.weight_grams),
        goodsValueIdr,
        ...dims,
      });
    } else {
      estimates = await mengantar.client.estimate({
        originAreaId,
        destinationAreaId: String(update.recipient_area_id),
        weightGrams: Number(update.weight_grams),
        ...dims,
      });
    }
  } catch (error) {
    if (error instanceof InvalidOrderRequest) {
      return { error: friendlyError({ message: error.reason }) };
    }
    return { error: friendlyError({ message: mengantarFailure(error) }) };
  }
  const rows = estimates.filter((e) => !DROP_OFF_UNSUPPORTED.has(e.courier))
    .map((e) => ({
      courier: e.courier,
      tariff: e.tariff,
      net: e.netShipping,
      cod_fee: isCod ? e.codFee : 0,
      cod_supported: true,
      eta: (e.etaText ?? "").slice(0, 40),
    }));
  if (isCod && rows.length === 0) {
    return { error: friendlyError({ message: "cod_not_supported" }) };
  }
  const { data, error } = await machine.rpc("record_live_quotes", {
    p_tenant: tenantId, p_shipment: shipmentId, p_expected_revision: revision, p_rows: rows,
  });
  // invalid_input here means Mengantar sent data we could not store, not a form problem.
  if (error) return { error: friendlyError(error.message === "invalid_input" ? { message: "mengantar_data_unreadable" } : error) };
  return { count: Number(data) };
}

export type ConfirmState = { error?: string };

// DEC-010: the dispatcher's machine identity, from Worker bindings. Null => fail closed (the
// operation stays queued and the cron sweep or "Kirim sekarang" sends it later).
function machineDeps() {
  return dispatcherDeps({
    SUPABASE_URL: env("SUPABASE_URL"),
    SUPABASE_SECRET_KEY: workerSecret("SUPABASE_SECRET_KEY"),
    CREDENTIAL_KEY: workerSecret("CREDENTIAL_KEY"),
    MENGANTAR_ENV: workerSecret("MENGANTAR_ENV"),
  });
}

// The newest create operation of a shipment the caller can see (RLS: members only).
async function shipmentOperation(shipmentId: string, tenantId: string) {
  const { data } = await (await supabaseServer()).from("provider_operations")
    .select("id, state, result_code, is_simulated").eq("tenant_id", tenantId).eq("shipment_id", shipmentId)
    .eq("kind", "create_order").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; state: string; result_code: string | null; is_simulated: boolean } | null;
}

// Counts-only log of an interactive dispatch step (the cron logs its own), then the page flag.
const outcomeFlag = (step: string, summary: DispatchSummary) => {
  console.log(JSON.stringify({ event: "dispatch_action", step, status: summary.status,
    outcome: "outcome" in summary ? summary.outcome : undefined, reason: "reason" in summary ? summary.reason : undefined,
    priceMismatch: "priceMismatch" in summary ? summary.priceMismatch : undefined,
    priceUnknown: "priceUnknown" in summary ? summary.priceUnknown : undefined }));
  return summary.status === "recorded" ? `hasil=${summary.outcome}`
    : summary.status === "record_failed" ? "hasil=unknown"
    : `info=${encodeURIComponent(summary.reason)}`;
};

export async function confirmShipmentAction(_: ConfirmState, form: FormData): Promise<ConfirmState> {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("confirm_shipment", {
    p_shipment: id,
    p_quote: String(form.get("quote_id")),
    p_expected_revision: Number(form.get("revision")),
    p_idempotency_key: String(form.get("idempotency_key")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengiriman");
  const result = data as { operation_id: string; state: string; simulated: boolean; replayed: boolean };
  if (result.simulated) redirect(`/pengiriman/${id}?terbit=1`);
  // A real order: send it now with the machine identity (TD-3). A replayed confirmation never
  // sends again; it shows the original operation's state.
  if (result.replayed || result.state !== "queued") redirect(`/pengiriman/${id}`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  redirect(`/pengiriman/${id}?${outcomeFlag("confirm", await dispatchOperation(result.operation_id, deps))}`);
}

// A queued real operation that was not sent (busy seller, missing configuration): send it now.
export async function dispatchQueuedAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const op = await shipmentOperation(id, ws.tenant.id);
  if (!op || op.is_simulated || op.state !== "queued") redirect(`/pengiriman/${id}?galat=nothing_to_dispatch`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  redirect(`/pengiriman/${id}?${outcomeFlag("dispatch", await dispatchOperation(op.id, deps))}`);
}

// DEC-008: resolving an unknown outcome is a tenant-admin action. Demo shipments keep the SQL
// simulation; real ones look the original order up at Mengantar by reference (never resend).
export async function reconcileAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const op = await shipmentOperation(id, ws.tenant.id);
  if (op && !op.is_simulated) {
    if (ws.role !== "tenant_admin") redirect(`/pengiriman/${id}?galat=admin_required`);
    const deps = machineDeps();
    if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
    const summary = await reconcileOperation(op.id, deps);
    if (summary.status === "not_reconcilable") redirect(`/pengiriman/${id}?galat=${encodeURIComponent(summary.reason)}`);
    redirect(`/pengiriman/${id}?${outcomeFlag("reconcile", summary)}`);
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("reconcile_shipment", { p_shipment: id });
  redirect(`/pengiriman/${id}${error ? `?galat=${encodeURIComponent(error.message)}` : "?rekonsiliasi=1"}`);
}

// An unpaid Mengantar order: has the seller paid it in the Mengantar app yet?
export async function checkPaymentAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const op = await shipmentOperation(id, ws.tenant.id);
  if (!op || op.is_simulated) redirect(`/pengiriman/${id}?galat=nothing_to_check`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  const summary = await checkPayment(op.id, deps);
  if (summary.status === "not_reconcilable") redirect(`/pengiriman/${id}?galat=${encodeURIComponent(summary.reason)}`);
  redirect(`/pengiriman/${id}?${outcomeFlag("payment", summary)}`);
}

// T-026: tenant admin pays an unpaid Mengantar batch after reviewing its full membership and digest.
export async function payUnpaidBatchAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const batchDigest = String(form.get("batch_digest") ?? "").trim();
  if (ws.role !== "tenant_admin") redirect(`/pengiriman/${id}?galat=admin_required`);
  const supabase = await supabaseServer();
  const { error: reviewError } = await supabase.rpc("review_unpaid_batch", { p_shipment: id });
  if (reviewError) redirect(`/pengiriman/${id}?galat=${encodeURIComponent(reviewError.message)}`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  const summary = await payUnpaidShipmentBatch(id, batchDigest, deps);
  revalidatePath("/pengiriman");
  revalidatePath(`/pengiriman/${id}`);
  if (summary.status === "not_reconcilable") {
    const detailParam = summary.detail ? `&detail=${encodeURIComponent(summary.detail)}` : "";
    redirect(`/pengiriman/${id}?galat=${encodeURIComponent(summary.reason)}${detailParam}`);
  }
  redirect(`/pengiriman/${id}?${outcomeFlag("pay_batch", summary)}`);
}

// After a definite refusal (nothing created at Mengantar) the counter fixes the draft and retries.
export async function reopenAction(form: FormData) {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const { error } = await (await supabaseServer()).rpc("reopen_shipment", { p_shipment: id });
  redirect(`/pengiriman/${id}${error ? `?galat=${encodeURIComponent(error.message)}` : ""}`);
}

// A tenant admin closes an unresolved failure after checking the Mengantar app (audited; the
// database re-checks the role, age and that a re-check ran). The shipment can then be reopened.
export async function closeFailedAction(form: FormData) {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const { error } = await (await supabaseServer()).rpc("close_failed_operation", {
    p_shipment: id, p_reason: String(form.get("reason") ?? ""),
  });
  redirect(`/pengiriman/${id}${error ? `?galat=${encodeURIComponent(error.message)}` : "?info=closed"}`);
}

export async function requestLabelAction(form: FormData) {
  await requireWorkspace();
  const id = String(form.get("shipment_id"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("request_label", { p_shipment: id });
  if (error) redirect(`/pengiriman/${id}?galat=${encodeURIComponent(error.message)}`);
  redirect(`/pengiriman/${id}/label`);
}
