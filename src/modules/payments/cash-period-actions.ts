"use server";

import { revalidatePath } from "next/cache";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { CASH_UNKNOWN_RESULT, cashPeriodError } from "./cash-periods";
import { parsePaymentRupiah } from "./rupiah";

export type CashPeriodState = { ok?: string; error?: string; reconcile?: boolean; fieldErrors?: { counted?: string; reason?: string } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function savePeriod(form: FormData, reopen: boolean): Promise<CashPeriodState> {
  const ws = await requireWorkspace();
  if (reopen && ws.role !== "tenant_admin") return { error: cashPeriodError({ message: "admin_required" }) };
  const period = String(form.get("period_id") ?? "");
  if (!UUID.test(period)) return { error: cashPeriodError({ message: "not_found" }) };
  const counted = parsePaymentRupiah(String(form.get("counted") ?? ""));
  const reason = String(form.get("reason") ?? "").trim();
  if (!reopen && counted === null) return { fieldErrors: { counted: cashPeriodError({ message: "counted_cash_invalid" }) } };
  if (reopen && (reason.length < 5 || reason.length > 500)) return { fieldErrors: { reason: cashPeriodError({ message: "reason_required" }) } };
  const db = await dbServer();
  const scoped = await db.from("cash_periods").select("id").eq("tenant_id", ws.tenant.id).eq("id", period).maybeSingle();
  if (scoped.error) return { error: CASH_UNKNOWN_RESULT, reconcile: true };
  if (!scoped.data) return { error: cashPeriodError({ message: "not_found" }) };
  try {
    const { error } = reopen
      ? await db.rpc("reopen_cash_period", { p_period: period, p_reason: reason })
      : await db.rpc("close_cash_period", { p_period: period, p_counted_idr: counted });
    revalidatePath("/kas");
    // Voiding on any detail page must see the new period state after a close/reopen.
    revalidatePath("/pengiriman", "layout");
    if (error) {
      const message = cashPeriodError(error);
      return { error: message, reconcile: message === CASH_UNKNOWN_RESULT || ["period_closed", "period_open"].includes(error.message) };
    }
    return { ok: reopen ? "Kas dibuka ulang." : "Kas ditutup." };
  } catch {
    // An exception after dispatch may mean the command committed. Never replay automatically.
    return { error: CASH_UNKNOWN_RESULT, reconcile: true };
  }
}

export async function closeCashPeriodAction(_: CashPeriodState, form: FormData): Promise<CashPeriodState> {
  return savePeriod(form, false);
}
export async function reopenCashPeriodAction(_: CashPeriodState, form: FormData): Promise<CashPeriodState> {
  return savePeriod(form, true);
}
