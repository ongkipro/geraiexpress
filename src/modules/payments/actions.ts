"use server";

// T-082: Server Actions for the counter payment record. The database derives outlet, period and the
// expected amount from the shipment; the action passes only what the operator typed.
import { revalidatePath } from "next/cache";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { PAYMENT_SAVED, PAYMENT_VOIDED, PAYMENT_UNKNOWN_RESULT, isPaymentMethod, paymentError } from "./messages";
import { parsePaymentRupiah } from "./rupiah";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentField = "method" | "amount" | "received" | "reason";

export type PaymentState = {
  ok?: string;
  error?: string;
  reconcile?: boolean;
  fieldErrors?: Partial<Record<PaymentField, string>>;
};

export async function recordCounterPaymentAction(_: PaymentState, form: FormData): Promise<PaymentState> {
  const ws = await requireWorkspace();
  const shipmentId = String(form.get("shipment_id") ?? "");
  if (!UUID.test(shipmentId)) return { error: paymentError({ message: "not_found" }) };
  const method = String(form.get("method") ?? "");
  const amount = parsePaymentRupiah(String(form.get("amount") ?? ""));
  const receivedRaw = String(form.get("received") ?? "").trim();
  const received = method === "cash" && receivedRaw ? parsePaymentRupiah(receivedRaw) : null;
  const expected = Number(form.get("expected"));
  const reason = String(form.get("reason") ?? "").trim();

  const fieldErrors: Partial<Record<PaymentField, string>> = {};
  if (!isPaymentMethod(method)) fieldErrors.method = "Pilih cara bayar.";
  if (amount == null || amount <= 0) fieldErrors.amount = "Isi jumlah dalam rupiah, lebih dari Rp0.";
  if (method === "cash" && receivedRaw && (received == null || (amount != null && received < amount))) {
    fieldErrors.received = "Uang diterima harus sama atau lebih besar dari jumlah bayar.";
  }
  if (amount != null && Number.isFinite(expected) && amount !== expected && (reason.length < 5 || reason.length > 500)) {
    fieldErrors.reason = "Jumlah berbeda dari tarif pelanggan. Tuliskan alasan singkat (5–500 karakter).";
  }
  if (Object.keys(fieldErrors).length) return { error: "Periksa isian yang ditandai.", fieldErrors };

  const db = await dbServer();
  const scoped = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (scoped.error) return { error: PAYMENT_UNKNOWN_RESULT, reconcile: true };
  if (!scoped.data) return { error: paymentError({ message: "not_found" }) };
  const { error } = await db.rpc("record_counter_payment", {
    p_shipment: shipmentId,
    p_method: method,
    p_amount_idr: amount,
    p_received_idr: received,
    p_difference_reason: reason || null,
  });
  revalidatePath(`/pengiriman/${shipmentId}`);
  if (error) {
    if (error.message === "difference_reason_required") return { error: paymentError(error), fieldErrors: { reason: paymentError(error) } };
    if (error.message === "cash_received_invalid") return { error: paymentError(error), fieldErrors: { received: paymentError(error) } };
    const message = paymentError(error);
    return { error: message, reconcile: message === PAYMENT_UNKNOWN_RESULT };
  }
  return { ok: PAYMENT_SAVED };
}

export async function voidCounterPaymentAction(_: PaymentState, form: FormData): Promise<PaymentState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin") return { error: paymentError({ message: "admin_required" }) };
  const paymentId = String(form.get("payment_id") ?? "");
  const shipmentId = String(form.get("shipment_id") ?? "");
  if (!UUID.test(paymentId) || !UUID.test(shipmentId)) return { error: paymentError({ message: "not_found" }) };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    return { error: "Periksa isian yang ditandai.", fieldErrors: { reason: paymentError({ message: "reason_required" }) } };
  }
  const db = await dbServer();
  const scoped = await db.from("counter_payments").select("id").eq("tenant_id", ws.tenant.id)
    .eq("shipment_id", shipmentId).eq("id", paymentId).maybeSingle();
  if (scoped.error) return { error: PAYMENT_UNKNOWN_RESULT, reconcile: true };
  if (!scoped.data) return { error: paymentError({ message: "not_found" }) };
  const { error } = await db.rpc("void_counter_payment", { p_payment: paymentId, p_reason: reason });
  revalidatePath(`/pengiriman/${shipmentId}`);
  if (error) {
    const message = paymentError(error);
    return { error: message, reconcile: message === PAYMENT_UNKNOWN_RESULT };
  }
  return { ok: PAYMENT_VOIDED };
}
