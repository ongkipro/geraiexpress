import { code128Bars, code128Width, encodeCode128 } from "@/lib/label-code128";

// The AWB as vector bars with quiet zones (UI-6): one path, so print scaling never blurs it. The text
// alternative carries the AWB for assistive technology; the printed AWB below the bars is rendered by the
// label sheet. Height is set by the caller in mm.
export function Code128Barcode({ value, heightMm }: { value: string; heightMm: number }) {
  const code = encodeCode128(value);
  const path = code128Bars(code).map(([x, w]) => `M${x} 0h${w}v1h-${w}z`).join("");
  return (
    <svg
      role="img"
      aria-label={`Barcode Code128 untuk resi ${value}`}
      data-testid="label-barcode"
      data-barcode-value={value}
      viewBox={`0 0 ${code128Width(code)} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: "100%", height: `${heightMm}mm`, display: "block" }}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
