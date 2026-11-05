import Link from "next/link";
import { CheckCircle2, FileText, PackagePlus, Printer } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { createDraftAction, requestLabelAction } from "./actions";
import { StickyActionBar } from "./detail-action-bar";
import { AwbCopy } from "./detail-awb";
import type { ShipmentRecord } from "./detail-types";
import { TrackingShareCard } from "@/modules/tracking/share-card";

// UX-14: what an issued shipment offers next. A real one prints its label (primary) and starts the next
// shipment in one click; a demo one only shows its sample label and never claims a real print.
// Awaiting payment, unknown and failed shipments never reach these components.

export function IssuedResult({ s }: { s: ShipmentRecord }) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-success-soft p-4" data-testid="issued-result">
      <p className="flex items-center gap-2 font-semibold text-success">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
        {s.is_simulated ? "Resi contoh terbit" : "Resi terbit"}
      </p>
      {s.awb ? <AwbCopy awb={s.awb} /> : null}
      {!s.is_simulated && s.awb ? <TrackingShareCard shipmentId={s.id} senderPhone={s.sender_phone} /> : null}
      {s.is_simulated ? (
        <p className="text-sm">Ini resi contoh dari mode simulasi; labelnya hanya untuk berlatih dan bukan label kurir.</p>
      ) : null}
    </div>
  );
}

function PrimaryPrint({ s, hasLabel, className }: { s: ShipmentRecord; hasLabel: boolean; className?: string }) {
  if (!s.is_simulated) {
    return (
      <Button asChild className={className}>
        <Link href={`/pengiriman/${s.id}/label`}><Printer aria-hidden="true" />Cetak label</Link>
      </Button>
    );
  }
  return hasLabel ? (
    <Button asChild className={className}>
      <Link href={`/pengiriman/${s.id}/label`}><Printer aria-hidden="true" />Lihat contoh label</Link>
    </Button>
  ) : (
    <form action={requestLabelAction} className={className}>
      <input type="hidden" name="shipment_id" value={s.id} />
      <SubmitButton pendingLabel="Menyiapkan…" className="w-full">Siapkan label</SubmitButton>
    </form>
  );
}

// Starts a new draft through the existing draft action (one POST, pending-safe).
function NewShipment({ className, size }: { className?: string; size?: "sm" }) {
  return (
    <form action={createDraftAction} className={className}>
      <SubmitButton variant="outline" size={size} pendingLabel="Membuat draf…" className="w-full">
        <span className="inline-flex items-center gap-2"><PackagePlus className="size-4" aria-hidden="true" />Buat pengiriman lagi</span>
      </SubmitButton>
    </form>
  );
}

// The actions inside the "Langkah berikutnya" card. Below 640 px the primary and the new-shipment
// action move to the sticky bar (IssuedActionBar), so each control exists once per viewport.
export function IssuedActions({ s, hasLabel }: { s: ShipmentRecord; hasLabel: boolean }) {
  if (!s.awb) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <PrimaryPrint s={s} hasLabel={hasLabel} className="max-sm:hidden" />
      {s.is_simulated ? null : (
        <>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={`/pengiriman/${s.id}/invoice`}><FileText aria-hidden="true" />Cetak resi + invoice</Link>
          </Button>
          <NewShipment className="max-sm:hidden" />
        </>
      )}
    </div>
  );
}

export function IssuedActionBar({ s, hasLabel }: { s: ShipmentRecord; hasLabel: boolean }) {
  if (!s.awb) return null;
  return (
    <StickyActionBar>
      {s.is_simulated ? null : <NewShipment size="sm" className="shrink-0" />}
      {/* Grows beside the other action but never below its own width: at 320 px it wraps to its own row
          instead of clipping its label (WCAG 1.4.10). */}
      <PrimaryPrint s={s} hasLabel={hasLabel} className="flex-[1_0_auto]" />
    </StickyActionBar>
  );
}
