"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/submit-button";
import { formatIdr } from "@/lib/format";
import { payUnpaidBatchAction } from "./actions";

type Props = {
  shipmentId: string;
  batchDigest: string;
  batch: string;
  courierLabel: string;
  memberCount: number;
  totalCustomerChargeIdr: number;
  references: string[];
};

// T-053 / UX-13: paying a Mengantar batch debits the seller's balance and cannot be undone from here,
// so it needs an explicit confirmation that names the scope and the amount. The confirm button is a
// SubmitButton: while the form submits it is aria-disabled with a pending label and swallows repeat
// clicks, so a double click sends one request. Backend idempotency (single-use authorization, one open
// attempt per batch) stays authoritative.
export function BatchPayControl({ shipmentId, batchDigest, batch, courierLabel, memberCount, totalCustomerChargeIdr, references }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" className="w-full sm:w-auto" aria-haspopup="dialog" onClick={() => setOpen(true)}>Bayar batch dari saldo Mengantar</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="batch-pay-dialog">
          <form action={payUnpaidBatchAction} className="flex flex-col gap-4">
            <input type="hidden" name="shipment_id" value={shipmentId} />
            <input type="hidden" name="batch_digest" value={batchDigest} />
            <DialogHeader className="pr-12">
              <DialogTitle>Bayar batch ini dari saldo Mengantar?</DialogTitle>
              <DialogDescription>
                Saldo Mengantar akun penjual gerai ini akan dipotong untuk membayar semua pesanan dalam batch, sekaligus.
                Tindakan ini tidak bisa dibatalkan dari GeraiExpress.
              </DialogDescription>
            </DialogHeader>
            <dl className="flex flex-col divide-y divide-border text-sm" data-testid="batch-pay-summary">
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 py-2">
                <dt className="text-muted-foreground">Batch</dt>
                <dd><span className="tabular font-semibold">{batch}</span> ({courierLabel})</dd>
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 py-2">
                <dt className="text-muted-foreground">Jumlah pesanan</dt>
                <dd className="font-semibold"><span className="tabular">{memberCount}</span> pesanan</dd>
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 py-2">
                <dt className="text-muted-foreground">Total ongkir pelanggan</dt>
                <dd className="tabular font-semibold">{formatIdr(totalCustomerChargeIdr)}</dd>
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 py-2">
                <dt className="text-muted-foreground">Pesanan</dt>
                <dd className="tabular break-words">{references.join(", ")}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              Angka di atas adalah ongkir pelanggan sebagai gambaran. Potongan saldo yang sebenarnya mengikuti tarif akun penjual Anda di Mengantar.
              Jika jawaban Mengantar tidak jelas, sistem tidak membayar kedua kali; hasilnya diperiksa ulang.
            </p>
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Membayar…" data-testid="batch-pay-confirm">Ya, bayar batch</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
