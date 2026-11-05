import { CUSTOMER_SLIP_HEIGHT_MM, type CustomerSlipContent } from "../../lib/label-content";
import { Code128Barcode } from "./code128-barcode";
import { GeraiIdentity } from "./gerai-identity";

// No sender, recipient or WhatsApp input: detachable customer proof carries only frozen branding,
// courier/service and the same AWB as the parcel. The top dashed border is the 100mm cut line.
export function CustomerSlip({ content }: { content: CustomerSlipContent }) {
  return (
    <section aria-label="Slip pelanggan" data-testid="customer-slip"
      style={{ width: "100mm", height: `${CUSTOMER_SLIP_HEIGHT_MM}mm`, fontFamily: "system-ui, sans-serif" }}
      className="box-border flex flex-col gap-[3mm] overflow-hidden border-x border-b border-t border-t-dashed border-black bg-white p-[3mm] text-black leading-[1.25] print:border-x-0 print:border-b-0">
      <div data-testid="slip-identity-row" className="flex shrink-0 items-center justify-between gap-[2mm]">
        <GeraiIdentity name={content.geraiName ?? "—"} logo={content.geraiLogo} />
        <span className="min-w-0 text-right text-[3mm] font-semibold [overflow-wrap:anywhere]">{content.courierLine}</span>
      </div>
      <Code128Barcode value={content.awb} heightMm={16} />
      {/* Up to 40 characters (DB check): long AWBs shrink and may wrap rather than clip. */}
      <p data-testid="slip-awb" className={`text-center font-bold tabular-nums [overflow-wrap:anywhere] ${content.awb.length > 20 ? "text-[3mm] tracking-normal" : "text-[4mm] tracking-[0.3mm]"}`}>{content.awb}</p>
    </section>
  );
}
