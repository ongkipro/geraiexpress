"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { LabelSheet } from "@/components/label/label-sheet";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SubmitButton } from "@/components/submit-button";
import { contentFromSnapshot, isLabelSize, type LabelFacts, type LabelSize, type LabelSnapshot } from "@/lib/label-content";
import { advanceLatestSnapshots, batchExclusion, batchPreviewContent, batchSender, type BatchCandidate } from "./batch-selection";
import { printBatchLabelsAction } from "./batch-actions";
import { LABEL_UNKNOWN_RESULT, MASKING_ACK_REQUIRED } from "./messages";
import { MaskingAcceptanceGate, ReturnDestinationNotes } from "./masking-acceptance";
import { pendingAcceptance, type CourierAcceptance } from "./masking-acceptance-state";
import { PreviewDesk, ScaledSheet, SegmentedControl } from "./print-ui";

// T-084 / PR-46: each entry carries its courier's masking acceptance and its return-destination note.
export type BatchEntry = {
  row: BatchCandidate; facts: LabelFacts; latest: LabelSnapshot | null; lockedSize: LabelSize | null;
  acceptance: CourierAcceptance; returnNote: string;
};

export function BatchWorkbench({ entries, maskingAllowed, whatsapp, preferenceKey }: { entries: BatchEntry[]; maskingAllowed: boolean; whatsapp: string | null; preferenceKey: string }) {
  const [mask, setMask] = useState(false);
  const [size, setSize] = useState<LabelSize>("10x15");
  const [city, setCity] = useState("");
  const [snapshots, setSnapshots] = useState<LabelSnapshot[]>([]);
  const [latestById, setLatestById] = useState(() => new Map(entries.map(({ row, latest }) => [row.id, latest])));
  const [error, setError] = useState("");
  const [reconcile, setReconcile] = useState(false);
  // PR-46: one acknowledgement for the whole masked batch, listing every courier that is not verified.
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [preferenceRestored, setPreferenceRestored] = useState(false);
  // isPending of the form action: plain setState inside an action only commits when it ends.
  const [, runPrint, pending] = useActionState(async () => { await print(); return null; }, null);
  // The choice on screen right now, read when a print response arrives (after an await).
  const current = useRef({ mask, size, city });
  useEffect(() => { current.current = { mask, size, city }; }, [mask, size, city]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(preferenceKey) ?? "null");
      if (saved && isLabelSize(saved.size)) setSize(saved.size);
      if (saved?.mask === true && maskingAllowed) setMask(true);
    } catch { /* preference is optional */ }
    // Committed with the restored choice, so a browser test can tell the switch shows its final state.
    setPreferenceRestored(true);
  }, [preferenceKey, maskingAllowed]);
  const exclusion = ({ row, lockedSize }: BatchEntry) => batchExclusion(row, mask, city, size, lockedSize ?? latestById.get(row.id)?.size);
  const included = entries.filter((entry) => !exclusion(entry));
  const excluded = entries.flatMap((entry) => { const { row } = entry; const reason = exclusion(entry); return reason ? [{ row, reason }] : []; });
  const blocked = !mask && !whatsapp;
  const pendingCouriers = mask ? pendingAcceptance(included.map((entry) => entry.acceptance)) : [];
  const changeChoice = (nextMask: boolean, nextSize: LabelSize) => {
    setMask(nextMask); setSize(nextSize); setSnapshots([]);
    if (!nextMask) { setAcknowledged(false); setAckError(false); }
    try { sessionStorage.setItem(preferenceKey, JSON.stringify({ mask: nextMask, size: nextSize })); } catch { /* preference is optional */ }
  };
  const contents = snapshots.length
    ? snapshots.map(contentFromSnapshot)
    : included.map(({ row, facts, latest }) => batchPreviewContent(facts, latestById.get(row.id) ?? latest, { mask, size, sender: batchSender(row, city) }));
  async function print() {
    if (reconcile) return;
    setError("");
    if (pendingCouriers.length > 0 && !acknowledged) {
      setAckError(true);
      document.getElementById("batch-masking-ack")?.focus();
      return;
    }
    const request = { mask, size, city, acknowledged: mask && acknowledged };
    const ids = included.map(({ row }) => row.id);
    let result: Awaited<ReturnType<typeof printBatchLabelsAction>>;
    try {
      result = await printBatchLabelsAction({ ids, ...request });
    } catch {
      setReconcile(true);
      return;
    }
    if (result.reconcile) {
      setReconcile(true);
      return;
    }
    if (result.snapshots.length) setLatestById((prev) => advanceLatestSnapshots(prev, ids, result.snapshots));
    const now = current.current;
    // The controls are locked while pending; if the choice still changed, never print what the
    // screen no longer shows.
    if (now.mask !== request.mask || now.size !== request.size || now.city !== request.city) {
      setError("Pilihan label berubah saat label disiapkan, jadi label tidak dicetak. Permintaan cetak tadi sudah tercatat; periksa pilihan lalu cetak lagi.");
      return;
    }
    if (result.error === MASKING_ACK_REQUIRED) setAckError(true);
    if (result.error) {
      setError(`${result.error}${result.snapshots.length ? ` ${result.snapshots.length} permintaan cetak sudah tercatat; periksa riwayat sebelum mencoba lagi.` : ""}`);
      return;
    }
    setSnapshots(result.snapshots);
    // React must commit the authoritative snapshots before opening the browser print dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }
  return <>
    <header className="flex flex-wrap items-center gap-3 print:hidden"><h1 className="text-3xl tracking-tight">Cetak label massal</h1><Badge variant="neutral">{included.length} label</Badge></header>
    <section data-testid="batch-settings" data-preference-restored={preferenceRestored ? "true" : undefined} className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border print:hidden" aria-label="Pengaturan label">
      <div><p className="mb-2 text-sm font-semibold">Ukuran label</p><SegmentedControl label="Ukuran label" value={size} onChange={(value) => changeChoice(mask, value)} options={[{ value: "10x15", label: "10 × 15 cm", disabled: pending }, { value: "10x10", label: "10 × 10 cm", disabled: pending }]} /></div>
      <p className="text-sm text-muted-foreground">10 × 15 cm: label paket 10 × 10 cm + slip pelanggan 10 × 5 cm. Kiriman yang terkunci pada ukuran lain tidak disertakan.</p>
      {maskingAllowed ? <label className="flex min-h-11 items-center gap-3"><Switch checked={mask} disabled={pending} onCheckedChange={(value) => changeChoice(value, size)} />Gunakan masking pengirim</label> : null}
      {mask && entries.some(({ row }) => !row.sender_area) ? <div className="flex flex-col gap-2"><Label htmlFor="batch-city">Kecamatan / kota pengirim untuk kiriman yang belum mengisinya</Label><p className="text-sm text-muted-foreground">Label lain memakai pengirim kirimannya sendiri. Isian ini hanya dipakai untuk kiriman lama tanpa kecamatan pengirim.</p><Input id="batch-city" value={city} maxLength={40} disabled={pending} onChange={(event) => { setCity(event.target.value); setSnapshots([]); }} /></div> : null}
      {mask ? <MaskingAcceptanceGate id="batch-masking-ack" pending={pendingCouriers} acknowledged={acknowledged} disabled={pending} error={ackError}
        onAcknowledgedChange={(value) => { setAcknowledged(value); setAckError(false); setError(""); }} /> : null}
      {mask && included.length ? <ReturnDestinationNotes notes={included.map(({ row, returnNote }) => ({ key: row.id, label: row.reference, text: returnNote }))} /> : null}
      {blocked ? <p role="alert">Isi WhatsApp gerai sebelum mencetak. <Link className="text-primary underline" href="/pengaturan#whatsapp-gerai">Buka pengaturan WhatsApp gerai</Link></p> : null}
      {reconcile ? <p role="alert" className="text-danger">{LABEL_UNKNOWN_RESULT} <a href={`/pengiriman/cetak?ids=${entries.map(({ row }) => row.id).join(",")}`} className="underline">Muat ulang</a></p> : error ? <p role="alert" className="text-danger">{error}</p> : null}
      <form action={runPrint}><SubmitButton disabled={blocked || !included.length || reconcile} pendingLabel="Menyiapkan label…">Cetak {included.length} label</SubmitButton></form>
    </section>
    {excluded.length ? <section className="print:hidden"><h2 className="text-xl">Tidak disertakan</h2><ul className="mt-3 divide-y divide-border rounded-lg bg-card ring-1 ring-border">{excluded.map(({ row, reason }) => <li key={row.id} className="p-4"><strong className="tabular">{row.reference}</strong><p className="text-sm text-muted-foreground">{reason}</p></li>)}</ul></section> : null}
    <div className={snapshots.length ? "" : "print:hidden"}><PreviewDesk>{contents.map((content, index) => <div key={`${content.reference}-${index}`} className="print:break-after-page print:last:break-after-auto"><ScaledSheet zoom="fit" label={`Pratinjau ${content.reference}`}><LabelSheet content={content} /></ScaledSheet></div>)}</PreviewDesk></div>
  </>;
}
