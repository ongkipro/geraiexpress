"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, FileText, Printer } from "lucide-react";
import { InvoiceSheet } from "@/components/invoice/invoice-sheet";
import { LabelSheet } from "@/components/label/label-sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabelContent } from "@/lib/label-content";
import { PendingLabel, PreviewDesk, ScaledSheet, SegmentedControl, ZOOM_OPTIONS, type Zoom } from "@/modules/labels/print-ui";
import { MaskingAcceptanceGate, ReturnDestinationNotes } from "@/modules/labels/masking-acceptance";
import type { CourierAcceptance } from "@/modules/labels/masking-acceptance-state";
import { issueInvoiceAction, recordLabelPrintAction } from "./actions";
import type { InvoiceSnapshot } from "./invoice-content";

type Scope = "both" | "label" | "invoice";
type Job = "label" | "invoice";

const SCOPE_HELP: Record<Scope, string> = {
  both: "Dua dialog cetak dibuka berurutan: resi dulu di kertas label, lalu invoice di kertas A4. Pilih printer yang sesuai di tiap dialog.",
  label: "Resi dicetak di kertas label 10 × 15 cm atau 10 × 10 cm, sesuai label tersimpan.",
  invoice: "Invoice dicetak di kertas A4.",
};
const PRINT_LABEL: Record<Scope, string> = { both: "Cetak resi lalu invoice", label: "Cetak resi", invoice: "Cetak invoice" };

// The "Resi + invoice" print view (PR-16, UX-9): the stored masked label snapshot and the stored invoice.
// The label is created and its masking chosen in the label view; this view only reads the stored snapshot
// (preview = print output). The thermal label and the A4 invoice never share a print job: "Keduanya" opens
// one print dialog for the label and then one for the invoice, each with only its own sheet in print.
// Printing records one print request on the label's history when the label is part of it.
export function InvoiceWorkbench({
  shipmentId, shipmentRef, labelSnapshotId, label, invoice, labelAcceptance, returnNote,
}: {
  shipmentId: string;
  shipmentRef: string;
  labelSnapshotId: string | null;
  label: LabelContent | null;
  invoice: InvoiceSnapshot | null;
  // T-084 / PR-46: set only for a stored masked label; null for an unmasked label or none.
  labelAcceptance: CourierAcceptance | null;
  // UX-9: the screen-only return destination; set whenever the stored label is masked.
  returnNote: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(label ? "both" : "invoice");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [issuing, startIssue] = useTransition();
  const [printing, startPrint] = useTransition();
  // Synchronous guard: `pending` only changes on the next render, so a same-tick double click would repeat the command.
  const busy = useRef(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState(false);

  const showLabel = label !== null && scope !== "invoice";
  const showInvoice = invoice !== null && scope !== "label";
  const needsAck = showLabel && labelAcceptance !== null && labelAcceptance.state !== "verified";
  const printable = (scope === "label" ? label !== null : scope === "invoice" ? invoice !== null : label !== null && invoice !== null);
  // What is in print right now: the running job, otherwise the first sheet of the scope (so Ctrl+P on
  // "Keduanya" also prints the label alone, never both sheets in one job).
  const job = jobs[0] ?? null;
  const labelInPrint = job ? job === "label" : scope !== "invoice";
  const invoiceInPrint = job ? job === "invoice" : scope === "invoice";

  // Each window.print() runs after the DOM shows only that job's sheet (commit, then effect); the next job
  // starts when the previous dialog has closed.
  useEffect(() => {
    if (jobs.length === 0) return;
    window.print();
    setJobs((queue) => queue.slice(1));
  }, [jobs]);

  const issue = () => {
    if (busy.current) return;
    setFailure(null);
    busy.current = true;
    startIssue(async () => {
      try {
        const result = await issueInvoiceAction(shipmentId);
        if (!result.ok) setFailure(result.error);
        else router.refresh();
      } finally {
        busy.current = false;
      }
    });
  };

  const print = () => {
    setFailure(null);
    setNotice(null);
    if (!printable) return;
    if (needsAck && !acknowledged) {
      setAckError(true);
      document.getElementById("invoice-masking-ack")?.focus();
      return;
    }
    if (busy.current) return;
    busy.current = true;
    startPrint(async () => {
      try {
        if (showLabel && labelSnapshotId) {
          const result = await recordLabelPrintAction(labelSnapshotId, labelAcceptance !== null && acknowledged);
          if (!result.ok) {
            setFailure(result.error);
            return;
          }
        }
        setNotice(scope === "both"
          ? "Dialog cetak resi lalu dialog cetak invoice dibuka. Ini belum membuktikan kertas tercetak."
          : "Dialog cetak peramban dibuka. Ini belum membuktikan kertas tercetak.");
        setJobs(scope === "both" ? ["label", "invoice"] : [scope]);
      } finally {
        busy.current = false;
      }
    });
  };

  const scopeOptions = [
    { value: "both" as const, label: "Keduanya", disabled: label === null },
    { value: "label" as const, label: "Resi saja", disabled: label === null },
    { value: "invoice" as const, label: "Invoice saja" },
  ];

  return (
    <div data-print-job={job ?? "idle"} className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start print:block">
      <section aria-label="Pengaturan cetak" className="flex flex-col rounded-lg bg-card ring-1 ring-border print:hidden">
        <div className="flex flex-col gap-3 p-5">
          <h2 id="scope-heading" className="text-[17px]">Yang dicetak</h2>
          <SegmentedControl value={scope} onChange={(value) => { setScope(value); setNotice(null); }} options={scopeOptions} labelledBy="scope-heading" stretch />
          <p className="text-sm text-muted-foreground">{SCOPE_HELP[scope]}</p>
        </div>

        <div className="flex flex-col border-t border-border">
          <h2 className="sr-only">Dokumen</h2>
          <div className="flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between gap-3">
              <span>Resi (label)</span>
              {label ? (
                <Badge variant="success"><CheckCircle2 aria-hidden="true" />Tersimpan</Badge>
              ) : (
                <Badge variant="warning"><CircleDashed aria-hidden="true" />Belum dibuat</Badge>
              )}
            </div>
            {label === null ? (
              <div role="alert" data-testid="label-missing" className="flex flex-col gap-1 text-sm">
                <p className="text-muted-foreground">Label {shipmentRef} belum dibuat. Buat label dulu (pilih masking pengirim dan ukuran), lalu kembali ke sini.</p>
                <Link href={`/pengiriman/${shipmentId}/label`} className="inline-flex min-h-11 items-center self-start font-medium text-primary underline-offset-4 hover:underline">
                  Buat label
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="label-source">Label tersimpan dipakai apa adanya (dibuat di halaman label).</p>
            )}
            {needsAck && labelAcceptance ? (
              <MaskingAcceptanceGate id="invoice-masking-ack" pending={[labelAcceptance]} acknowledged={acknowledged} disabled={printing}
                error={ackError} onAcknowledgedChange={(value) => { setAcknowledged(value); setAckError(false); setFailure(null); }} />
            ) : null}
            {label !== null && returnNote ? <ReturnDestinationNotes notes={[{ key: "label", text: returnNote }]} /> : null}
          </div>
          <div className="flex flex-col gap-2 border-t border-border p-5">
            <div className="flex items-center justify-between gap-3">
              <span>Invoice</span>
              {invoice ? (
                <Badge variant="success"><CheckCircle2 aria-hidden="true" />Terbit</Badge>
              ) : (
                <Badge variant="neutral"><CircleDashed aria-hidden="true" />Belum terbit</Badge>
              )}
            </div>
            {invoice === null ? (
              <>
                <p className="text-sm text-muted-foreground">Nomor invoice dibuat saat diterbitkan dan isinya tidak berubah setelah itu.</p>
                <Button type="button" variant="outline" onClick={issue} disabled={issuing} aria-busy={issuing} className="self-start">
                  <FileText data-icon="inline-start" aria-hidden="true" />
                  <PendingLabel pending={issuing} label="Terbitkan invoice" pendingLabel="Menerbitkan…" />
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="invoice-source">
                Invoice <span className="tabular">{invoice.invoice_number}</span> tersimpan; mencetak ulang tidak membuat invoice baru.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border p-5">
          {failure ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription className="text-foreground">{failure}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? <p role="status" className="rounded-md bg-muted p-3 text-sm">{notice}</p> : null}
          <Button type="button" onClick={print} disabled={printing || issuing || !printable} aria-busy={printing} className="w-full">
            <Printer data-icon="inline-start" aria-hidden="true" />
            <PendingLabel pending={printing} label={PRINT_LABEL[scope]} pendingLabel="Menyiapkan cetak…" />
          </Button>
          {!printable ? (
            <p className="text-sm text-muted-foreground">
              {label === null && scope !== "invoice" ? "Buat label dulu untuk mencetak resi." : "Terbitkan invoice dulu untuk mencetaknya."}
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="preview-heading" className="flex min-w-0 flex-col gap-3 print:block">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <h2 id="preview-heading" className="text-[17px]">Pratinjau</h2>
          <SegmentedControl value={zoom} onChange={setZoom} options={ZOOM_OPTIONS} label="Perbesaran pratinjau" />
        </div>
        <PreviewDesk>
          {showLabel ? (
            <ScaledSheet zoom={zoom} label="Pratinjau resi" fitHeight className={labelInPrint ? undefined : "print:hidden"}>
              <LabelSheet content={label} />
            </ScaledSheet>
          ) : null}
          {showInvoice ? (
            <ScaledSheet zoom={zoom} label="Pratinjau invoice" className={invoiceInPrint ? undefined : "print:hidden"}>
              <InvoiceSheet invoice={invoice} />
            </ScaledSheet>
          ) : null}
          {!showLabel && !showInvoice ? (
            <p className="py-10 text-center text-sm text-muted-foreground print:hidden">
              Belum ada dokumen untuk dipratinjau. {invoice === null ? "Terbitkan invoice dulu." : "Buat label di halaman Label."}
            </p>
          ) : null}
        </PreviewDesk>
        <p className="text-sm text-muted-foreground print:hidden">Pratinjau ini adalah isi yang dicetak; pilih 100% untuk ukuran asli.</p>
      </section>
    </div>
  );
}
