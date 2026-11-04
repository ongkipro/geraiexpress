import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { LoadError, Notice } from "@/components/notice";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { COUNTER_PAYMENT_COLUMNS, counterPaymentApplies, type CounterPaymentRecord } from "@/modules/payments/counter-payment-card";
import { receiptAmountsSupported, type ReceiptInput } from "@/modules/payments/receipt";
import { UNSUPPORTED_PAYMENT_AMOUNT } from "@/modules/payments/money";
import { ReceiptSheet } from "@/modules/payments/receipt-sheet";

export const metadata: Metadata = { title: "Struk" };

// T-082 / UX-17 item 4: the customer receipt of a confirmed shipment with an active counter payment.
// Reads only the confirmation snapshot columns of the shipment and the active payment record; no
// pricing or discount table is read here.
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data: s, error: shipmentError } = await db.from("shipments")
    .select("id, reference, awb, submission_state, is_cod, cod_amount_idr, customer_charge_idr, sender_phone, selected_quote_id, pickup_snapshot")
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (shipmentError) return <LoadError title="Struk" what="Pengiriman" />;
  if (!s) notFound();
  if (!counterPaymentApplies(s.submission_state) || s.customer_charge_idr == null) redirect(`/pengiriman/${s.id}`);

  const [{ data: quote, error: quoteError }, { data: payment, error: paymentError }, { data: codIdentity, error: codIdentityError }] = await Promise.all([
    s.selected_quote_id
      ? db.from("shipment_quotes").select("courier, service").eq("tenant_id", ws.tenant.id).eq("id", s.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("counter_payments").select(COUNTER_PAYMENT_COLUMNS)
      .eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).is("voided_at", null).maybeSingle(),
    s.is_cod ? db.from("label_print_events").select("receipt_gerai_name, receipt_gerai_whatsapp")
      .eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).eq("kind", "receipt").is("receipt_payment_id", null)
      .order("id").limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (quoteError || paymentError || codIdentityError) return <LoadError title="Struk" what="Data struk" />;
  const active = (payment ?? null) as CounterPaymentRecord | null;
  // A COD shipment has no counter payment (its shipping charge is collected by the courier); its
  // receipt still carries the COD collection instruction. Otherwise a receipt needs a payment.
  if (!active && !s.is_cod) redirect(`/pengiriman/${s.id}`);

  // Owner decision 2026-11-05: non-COD identity is payment-time; COD identity freezes on first
  // application print. Before that, preview current identity and let the print RPC reject stale data.
  let geraiName = active?.receipt_gerai_name ?? "";
  let geraiWhatsapp = active?.receipt_gerai_whatsapp ?? null;
  if (s.is_cod) {
    if (codIdentity) {
      if (!codIdentity.receipt_gerai_name) return <LoadError title="Struk" what="Identitas struk COD" />;
      geraiName = codIdentity.receipt_gerai_name;
      geraiWhatsapp = codIdentity.receipt_gerai_whatsapp;
    } else {
      const { data: tenant, error } = await db.from("tenants").select("name, contact_whatsapp").eq("id", ws.tenant.id).maybeSingle();
      if (error) return <LoadError title="Struk" what="Identitas gerai" />;
      if (!tenant) notFound();
      geraiName = tenant.name;
      geraiWhatsapp = tenant.contact_whatsapp;
    }
  }
  const pickup = s.pickup_snapshot as { outlet?: string } | null;
  const input: ReceiptInput = {
    geraiName,
    geraiWhatsapp,
    outletName: pickup?.outlet ?? null,
    reference: s.reference,
    awb: s.awb,
    courier: quote?.courier ?? null,
    service: quote?.service ?? null,
    customerChargeIdr: s.customer_charge_idr,
    isCod: s.is_cod,
    codAmountIdr: s.cod_amount_idr,
    isDemo: ws.isDemo,
    payment: active ? {
      id: active.id,
      method: active.method,
      amountIdr: active.amount_idr,
      cashReceivedIdr: active.cash_received_idr,
      recordedAt: active.recorded_at,
    } : null,
  };

  if (!receiptAmountsSupported(input)) {
    return <div className="flex flex-col gap-4"><h1 className="text-3xl">Struk tidak dapat ditampilkan</h1><Notice tone="danger">{UNSUPPORTED_PAYMENT_AMOUNT}</Notice><Link href={`/pengiriman/${s.id}`} className="text-primary underline">Kembali ke pengiriman</Link></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 print:hidden">
        <Link
          href={`/pengiriman/${s.id}`}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-2 text-primary hover:underline underline-offset-4"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          <span><span className="sr-only">Kembali ke </span><span className="tabular">{s.reference}</span></span>
        </Link>
        <h1 className="text-[28px] leading-tight tracking-tight md:text-3xl">{ws.isDemo ? "Struk contoh" : "Struk"}</h1>
      </div>
      <ReceiptSheet input={input} customerPhone={s.sender_phone} shipmentId={s.id} paymentId={active?.id ?? null} />
    </div>
  );
}
