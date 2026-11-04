"use client";

// T-082 / UX-17 item 4, UI-6: print-first customer receipt at 58 mm or 80 mm roll width (browser
// print, no hardware dependency). The on-screen preview is the print output. Everything printed comes
// from buildReceipt (confirmation snapshot + active payment record); the WhatsApp action opens a
// prefilled wa.me message and sends nothing by itself.
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { MessageCircle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";
import { cn } from "@/lib/utils";
import { SEGMENT_ITEM, SEGMENT_ITEM_ON, SEGMENT_TRACK } from "@/modules/labels/segment-styles";
import { whatsappReceiptLink, type ReceiptInput } from "./receipt";
import { ReceiptDocument } from "./receipt-document";
import { recordReceiptPrintAction } from "./print-actions";
import { PAYMENT_UNKNOWN_RESULT } from "./messages";

export type ReceiptWidth = "58" | "80";
const WIDTHS: ReceiptWidth[] = ["58", "80"];

export function ReceiptSheet({ input, customerPhone, shipmentId, paymentId }: {
  input: ReceiptInput; customerPhone: string | null; shipmentId: string; paymentId: string | null;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const printing = useRef(false);
  const [width, setWidth] = useState<ReceiptWidth>("58");
  const sheet = useRef<HTMLElement>(null);
  const [heightMm, setHeightMm] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    // CSS @page cannot combine a length and 'auto'. Measure the preview's actual roll height so the
    // print rule has two valid lengths and the preview remains the complete printed document.
    const measure = () => setHeightMm(Math.ceil(element.getBoundingClientRect().height * 25.4 / 96));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const print = () => {
    if (printing.current || failure) return;
    printing.current = true;
    startTransition(async () => {
      try {
        const result = await recordReceiptPrintAction(shipmentId, paymentId, width, {
          geraiName: input.geraiName, geraiWhatsapp: input.geraiWhatsapp,
        });
        if (!result.ok) { setFailure(result.error); return; }
        window.print();
      } catch {
        setFailure(PAYMENT_UNKNOWN_RESULT);
      } finally {
        printing.current = false;
      }
    });
  };
  return (
    <div className="flex flex-col gap-6">
      <style>{`@page { size: ${heightMm ? `${width}mm ${heightMm}mm` : "auto"}; margin: 0; }`}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div role="group" aria-label="Lebar struk" className={cn(SEGMENT_TRACK, "w-full sm:w-auto")}>
          {WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={width === w} disabled={pending} onClick={() => { if (!printing.current) setWidth(w); }}
              className={cn(SEGMENT_ITEM, "flex-1 sm:flex-none", width === w && SEGMENT_ITEM_ON)} data-testid={`receipt-width-${w}`}>
              {w} mm
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={print} disabled={pending || !!failure} data-testid="receipt-print">
            <Printer aria-hidden="true" />{pending ? "Menyiapkan…" : "Cetak struk"}
          </Button>
          <Button asChild variant="outline">
            <a href={whatsappReceiptLink(customerPhone, input)} target="_blank" rel="noopener noreferrer" data-testid="receipt-whatsapp">
              <MessageCircle aria-hidden="true" />Kirim struk via WhatsApp
            </a>
          </Button>
        </div>
      </div>
      {failure ? <Notice tone="danger" className="print:hidden">{failure} <a href={`/pengiriman/${shipmentId}/struk`} aria-label="Muat ulang struk" className="underline">Muat ulang</a></Notice> : null}
      <div className="flex justify-center rounded-lg bg-foreground/5 p-3 sm:p-6 print:block print:rounded-none print:bg-transparent print:p-0">
        <ReceiptDocument input={input} width={width} ref={sheet} />
      </div>
    </div>
  );
}
