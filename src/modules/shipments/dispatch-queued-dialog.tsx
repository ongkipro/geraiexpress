"use client";

// F10 / UX-13: "Kirim sekarang" sends a queued order to Mengantar (a real provider effect), so it sits
// behind a confirmation naming the reference and that effect. The action itself is unchanged: it sends
// only the original queued operation and never creates a second one.
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { dispatchQueuedAction } from "./actions";

export function DispatchQueuedDialog({ shipmentId, reference }: { shipmentId: string; reference: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" className="w-full sm:w-auto"><Send aria-hidden="true" />Kirim sekarang</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-12">
          <DialogTitle>Kirim pesanan <span className="tabular whitespace-nowrap">{reference}</span> sekarang?</DialogTitle>
          <DialogDescription>
            Pesanan yang sudah dikonfirmasi ini akan dikirim ke Mengantar dan dibayar dari saldo Mengantar gerai. Tidak ada pesanan baru yang dibuat.
          </DialogDescription>
        </DialogHeader>
        <form action={dispatchQueuedAction}>
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
            <SubmitButton pendingLabel="Mengirim…">Ya, kirim ke Mengantar</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
