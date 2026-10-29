import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { SEGMENT_ITEM, SEGMENT_ITEM_ON, SEGMENT_TRACK } from "@/modules/labels/segment-styles";

type Doc = "label" | "invoice";

const TABS: { doc: Doc; label: string; path: string }[] = [
  { doc: "label", label: "Label", path: "label" },
  { doc: "invoice", label: "Resi + invoice", path: "invoice" },
];

// C5 / C6: one print surface for a shipment. The label view and the "Resi + invoice" view share this
// header (back link, title, status, reference and AWB) and a segmented control of real links between
// them. Demo shipments have no invoice view (it redirects), so they get the header without the tabs.
// Nothing here prints.
export function PrintHeader({
  shipmentId, reference, awb, state, title, current, tabs,
}: {
  shipmentId: string;
  reference: string;
  awb: string | null;
  state: string;
  title: string;
  current: Doc;
  tabs: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 print:hidden">
      <Link
        href={`/pengiriman/${shipmentId}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-2 text-primary hover:underline underline-offset-4"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
        <span><span className="sr-only">Kembali ke </span><span className="tabular">{reference}</span></span>
      </Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[28px] leading-tight tracking-tight md:text-3xl">{title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <StatusBadge state={state} />
            <span className="tabular">{reference}</span>
            {awb ? <span>AWB <span className="tabular text-foreground">{awb}</span></span> : null}
          </div>
        </div>
        {tabs ? (
          <nav aria-label="Dokumen cetak" className="shrink-0">
            <ul className={cn(SEGMENT_TRACK, "w-full md:w-auto")}>
              {TABS.map((tab) => {
                const active = tab.doc === current;
                return (
                  <li key={tab.doc} className="flex-1 md:flex-none">
                    <Link
                      href={`/pengiriman/${shipmentId}/${tab.path}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(SEGMENT_ITEM, "w-full whitespace-nowrap", active && SEGMENT_ITEM_ON)}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
