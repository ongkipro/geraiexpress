import type { Ref } from "react";
import { buildReceipt, type ReceiptInput } from "./receipt";

// Shared by the print preview and the rendered-text privacy tests: no live identity or pricing lookup.
export function ReceiptDocument({ input, width, ref }: { input: ReceiptInput; width: "58" | "80"; ref?: Ref<HTMLElement> }) {
  const receipt = buildReceipt(input);
  return (
    <article
      ref={ref}
      aria-label="Struk"
      data-testid="receipt-sheet"
      data-width={width}
      style={{ width: `${width}mm` }}
      className={`shrink-0 bg-white px-[3mm] py-[4mm] font-sans text-black [overflow-wrap:anywhere] ${width === "58" ? "text-[2.9mm]" : "text-[3.3mm]"}`}
    >
      <p className="text-center font-semibold">{receipt.title}</p>
      {receipt.header.map((line, i) => (
        <p key={i} className={`text-center ${i === 0 ? "font-semibold" : ""}`}>{line}</p>
      ))}
      <hr className="my-[2mm] border-dashed border-black" />
      <dl className="flex flex-col gap-[1mm]">
        {receipt.lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-[2mm]">
            <dt>{line.label}</dt>
            <dd className="text-right tabular-nums break-all">{line.value}</dd>
          </div>
        ))}
      </dl>
      {receipt.notes.length ? <hr className="my-[2mm] border-dashed border-black" /> : null}
      {receipt.notes.map((note, i) => <p key={i}>{note}</p>)}
      <p className="mt-[3mm] text-center">Terima kasih.</p>
    </article>
  );
}
