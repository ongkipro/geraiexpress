"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbServer, machineClient } from "@/lib/db/server";
import { friendlyError, isKnownErrorCode } from "@/lib/errors";
import { CLOSE_ERROR, DISPATCH_INFO } from "@/lib/format";
import { logEvent, withCorrelation } from "@/lib/log";
import { InvalidOrderRequest } from "@/lib/mengantar/public-api";
import { couriersForHandover, quoteServices } from "./handover";
import type { BillableWeightRule } from "@/lib/billable-weight";
import { estimateBillableQuotes } from "@/lib/mengantar/billable-quotes";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import { pickupLeadMinutes } from "@/lib/mengantar/pickup-lead";
import { config } from "@/lib/config";
import { checkPayment, dispatchOperation, payUnpaidShipmentBatch, reconcileOperation, type DispatchSummary } from "@/lib/mengantar/dispatcher";
import { dispatcherDeps } from "@/lib/mengantar/machine-deps";
import { requireWorkspace } from "@/lib/workspace";
import { liveRecipientErrors, missingForQuote, parseDraft, pickupFieldErrors, type DraftField, type DraftValues } from "./draft";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// T-105: only a stable code the pages map (?galat= / ?info=) travels in a URL or a log line. Raw
// PostgREST/PostgreSQL text (which can echo submitted input) and transport errors become "unknown".
function stableCode(code: string | null | undefined): string {
  return isKnownErrorCode(code) || (code && (Object.hasOwn(CLOSE_ERROR, code) || Object.hasOwn(DISPATCH_INFO, code))) ? code! : "unknown";
}
const galat = (error: { message?: string } | null | undefined) => `galat=${stableCode(error?.message)}`;

// The shipment a detail-page form names. Anything but a UUID never reaches the database or a URL.
function shipmentIdOf(form: FormData): string {
  const id = String(form.get("shipment_id") ?? "");
  if (!UUID.test(id)) redirect("/pengiriman?galat=not_found");
  return id;
}

// P2-1: the shipment must belong to the selected gerai before any command runs, so a user with
// memberships in two gerai cannot act on the other one through the workspace they are looking at.
async function inWorkspace(id: string, tenantId: string): Promise<boolean> {
  const { data } = await (await dbServer()).from("shipments").select("id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return Boolean(data);
}
const NOT_FOUND_PATH = "/pengiriman?galat=not_found";

export type DraftState = {
  ok?: string;
  warning?: string;
  error?: string;
  fieldErrors?: Partial<Record<DraftField, string>>;
  values?: DraftValues;
};

export async function createDraftAction() {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { data, error } = await db.rpc("create_shipment_draft", { p_outlet: ws.outlet.id });
  if (error || typeof data !== "string" || !UUID.test(data)) redirect(`/pengiriman?${galat(error)}`);
  redirect(`/pengiriman/${data}`);
}

// Saves the draft with optimistic concurrency, optionally saves contacts on explicit request,
// and (intent=quote) requests quotes for exactly the revision that was just saved.
export async function saveDraftAction(_: DraftState, form: FormData): Promise<DraftState> {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  if (!UUID.test(id)) return { error: friendlyError({ message: "not_found" }) };
  const expected = Number(form.get("revision"));
  const intent = form.get("intent") === "quote" ? "quote" : "save";
  const db = await dbServer();
  // The persisted shipment mode is authoritative, including isolated simulated review fixtures.
  const { data: mode } = await db.from("shipments").select("is_simulated")
    .eq("id", id).eq("tenant_id", ws.tenant.id).maybeSingle();
  if (!mode) return { error: friendlyError({ message: "not_found" }) };
  const live = !mode.is_simulated;
  const leadMinutes = await pickupLeadMinutes(() => db.rpc("pickup_lead_minutes"));
  const { values, update, errors } = parseDraft(form, intent === "quote" && live, new Date(), leadMinutes);
  // T-094: a sender contact keeps its address only as street + area (contact_addresses requires both).
  // When the operator asks to save the sender, a half-entered address is named instead of silently dropped.
  if (form.get("save_sender") === "on" && !form.get("sender_contact_id")) {
    const hasStreet = Boolean(update.sender_address), hasArea = Boolean(update.sender_area);
    if (hasStreet !== hasArea || (update.sender_postal_code && !(hasStreet && hasArea))) {
      if (!hasStreet && !errors.sender_address) errors.sender_address = "Isi alamat pengirim, atau kosongkan semua alamat pengirim, untuk menyimpan kontak.";
      if (!hasArea && !errors.sender_area) errors.sender_area = "Isi kecamatan/kota pengirim, atau kosongkan semua alamat pengirim, untuk menyimpan kontak.";
    }
  }
  if (Object.keys(errors).length) {
    return { error: "Periksa isian yang ditandai.", fieldErrors: errors, values };
  }
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

  const senderContact = String(form.get("sender_contact_id") ?? "") || null;
  const recipientContact = String(form.get("recipient_contact_id") ?? "") || null;

  // Save the shipment first (optimistic revision), so a stale form never leaves orphan contacts.
  const { data: saved, error } = await db.from("shipments")
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
    const { data: contact, error: ce } = await db.from("contacts")
      .insert({ tenant_id: ws.tenant.id, name, phone, is_sender: role === "sender", is_recipient: role === "recipient" })
      .select("id").single();
    if (ce || !contact) return "failed";
    if (role === "recipient" && update.recipient_address && update.recipient_area) {
      const { error: ae } = await db.from("contact_addresses").insert({
        tenant_id: ws.tenant.id, contact_id: contact.id, label: "Utama", address_line: update.recipient_address,
        area: update.recipient_area, area_id: update.recipient_area_id ?? null, postal_code: update.recipient_postal_code, is_primary: true,
      });
      if (ae) return "failed";
    }
    // T-094: a saved sender keeps its street and area as its primary address (the provider area id is a
    // recipient-only concept; the sender address never reaches Mengantar).
    if (role === "sender" && update.sender_address && update.sender_area) {
      const { error: ae } = await db.from("contact_addresses").insert({
        tenant_id: ws.tenant.id, contact_id: contact.id, label: "Utama", address_line: update.sender_address,
        area: update.sender_area, postal_code: update.sender_postal_code ?? null, is_primary: true,
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
    const { data: linked } = await db.from("shipments").update(links)
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
    const { count } = await db.from("shipment_quotes").select("id", { count: "exact", head: true })
      .eq("tenant_id", ws.tenant.id).eq("shipment_id", id).eq("shipment_revision", revision)
      .gt("expires_at", new Date().toISOString());
    if (!count) {
      if (live) {
        // Bind the response to the exact pickup identity/area used for pricing, including when
        // the admin changes pickup while the provider estimate is in flight.
        const { data: origin } = await db.from("shipments").select("outlets(mengantar_area_id,mengantar_pickup_address_id)")
          .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle<{ outlets: { mengantar_area_id: string | null; mengantar_pickup_address_id: string | null } | null }>();
        const quoted = await liveQuotes(ws.tenant.id, origin?.outlets ?? null, id, revision, update);
        if (quoted.error) return { error: quoted.error + contactNote, values };
        if (quoted.count === 0) {
          const emptyMsg = update.is_cod === true ? friendlyError({ message: "cod_not_supported" }) : "Tidak ada layanan Mengantar untuk rute dan berat ini.";
          return { error: emptyMsg + contactNote, values };
        }
      } else {
        const { data: simulatedQuotes, error: qe } = await db.rpc("request_quotes", { p_shipment: id, p_expected_revision: revision });
        if (qe) return { error: friendlyError(qe) + contactNote, values };
        if (!simulatedQuotes?.length) return { error: "Tidak ada layanan simulasi untuk berat ini. Periksa batas berat kurir." + contactNote, values };
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
async function liveQuotes(tenantId: string, origin: { mengantar_area_id: string | null; mengantar_pickup_address_id: string | null } | null,
  shipmentId: string, revision: number,
  update: Record<string, unknown>): Promise<{ count: number; error?: undefined } | { error: string; count?: undefined }> {
  const originAreaId = origin?.mengantar_area_id;
  if (!originAreaId || !origin.mengantar_pickup_address_id) return { error: friendlyError({ message: "pickup_not_set" }) };
  const isCod = update.is_cod === true;
  const goodsValueIdr = Number(update.goods_value_idr ?? 0);
  if (isCod && (!Number.isSafeInteger(goodsValueIdr) || goodsValueIdr < 1000)) {
    return { error: friendlyError({ message: "cod_goods_value_required" }) };
  }
  const mengantar = await tenantMengantar(tenantId);
  if (!mengantar.ok) return { error: friendlyError({ message: `mengantar_${mengantar.reason}` }) };
  const machine = await machineClient();
  if (!machine) return { error: friendlyError({ message: "mengantar_not_configured" }) };
  const { data: ruleRows, error: ruleError } = await (await dbServer()).rpc("billable_weight_rules", { p_tenant: tenantId });
  if (ruleError) return { error: "Aturan berat belum dapat dibaca. Coba cek ongkir lagi." };
  let estimates;
  try {
    const quoted = await estimateBillableQuotes((input) => mengantar.client.estimate(input), {
      originAreaId, destinationAreaId: String(update.recipient_area_id),
      ...(isCod ? { goodsValueIdr } : {}),
    }, {
      actualWeightGrams: Number(update.weight_grams),
      lengthCm: update.length_cm as number | null,
      widthCm: update.width_cm as number | null,
      heightCm: update.height_cm as number | null,
    }, (ruleRows ?? []) as BillableWeightRule[],
    couriersForHandover(quoteServices(isCod), update.handover));
    estimates = quoted.rows;
  } catch (error) {
    if (error instanceof InvalidOrderRequest) {
      return { error: friendlyError({ message: error.reason }) };
    }
    return { error: friendlyError({ message: mengantarFailure(error) }) };
  }
  // Anteraja is offered for pickup only (see couriersForHandover).
  const rows = couriersForHandover(estimates, update.handover)
    .map((e) => ({
      courier: e.courier,
      ...(e.service_class === "cargo" ? { service_class: "cargo", minimum_weight_grams: e.minimum_weight_grams } : {}),
      billable_weight_grams: e.billable_weight_grams,
      weight_rule_id: e.weight_rule_id,
      tariff: e.tariff,
      net: e.netShipping,
      // Provider discount in basis points; null (unknown) is stored as NULL, never 0.
      discount_bps: e.discountBps,
      cod_fee: isCod ? e.codFee : 0,
      cod_supported: e.service_class !== "cargo",
      eta: (e.etaText ?? "").slice(0, 40),
    }));
  if (isCod && rows.length === 0) {
    return { error: friendlyError({ message: "cod_not_supported" }) };
  }
  const { data, error } = await machine.rpc("record_live_quotes", {
    p_tenant: tenantId, p_shipment: shipmentId, p_expected_revision: revision, p_rows: rows,
    p_origin_area_id: originAreaId, p_origin_address_id: origin.mengantar_pickup_address_id,
  });
  // invalid_input here means Mengantar sent data we could not store, not a form problem.
  if (error) return { error: friendlyError(error.message === "invalid_input" ? { message: "mengantar_data_unreadable" } : error) };
  return { count: Number(data) };
}

export type ConfirmState = { error?: string; fieldErrors?: Partial<Record<DraftField, string>> };

// DEC-010: the dispatcher's machine identity, from the container environment. Null => fail closed (the
// operation stays queued and the scheduler's sweep or "Kirim sekarang" sends it later).
function machineDeps() {
  return dispatcherDeps({
    POSTGREST_URL: config("POSTGREST_URL"),
    AUTH_JWT_SECRET: config("AUTH_JWT_SECRET"),
    CREDENTIAL_KEY: config("CREDENTIAL_KEY"), CREDENTIAL_KEYS: config("CREDENTIAL_KEYS"), CREDENTIAL_KEY_CURRENT: config("CREDENTIAL_KEY_CURRENT"),
    MENGANTAR_ENV: config("MENGANTAR_ENV"),
  });
}

// The newest create operation of a shipment the caller can see (RLS: members only).
async function shipmentOperation(shipmentId: string, tenantId: string) {
  const { data } = await (await dbServer()).from("provider_operations")
    .select("id, state, result_code, is_simulated").eq("tenant_id", tenantId).eq("shipment_id", shipmentId)
    .eq("kind", "create_order").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; state: string; result_code: string | null; is_simulated: boolean } | null;
}

// Counts-only log of an interactive dispatch step (the cron logs its own), then the page flag. Each step
// runs under its own correlation id (T-105); the reason is a stable code, never raw database text.
async function dispatchStep(step: string, run: () => Promise<DispatchSummary>): Promise<string> {
  return withCorrelation(async () => {
    const summary = await run();
    const reason = "reason" in summary ? stableCode(summary.reason) : undefined;
    logEvent("dispatch_action", { step, status: summary.status,
      outcome: "outcome" in summary ? summary.outcome : undefined, reason,
      priceMismatch: "priceMismatch" in summary ? summary.priceMismatch : undefined,
      priceUnknown: "priceUnknown" in summary ? summary.priceUnknown : undefined });
    return summary.status === "recorded" ? `hasil=${summary.outcome}`
      : summary.status === "record_failed" ? "hasil=unknown"
      : `info=${reason}`;
  });
}

export async function confirmShipmentAction(_: ConfirmState, form: FormData): Promise<ConfirmState> {
  const ws = await requireWorkspace();
  const id = String(form.get("shipment_id"));
  if (!UUID.test(id)) return { error: friendlyError({ message: "not_found" }) };
  const db = await dbServer();
  const { data: recipient } = await db.from("shipments")
    .select("recipient_name,recipient_address,recipient_phone,is_simulated,handover,pickup_date,pickup_slot_hour")
    .eq("id", id).eq("tenant_id", ws.tenant.id).maybeSingle();
  if (!recipient) return { error: friendlyError({ message: "not_found" }) }; // not in the selected gerai: never reaches the RPC or the provider
  // T-043: a pickup slot that has passed (or is inside the lead time setting, default 120 minutes) cannot be
  // confirmed; the database re-checks it under lock (pickup_time_invalid).
  if (recipient?.handover === "pickup") {
    const leadMinutes = await pickupLeadMinutes(() => db.rpc("pickup_lead_minutes"));
    const fieldErrors = pickupFieldErrors({ pickup_date: String(recipient.pickup_date ?? ""), pickup_slot_hour: String(recipient.pickup_slot_hour ?? "") },
      new Date(), leadMinutes);
    if (Object.keys(fieldErrors).length) return { error: Object.values(fieldErrors).join(" "), fieldErrors };
  }
  if (recipient && !recipient.is_simulated) {
    const fieldErrors = liveRecipientErrors(recipient);
    if (Object.keys(fieldErrors).length) return { error: Object.values(fieldErrors).join(" "), fieldErrors };
  }
  const { data, error } = await db.rpc("confirm_shipment", {
    p_shipment: id,
    p_quote: String(form.get("quote_id")),
    p_expected_revision: Number(form.get("revision")),
    p_idempotency_key: String(form.get("idempotency_key")),
    // PR-41: the checkbox carries the declaration text version shown; unchecked sends none.
    p_declaration_version: form.get("content_declaration") === null ? null : Number(form.get("content_declaration")),
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
  redirect(`/pengiriman/${id}?${await dispatchStep("confirm", () => dispatchOperation(result.operation_id, deps))}`);
}

// A queued real operation that was not sent (busy seller, missing configuration): send it now.
export async function dispatchQueuedAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  const op = await shipmentOperation(id, ws.tenant.id);
  if (!op || op.is_simulated || op.state !== "queued") redirect(`/pengiriman/${id}?galat=nothing_to_dispatch`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  redirect(`/pengiriman/${id}?${await dispatchStep("dispatch", () => dispatchOperation(op.id, deps))}`);
}

// DEC-008: resolving an unknown outcome is a tenant-admin action. Demo shipments keep the SQL
// simulation; real ones look the original order up at Mengantar by reference (never resend).
export async function reconcileAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const op = await shipmentOperation(id, ws.tenant.id);
  if (op && !op.is_simulated) {
    if (ws.role !== "tenant_admin") redirect(`/pengiriman/${id}?galat=admin_required`);
    const deps = machineDeps();
    if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
    const summary = await reconcileOperation(op.id, deps);
    if (summary.status === "not_reconcilable") redirect(`/pengiriman/${id}?galat=${stableCode(summary.reason)}`);
    redirect(`/pengiriman/${id}?${await dispatchStep("reconcile", async () => summary)}`);
  }
  const db = await dbServer();
  const { error } = await db.rpc("reconcile_shipment", { p_shipment: id });
  redirect(`/pengiriman/${id}${error ? `?${galat(error)}` : "?rekonsiliasi=1"}`);
}

// An unpaid Mengantar order: has the seller paid it in the Mengantar app yet?
export async function checkPaymentAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  const op = await shipmentOperation(id, ws.tenant.id);
  if (!op || op.is_simulated) redirect(`/pengiriman/${id}?galat=nothing_to_check`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  const summary = await checkPayment(op.id, deps);
  if (summary.status === "not_reconcilable") redirect(`/pengiriman/${id}?galat=${stableCode(summary.reason)}`);
  redirect(`/pengiriman/${id}?${await dispatchStep("payment", async () => summary)}`);
}

// T-033: a tenant admin pays an unpaid Mengantar batch after reviewing its full membership and
// digest. With the user session the database re-checks the admin role under lock and records an
// audited, single-use, short-lived authorization of exactly that digest (IAM-2, TEN-4); the machine
// client then claims it. When an earlier attempt for the batch is unresolved the authorization is
// withheld and the dispatch only reconciles that attempt: it never sends a second payment.
export async function payUnpaidBatchAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  const batchDigest = String(form.get("batch_digest") ?? "").trim();
  if (ws.role !== "tenant_admin") redirect(`/pengiriman/${id}?galat=admin_required`);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const db = await dbServer();
  const { error: authorizeError } = await db.rpc("authorize_batch_payment", { p_shipment: id, p_batch_digest: batchDigest });
  if (authorizeError) redirect(`/pengiriman/${id}?${galat(authorizeError)}`);
  const deps = machineDeps();
  if (!deps) redirect(`/pengiriman/${id}?info=mengantar_not_configured`);
  const summary = await payUnpaidShipmentBatch(id, batchDigest, deps);
  revalidatePath("/pengiriman");
  revalidatePath(`/pengiriman/${id}`);
  if (summary.status === "not_reconcilable") {
    // Only the mapped reason code travels in the URL: provider text is never reflected into a page.
    redirect(`/pengiriman/${id}?galat=${stableCode(summary.reason)}`);
  }
  redirect(`/pengiriman/${id}?${await dispatchStep("pay_batch", async () => summary)}`);
}

// After a definite refusal (nothing created at Mengantar) the counter fixes the draft and retries.
export async function reopenAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const { error } = await (await dbServer()).rpc("reopen_shipment", { p_shipment: id });
  redirect(`/pengiriman/${id}${error ? `?${galat(error)}` : ""}`);
}

// A tenant admin closes an unresolved failure after checking the Mengantar app (audited; the
// database re-checks the role, age and that a re-check ran). The shipment can then be reopened.
export async function closeFailedAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const { error } = await (await dbServer()).rpc("close_failed_operation", {
    p_shipment: id, p_reason: String(form.get("reason") ?? ""),
  });
  redirect(`/pengiriman/${id}${error ? `?${galat(error)}` : "?info=closed"}`);
}

// T-056: a tenant admin closes a batch payment attempt that stays unknown after checking the Mengantar
// app. No provider request; the database re-checks the role and state under the batch locks, records
// the reason and the per-order reads, and frees the batch for a new authorization. A replay is a no-op.
export async function closeUnknownBatchPaymentAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  // The attempt the admin reviewed (review_unpaid_batch.payment_attempt_id); a newer one is refused.
  const attempt = String(form.get("attempt_id") ?? "");
  const { error } = UUID.test(attempt)
    ? await (await dbServer()).rpc("close_unknown_batch_payment", {
        p_shipment: id, p_attempt: attempt, p_reason: String(form.get("reason") ?? ""),
      })
    : { error: { message: "stale_attempt" } };
  revalidatePath(`/pengiriman/${id}`);
  redirect(`/pengiriman/${id}${error ? `?${galat(error)}` : "?info=payment_closed"}`);
}

// T-056: a tenant admin closes a pickup reservation whose answer was lost and could not be tied to
// one record, after checking the Mengantar app. Nothing is resent; the shipment can then be reopened.
export async function closeAmbiguousReservationAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const { error } = await (await dbServer()).rpc("close_ambiguous_pickup_reservation", {
    p_shipment: id, p_reason: String(form.get("reason") ?? ""),
  });
  revalidatePath(`/pengiriman/${id}`);
  revalidatePath("/pengiriman");
  redirect(`/pengiriman/${id}${error ? `?${galat(error)}` : "?info=closed"}`);
}

export async function requestLabelAction(form: FormData) {
  const ws = await requireWorkspace();
  const id = shipmentIdOf(form);
  if (!(await inWorkspace(id, ws.tenant.id))) redirect(NOT_FOUND_PATH);
  const db = await dbServer();
  const { error } = await db.rpc("request_label", { p_shipment: id });
  if (error) redirect(`/pengiriman/${id}?${galat(error)}`);
  redirect(`/pengiriman/${id}/label`);
}
