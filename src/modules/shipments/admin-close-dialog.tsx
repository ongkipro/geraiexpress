"use client";

// T-056 / UX-13: the tenant admin's two close commands on the shipment detail (an unresolved batch
// payment attempt, an ambiguous pickup reservation). Both only record a decision in GeraiExpress and
// send nothing to Mengantar; each sits behind a danger-tier confirmation that says so, needs a reason
// (5–500 characters, audited) and submits through a pending-safe SubmitButton. The Server Actions
// redirect back with ?galat=<code> on refusal; the typed reason is kept in sessionStorage for this
// shipment and command, so it is still in the box when the admin opens the dialog again.
import { useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeAmbiguousReservationAction, closeUnknownBatchPaymentAction } from "./actions";

type Props =
  | { kind: "payment"; shipmentId: string; attemptId: string; batch: string }
  | { kind: "reservation"; shipmentId: string; reference: string };

const COPY = {
  payment: {
    trigger: "Tutup percobaan pembayaran",
    title: "Tutup percobaan pembayaran batch?",
    confirm: "Tutup percobaan pembayaran",
    example: "sudah dicek di aplikasi Mengantar, batch belum dibayar.",
  },
  reservation: {
    trigger: "Tutup pemesanan slot jemput",
    title: "Tutup pemesanan slot jemput?",
    confirm: "Tutup pemesanan slot",
    example: "sudah dicek di aplikasi Mengantar, tidak ada slot maupun pesanan.",
  },
} as const;

export function AdminCloseDialog(props: Props) {
  const id = useId();
  const storageKey = `gx-close:${props.kind}:${props.shipmentId}`;
  const searchParams = useSearchParams();
  const refused = searchParams.has("galat");
  const [reason, setReason] = useState("");

  // Restore the typed reason after a refusal; any other visit starts empty.
  useEffect(() => {
    if (refused) setReason(sessionStorage.getItem(storageKey) ?? "");
    else sessionStorage.removeItem(storageKey);
  }, [refused, storageKey]);

  const copy = COPY[props.kind];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto">
          <ShieldAlert aria-hidden="true" />
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid={`close-${props.kind}-dialog`}>
        <form action={props.kind === "payment" ? closeUnknownBatchPaymentAction : closeAmbiguousReservationAction} className="flex flex-col gap-5">
          <input type="hidden" name="shipment_id" value={props.shipmentId} />
          {props.kind === "payment" ? <input type="hidden" name="attempt_id" value={props.attemptId} /> : null}
          <DialogHeader className="pr-12">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              Ini hanya mencatat keputusan Anda di GeraiExpress dan tidak mengirim apa pun ke Mengantar.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2 rounded-md bg-danger-soft p-4 text-sm">
            {props.kind === "payment" ? (
              <>
                <li>Lakukan hanya setelah Anda memeriksa aplikasi Mengantar dan memastikan batch <span className="tabular font-semibold">{props.batch}</span> belum dibayar.</li>
                <li>Setelah ditutup, batch bisa diotorisasi dan dibayar lagi dari halaman ini bila pesanannya masih belum dibayar.</li>
              </>
            ) : (
              <>
                <li>Lakukan hanya setelah Anda memeriksa aplikasi Mengantar dan memastikan tidak ada slot jemput maupun pesanan untuk referensi <span className="tabular font-semibold">{props.reference}</span>.</li>
                <li>Setelah ditutup, pengiriman ini berstatus gagal dan drafnya bisa dibuka lagi untuk dikonfirmasi ulang.</li>
              </>
            )}
            <li>Alasan Anda dicatat di audit bersama hasil pemeriksaan terakhir.</li>
          </ul>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-reason`}>Alasan penutupan</Label>
            <Textarea id={`${id}-reason`} name="reason" rows={3} required minLength={5} maxLength={500} value={reason}
              aria-describedby={`${id}-hint`}
              onChange={(e) => {
                setReason(e.target.value);
                sessionStorage.setItem(storageKey, e.target.value);
              }} />
            <p id={`${id}-hint`} className="text-sm text-muted-foreground">5–500 karakter. Contoh: {copy.example}</p>
          </div>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
            <SubmitButton variant="destructive" pendingLabel="Menutup…" data-testid={`close-${props.kind}-confirm`}>{copy.confirm}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
