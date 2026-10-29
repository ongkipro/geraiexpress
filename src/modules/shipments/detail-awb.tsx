"use client";

// UX-14: the resi number with a copy button. The clipboard API needs a secure context and a user
// grant; when it is missing or refuses, the number is selected on screen and the operator is told to
// copy it by hand, so the action never silently does nothing.
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AwbCopy({ awb }: { awb: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(awb);
      setResult("copied");
    } catch {
      const node = textRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setResult("manual");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span ref={textRef} className="tabular select-all break-all text-2xl font-semibold tracking-tight" data-testid="awb">{awb}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} aria-describedby="awb-copy-status">
          {result === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Salin resi
        </Button>
      </div>
      <p id="awb-copy-status" role="status" className="text-sm empty:hidden" data-testid="awb-copy-status">
        {result === "copied" ? "Tersalin" : result === "manual" ? "Nomor resi sudah dipilih; salin manual dengan Ctrl+C atau tahan lalu pilih Salin." : ""}
      </p>
    </div>
  );
}
