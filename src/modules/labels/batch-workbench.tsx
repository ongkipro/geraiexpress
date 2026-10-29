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
import { PreviewDesk, ScaledSheet, SegmentedControl } from "./print-ui";

export type BatchEntry = { row: BatchCandidate; facts: LabelFacts; latest: LabelSnapshot | null };

export function BatchWorkbench({ entries, maskingAllowed, whatsapp, preferenceKey }: { entries: BatchEntry[]; maskingAllowed: boolean; whatsapp: string | null; preferenceKey: string }) {
  const [mask, setMask] = useState(false);
  const [size, setSize] = useState<LabelSize>("10x15");
  const [city, setCity] = useState("");
  const [snapshots, setSnapshots] = useState<LabelSnapshot[]>([]);
  const [latestById, setLatestById] = useState(() => new Map(entries.map(({ row, latest }) => [row.id, latest])));
  const [error, setError] = useState("");
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
  }, [preferenceKey, maskingAllowed]);
  const included = entries.filter(({ row }) => !batchExclusion(row, mask, city));
  const excluded = entries.flatMap(({ row }) => { const reason = batchExclusion(row, mask, city); return reason ? [{ row, reason }] : []; });
  const blocked = !mask && !whatsapp;
  const changeChoice = (nextMask: boolean, nextSize: LabelSize) => {
    setMask(nextMask); setSize(nextSize); setSnapshots([]);
    try { sessionStorage.setItem(preferenceKey, JSON.stringify({ mask: nextMask, size: nextSize })); } catch { /* preference is optional */ }
  };
  const contents = snapshots.length
    ? snapshots.map(contentFromSnapshot)
    : included.map(({ row, facts, latest }) => batchPreviewContent(facts, latestById.get(row.id) ?? latest, { mask, size, sender: batchSender(row, city) }));
  async function print() {
    setError("");
    const request = { mask, size, city };
    const ids = included.map(({ row }) => row.id);
    const result = await printBatchLabelsAction({ ids, ...request });
    if (result.snapshots.length) setLatestById((prev) => advanceLatestSnapshots(prev, ids, result.snapshots));
    const now = current.current;
    // The controls are locked while pending; if the choice still changed, never print what the
    // screen no longer shows.
    if (now.mask !== request.mask || now.size !== request.size || now.city !== request.city) {
      setError("Pilihan label berubah saat label disiapkan, jadi label tidak dicetak. Permintaan cetak tadi sudah tercatat; periksa pilihan lalu cetak lagi.");
      return;
    }
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
    <section className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border print:hidden" aria-label="Pengaturan label">
      <div><p className="mb-2 text-sm font-semibold">Ukuran label</p><SegmentedControl label="Ukuran label" value={size} onChange={(value) => changeChoice(mask, value)} options={[{ value: "10x15", label: "10 × 15 cm", disabled: pending }, { value: "10x10", label: "10 × 10 cm", disabled: pending }]} /></div>
      {maskingAllowed ? <label className="flex min-h-11 items-center gap-3"><Switch checked={mask} disabled={pending} onCheckedChange={(value) => changeChoice(value, size)} />Gunakan masking pengirim</label> : null}
      {mask ? <div className="flex flex-col gap-2"><Label htmlFor="batch-city">Kota pengirim untuk semua label</Label><p className="text-sm text-muted-foreground">Kota tidak tersimpan di pengiriman. Isi kota yang sesuai untuk semua pengirim yang dipilih.</p><Input id="batch-city" value={city} disabled={pending} onChange={(event) => { setCity(event.target.value); setSnapshots([]); }} /></div> : null}
      {blocked ? <p role="alert">Isi WhatsApp gerai sebelum mencetak. <Link className="text-primary underline" href="/pengaturan#whatsapp-gerai">Buka pengaturan WhatsApp gerai</Link></p> : null}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <form action={runPrint}><SubmitButton disabled={blocked || !included.length} pendingLabel="Menyiapkan label…">Cetak {included.length} label</SubmitButton></form>
    </section>
    {excluded.length ? <section className="print:hidden"><h2 className="text-xl">Tidak disertakan</h2><ul className="mt-3 divide-y divide-border rounded-lg bg-card ring-1 ring-border">{excluded.map(({ row, reason }) => <li key={row.id} className="p-4"><strong className="tabular">{row.reference}</strong><p className="text-sm text-muted-foreground">{reason}</p></li>)}</ul></section> : null}
    <div className={snapshots.length ? "" : "print:hidden"}><PreviewDesk>{contents.map((content, index) => <div key={`${content.reference}-${index}`} className="print:break-after-page print:last:break-after-auto"><ScaledSheet zoom="fit" label={`Pratinjau ${content.reference}`}><LabelSheet content={content} /></ScaledSheet></div>)}</PreviewDesk></div>
  </>;
}
