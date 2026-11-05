import { formatIdr, formatWeight } from "../../lib/format";
import { LABEL_SIZES, PARCEL_HEIGHT_MM, customerSlipContent, type LabelContent } from "../../lib/label-content";
import { Code128Barcode } from "./code128-barcode";
import { CustomerSlip } from "./customer-slip";
import { GeraiIdentity } from "./gerai-identity";

// Print-first label sheet (UI-6): exactly the chosen label size, black on white, system font, no
// gradient, shadow or accent colour, one label per page. The @page rule sets the printed page to the sheet;
// the application chrome is already hidden in print by the workspace layout. Everything printed comes from
// the LabelContent it is given: a stored snapshot once printed (DATA-10), never live shipment data.
// An on-screen "Masking aktif" indicator is not part of the sheet and so is never printed.
const dash = (value: string | null | undefined) => (value && value.trim() ? value : "—");

// Long names and addresses shrink within stated limits (UI-6). The longest values are then clamped to a
// number of lines with an ellipsis rather than pushing the barcode out of the fixed sheet: the barcode,
// the AWB and the reference never shrink or move out (B-T044b); the text blocks above them may.
function fit(length: number): string {
  return length > 220 ? "text-[2.2mm]" : length > 120 ? "text-[2.5mm]" : "text-[2.9mm]";
}
function fitName(length: number): string {
  return length > 60 ? "text-[2.7mm]" : "text-[3.4mm]";
}

// Both formats use the same compact 100x100 mm parcel; only the detachable slip differs.
const CLAMP = { senderName: "line-clamp-1", senderPlace: "line-clamp-1", recipientName: "line-clamp-2", recipientAddress: "line-clamp-5", item: "line-clamp-2" } as const;

export function LabelSheet({ content }: { content: LabelContent }) {
  const { widthMm, heightMm } = LABEL_SIZES[content.size];
  const clamp = CLAMP;
  const recipientAddress = [content.recipient.address, content.recipient.area, content.recipient.postalCode].filter(Boolean).join(", ");
  const senderAddress = [content.sender.address, content.sender.city].filter(Boolean).join(", ");
  return (
    <>
      <style>{`@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`}</style>
      <div data-testid="label-page" data-size={content.size}
        style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
        className="shrink-0 bg-white text-black print:break-inside-avoid">
        <article
          aria-label="Label pengiriman"
          data-testid="label-sheet"
          data-size={content.size}
          style={{ width: `${widthMm}mm`, height: `${PARCEL_HEIGHT_MM}mm`, fontFamily: "system-ui, sans-serif" }}
          className="box-border flex shrink-0 flex-col gap-[1.6mm] overflow-hidden border border-black bg-white p-[3mm] text-[3.2mm] leading-[1.25] text-black [overflow-wrap:anywhere] print:m-0 print:break-inside-avoid print:border-0"
        >
          <section aria-label="Pengirim" data-testid="label-sender" className="min-h-0 overflow-hidden border-b border-black pb-[1.4mm]">
            <div className="flex items-start justify-between gap-[1mm]">
              <p className="text-[2.2mm] font-semibold uppercase tracking-wide">Pengirim</p>
              {content.geraiName ? <GeraiIdentity name={content.geraiName} logo={content.geraiLogo} /> : null}
            </div>
            <p className={`font-semibold ${clamp.senderName} text-[3.2mm]`} data-testid="label-sender-name">{dash(content.sender.name)}</p>
            <p className="tabular-nums" data-testid="label-sender-phone">{dash(content.sender.phone)}</p>
            <p className={`${clamp.senderPlace} ${fit(senderAddress.length)}`} data-testid="label-sender-place">{dash(senderAddress)}</p>
          </section>

          <section aria-label="Penerima" data-testid="label-recipient" className="min-h-0 overflow-hidden border-b border-black pb-[1.4mm]">
            <p className="text-[2.2mm] font-semibold uppercase tracking-wide">Penerima</p>
            <p className={`font-semibold ${clamp.recipientName} ${fitName((content.recipient.name ?? "").length)}`} data-testid="label-recipient-name">{dash(content.recipient.name)}</p>
            <p className="tabular-nums">{dash(content.recipient.phone)}</p>
            <p className={`${clamp.recipientAddress} ${fit(recipientAddress.length)}`} data-testid="label-recipient-address">{dash(recipientAddress)}</p>
          </section>

          <div className="flex shrink-0 items-baseline justify-between gap-2" data-testid="label-service">
            <span className="font-semibold">{content.courierLine}</span>
            <span className="tabular-nums">{formatWeight(content.weightGrams)}</span>
          </div>
          {content.itemDescription ? <p className={`min-h-0 overflow-hidden text-[2.8mm] ${clamp.item}`} data-testid="label-item">Isi: {content.itemDescription}</p> : null}

          {content.cod ? (
            <p className="shrink-0 border-2 border-black px-[2mm] py-[1mm] text-center font-bold tabular-nums" data-testid="label-cod">
              COD — Tagih ke penerima: {formatIdr(content.cod.amountIdr)}
            </p>
          ) : null}

          <div className="mt-auto flex shrink-0 flex-col items-center gap-[0.6mm]" data-testid="label-barcode-block">
            <div className="w-full">
              <Code128Barcode value={content.awb} heightMm={12} />
            </div>
            <p className="font-bold tracking-[0.3mm] tabular-nums text-[4mm]" data-testid="label-awb">{content.awb}</p>
            <p className="text-[2.4mm] tabular-nums" data-testid="label-reference">Ref {content.reference}</p>
          </div>
        </article>
        {content.size === "10x15" ? <CustomerSlip content={customerSlipContent(content)} /> : null}
      </div>
    </>
  );
}
