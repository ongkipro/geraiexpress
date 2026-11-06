"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { revokeTrackingAction, shareTrackingAction } from "./actions";

type Props = { shipmentId: string; hasPhone: boolean; linkId: string | null; isAdmin: boolean; shared: boolean; revoked: boolean };

export function ShareControls({ shipmentId, hasPhone, linkId, isAdmin, shared, revoked }: Props) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setManual("");
      setNotice(`${label} tersalin.`);
    } catch {
      setManual(value);
      setNotice("Salin manual dari kotak di bawah; clipboard tidak tersedia.");
    }
  }

  function share(intent: "whatsapp" | "message" | "link") {
    startTransition(async () => {
      setNotice("");
      const result = await shareTrackingAction(shipmentId);
      if ("error" in result) { setNotice(result.error); return; }
      if (intent === "whatsapp" && result.whatsapp) {
        // User-initiated navigation, not a popup after an async call and never automated sending.
        window.location.assign(result.whatsapp);
      } else await copy(intent === "link" ? result.link : result.message, intent === "link" ? "Tautan" : "Pesan");
    });
  }

  return (
    <section aria-label="Bagikan resi" className="space-y-3 border-t pt-3">
      <p className="text-sm">{revoked ? "Tautan telah dicabut. Bagikan lagi untuk membuat tautan baru." : shared ? "Tautan sudah disiapkan untuk dibagikan." : "Resi belum dibagikan melalui tautan."}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => share(hasPhone ? "whatsapp" : "message")}>{hasPhone ? "Kirim resi ke pelanggan" : "Salin pesan"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => share("link")}>Salin tautan</Button>
        {isAdmin && shared && !revoked && linkId ? (
          // T-107 / UX-15: the shared confirmation dialog (not window.confirm) names the effect; the
          // confirm button closes it and starts one revoke, and the trigger stays disabled while it runs.
          <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
            <DialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>Cabut tautan</Button></DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader className="pr-12">
                <DialogTitle>Cabut tautan pelacakan?</DialogTitle>
                <DialogDescription>Tautan yang sudah dibagikan ke pelanggan tidak bisa dibuka lagi. Bagikan lagi untuk membuat tautan baru.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-3">
                <DialogClose asChild><Button type="button" variant="outline">Kembali</Button></DialogClose>
                <Button type="button" variant="destructive" onClick={() => {
                  setConfirmRevoke(false);
                  startTransition(async () => {
                    const result = await revokeTrackingAction(shipmentId, linkId);
                    setManual("");
                    setNotice(result.error ?? "Tautan dicabut.");
                  });
                }}>Ya, cabut tautan</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">WhatsApp hanya membuka pesan siap kirim di perangkat Anda. Tidak ada pesan yang dikirim otomatis.</p>
      <p role="status" className="text-sm empty:hidden" aria-live="polite">{pending ? "Menyiapkan…" : notice}</p>
      {manual ? <div className="space-y-2">
        <label className="text-sm" htmlFor={id}>Teks untuk disalin manual</label>
        <textarea id={id} ref={manualRef} className="min-h-28 w-full rounded-md border p-3 text-sm" readOnly value={manual} onFocus={() => manualRef.current?.select()} />
      </div> : null}
    </section>
  );
}
