import { formatWib } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_LABEL: Record<string, string> = {
  draft_created: "Draf dibuat",
  quoted: "Ongkir dicek",
  submitted: "Dikonfirmasi",
  issued: "Resi terbit",
  outcome_unknown: "Hasil belum pasti",
  reconciled: "Direkonsiliasi",
  label_ready: "Label siap",
  dispatched: "Dikirim ke Mengantar",
  unpaid: "Menunggu pembayaran",
  rejected: "Ditolak Mengantar",
  failed: "Gagal di Mengantar",
  not_created: "Pesanan tidak dibuat",
  outcome_corrected: "Hasil dikoreksi",
  reopened: "Draf dibuka lagi",
  price_mismatch: "Harga Mengantar berbeda",
  closed: "Ditutup admin",
  pickup_reserving: "Memesan slot jemput",
  pickup_reserved: "Slot jemput dipesan",
  payment_count_mismatch: "Jumlah pembayaran berbeda",
  payment_closed: "Pembayaran ditutup admin",
  // T-086: case lifecycle on the shipment history (details live on the case).
  case_opened: "Kasus dibuka",
  case_closed: "Kasus ditutup",
};

// Dot tone on the spine; the event name always carries the meaning in text.
const EVENT_TONE: Record<string, string> = {
  issued: "bg-success",
  label_ready: "bg-success",
  reconciled: "bg-success",
  outcome_unknown: "bg-warning",
  unpaid: "bg-warning",
  price_mismatch: "bg-warning",
  payment_count_mismatch: "bg-warning",
  rejected: "bg-danger",
  failed: "bg-danger",
  not_created: "bg-danger",
};

export type ShipmentEvent = { id: number | string; kind: string; detail: string | null; created_at: string };

// C5: the event history last, as a vertical timeline (oldest first, as recorded).
export function ShipmentTimeline({ events, className }: { events: ShipmentEvent[]; className?: string }) {
  return (
    <section aria-labelledby="timeline-heading" className={cn("flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6", className)}>
      <h2 id="timeline-heading" className="text-xl">Riwayat</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground">Belum ada kejadian tercatat.</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
              <span aria-hidden="true" className="flex w-3 shrink-0 flex-col items-center">
                <span className={cn("mt-1.5 size-3 shrink-0 rounded-full ring-4 ring-card", EVENT_TONE[e.kind] ?? "bg-primary")} />
                {i < events.length - 1 ? <span className="absolute top-6 bottom-1 left-1.5 w-px -translate-x-1/2 bg-border" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                {e.detail ? <span className="break-words text-sm text-muted-foreground">{e.detail}</span> : null}
                <time className="tabular text-sm text-muted-foreground" dateTime={e.created_at}>{formatWib(e.created_at)}</time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
