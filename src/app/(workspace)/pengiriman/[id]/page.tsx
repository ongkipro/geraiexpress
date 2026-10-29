import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { geraiCostForQuote } from "@/modules/pricing/gerai-cost";
import { ShipmentFacts } from "@/modules/shipments/detail-facts";
import { ShipmentFlash, ShipmentHeader, type ShipmentFlags } from "@/modules/shipments/detail-header";
import { IssuedActionBar } from "@/modules/shipments/detail-issued";
import { NextStepCard } from "@/modules/shipments/detail-next-step";
import { ShipmentTimeline, type ShipmentEvent } from "@/modules/shipments/detail-timeline";
import type { BatchReview, OperationRecord, PickupSnapshot, ShipmentRecord } from "@/modules/shipments/detail-types";
import { DraftIntake } from "@/modules/shipments/draft-intake";
import { pickupReservationText, type PickupPhase } from "@/modules/shipments/pickup-status";

export const metadata: Metadata = { title: "Pengiriman" };

// One shipment: a draft or estimated shipment opens the create flow (C4); every later state shows the
// detail (C5): "Langkah berikutnya" first, then the grouped facts, then the timeline.
export default async function ShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ShipmentFlags>;
}) {
  const ws = await requireWorkspace();
  const { id } = await params;
  const flags = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data: s } = await db.from("shipments").select("*").eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();
  const isAdmin = ws.role === "tenant_admin";

  if (s.submission_state === "draft" || s.submission_state === "estimated") {
    return (
      <div className="flex flex-col gap-6">
        <ShipmentHeader reference={s.reference} state={s.submission_state} isCod={!!s.is_cod} draft />
        <ShipmentFlash flags={flags} simulated={!!s.is_simulated} draft />
        <DraftIntake s={s} tenantId={ws.tenant.id} outlet={ws.outlet} isAdmin={isAdmin} isDemo={ws.isDemo} kontak={flags.kontak} />
      </div>
    );
  }

  const shipment = s as ShipmentRecord;
  const real = !shipment.is_simulated;
  const [{ data: quote }, { data: events }, { data: label }, { data: op }, { data: batchReviewData }] = await Promise.all([
    shipment.selected_quote_id
      ? db.from("shipment_quotes").select("courier, service, eta_days, is_simulated").eq("tenant_id", ws.tenant.id).eq("id", shipment.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("shipment_events").select("id, kind, detail, created_at").eq("tenant_id", ws.tenant.id).eq("shipment_id", shipment.id).order("id"),
    db.from("label_jobs").select("id, state").eq("tenant_id", ws.tenant.id).eq("shipment_id", shipment.id).eq("state", "completed").limit(1).maybeSingle(),
    db.from("provider_operations").select("state, result_code, provider_order_id, provider_batch, provider_error_detail, is_simulated, pickup_phase, dispatched_at, last_checked_at")
      .eq("tenant_id", ws.tenant.id).eq("shipment_id", shipment.id).eq("kind", "create_order").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    real && shipment.submission_state === "awaiting_payment" && isAdmin
      ? db.rpc("review_unpaid_batch", { p_shipment: shipment.id })
      : Promise.resolve({ data: null }),
  ]);
  const operation = (op ?? null) as OperationRecord | null;
  // T-053: the gerai-facing cost basis is for tenant administrators of real gerai only; operators,
  // demo and simulated shipments never see it. undefined = not shown; null = shown as "belum diketahui".
  const geraiCost = isAdmin && !ws.isDemo && real && shipment.selected_quote_id
    ? await geraiCostForQuote(ws.tenant.id, shipment.selected_quote_id)
    : undefined;
  const pickup = (shipment.pickup_snapshot ?? {}) as PickupSnapshot;
  const isPickup = pickup.handover === "pickup" && !!pickup.pickup_date && typeof pickup.pickup_slot_hour === "number";
  const reservationText = !isPickup ? null
    : pickupReservationText({ shipmentState: shipment.submission_state, phase: (operation?.pickup_phase ?? null) as PickupPhase, resultCode: operation?.result_code ?? null });

  return (
    <div className="flex flex-col gap-6">
      <ShipmentHeader reference={shipment.reference} state={shipment.submission_state} isCod={shipment.is_cod} draft={false} />
      <ShipmentFlash flags={flags} simulated={shipment.is_simulated} draft={false} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <NextStepCard s={shipment} op={operation} hasLabel={!!label} isAdmin={isAdmin} batchReview={(batchReviewData ?? null) as BatchReview | null} />
          <ShipmentFacts s={shipment} quote={quote} op={operation} pickup={pickup} isPickup={isPickup} reservationText={reservationText} geraiCost={geraiCost} />
        </div>
        <ShipmentTimeline events={(events ?? []) as ShipmentEvent[]} className="xl:sticky xl:top-8" />
      </div>
      {shipment.submission_state === "issued" ? <IssuedActionBar s={shipment} hasLabel={!!label} /> : null}
    </div>
  );
}
