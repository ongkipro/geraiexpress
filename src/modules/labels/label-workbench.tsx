"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, EyeOff, Printer } from "lucide-react";
import { LabelSheet } from "@/components/label/label-sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatWib } from "@/lib/format";
import {
  DEFAULT_LABEL_SIZE, LABEL_SIZES, SENDER_LIMITS, buildLabelContent, contentFromSnapshot, isLabelSize, sameChoice, senderErrors,
  type LabelChoice, type LabelFacts, type LabelSize, type LabelSnapshot, type SenderErrors, type SenderInput,
} from "@/lib/label-content";
import { printLabelAction } from "./actions";
import { FORMAT_LOCKED, LABEL_UNKNOWN_RESULT, MASKING_ACK_REQUIRED, MASKING_DISABLED, RETENTION_NOTE, WHATSAPP_MISSING } from "./messages";
import { MaskingAcceptanceGate, ReturnDestinationNotes } from "./masking-acceptance";
import { acceptanceHistoryLabel, acceptanceShortLabel, type AcceptanceState, type CourierAcceptance } from "./masking-acceptance-state";
import { PendingLabel, PreviewDesk, ScaledSheet, SegmentedControl, ZOOM_OPTIONS, type Zoom } from "./print-ui";

export type PrintHistoryEntry = {
  id: number; at: string; version: number; size: LabelSize; mask: boolean;
  // PR-46: the courier's acceptance at print time and the operator's acknowledgement (NULL when unmasked).
  acceptanceState: AcceptanceState | null; acknowledged: boolean | null;
};

const SIZE_OPTIONS = (Object.keys(LABEL_SIZES) as LabelSize[]).map((key) => ({ value: key, label: LABEL_SIZES[key].label }));

// The masking switch and the size are remembered for this browser tab (sessionStorage), per gerai and
// user, as a UI preference only: never the sender fields, and never on the server. A shipment that already
// has a stored label opens on the defaults so its reprint stays one click.
type Preference = { mask: boolean; size: LabelSize };
function readPreference(key: string): Preference | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { mask?: unknown; size?: unknown };
    return typeof value.mask === "boolean" && isLabelSize(value.size) ? { mask: value.mask, size: value.size } : null;
  } catch {
    return null;
  }
}
function writePreference(key: string, value: Preference) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode quota): the choice simply is not remembered.
  }
}

// UX-9 print view of a real issued shipment: the size, the masking switch with the sender fields when
// it is on, the print button, and a preview that is the print output. Preview before print is built from the
// same facts the snapshot command reads; once printed, the sheet is rendered from the stored snapshot the
// command returned, and a reprint of an unchanged choice is another print event on that same snapshot.
export function LabelWorkbench({
  shipmentId, facts, role, maskingAllowed, snapshots, history, preferenceKey, initialSender, lockedSize, acceptance, returnNote,
}: {
  shipmentId: string;
  facts: LabelFacts;
  role: "tenant_admin" | "operator";
  maskingAllowed: boolean;
  snapshots: LabelSnapshot[];
  lockedSize: LabelSize | null;
  history: PrintHistoryEntry[];
  preferenceKey: string;
  // T-094: the masked sender starts from the shipment's own sender and stays editable.
  initialSender: SenderInput;
  // T-084 / PR-46: the courier's masking acceptance and the return-destination help text.
  acceptance: CourierAcceptance;
  returnNote: string;
}) {
  const router = useRouter();
  const [mask, setMask] = useState(false);
  const [chosenSize, setSize] = useState<LabelSize>(DEFAULT_LABEL_SIZE);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [sender, setSender] = useState<SenderInput>(initialSender);
  const [errors, setErrors] = useState<SenderErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [printed, setPrinted] = useState<LabelSnapshot | null>(null);
  const [printNonce, setPrintNonce] = useState(0);
  const [pending, startTransition] = useTransition();
  // Synchronous guard: `pending` only changes on the next render, so a same-tick double click would print twice.
  const printing = useRef(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [preferenceRestored, setPreferenceRestored] = useState(false);
  const fieldRefs = {
    name: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null),
    address: useRef<HTMLInputElement>(null), city: useRef<HTMLInputElement>(null),
  };

  // A tenant whose masking was disabled by the platform always prints the gerai identity.
  const effectiveMask = maskingAllowed && mask;
  const formatLock = lockedSize ?? printed?.size ?? null;
  const size = formatLock ?? chosenSize;
  const choice: LabelChoice = { mask: effectiveMask, size, sender };
  const stored = printed ?? snapshots[0] ?? null;
  const reuse = stored !== null && sameChoice(stored, choice);
  const content = reuse ? contentFromSnapshot(stored) : buildLabelContent(facts, choice);
  const whatsappBlocked = !effectiveMask && !facts.geraiWhatsapp;
  const hasSnapshot = snapshots.length > 0;
  // PR-46: a masked print of a courier without recorded acceptance needs the explicit acknowledgement.
  const needsAck = effectiveMask && acceptance.state !== "verified";

  // Restore the tab's remembered choice after hydration (the server render always shows the defaults).
  // `data-preference-restored` on the root is committed in the same render as the restored choice, so a
  // browser test can tell when the switch shows its final state.
  useEffect(() => {
    const preference = hasSnapshot ? null : readPreference(preferenceKey);
    if (preference) {
      setMask(preference.mask);
      setSize(preference.size);
    }
    setPreferenceRestored(true);
  }, [preferenceKey, hasSnapshot]);

  // window.print() runs after the sheet has been rendered from the stored snapshot (commit, then effect).
  useEffect(() => {
    if (printNonce === 0) return;
    window.print();
    router.refresh();
  }, [printNonce, router]);

  const choose = (next: Partial<Preference>) => {
    const value = { mask: next.mask ?? mask, size: next.size ?? size };
    setMask(value.mask);
    setSize(value.size);
    if (!value.mask) { setAcknowledged(false); setAckError(false); }
    writePreference(preferenceKey, value);
    setFailure(null);
    setNotice(null);
  };

  const edit = (patch: Partial<SenderInput>) => {
    setSender((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as (keyof SenderInput)[]) delete next[key];
      return next;
    });
    setFailure(null);
    setNotice(null);
  };

  const print = () => {
    setFailure(null);
    setNotice(null);
    if (whatsappBlocked || reconcile) return;
    if (effectiveMask) {
      const found = senderErrors(sender);
      setErrors(found);
      const first = (["name", "phone", "address", "city"] as const).find((key) => found[key]);
      if (first) {
        fieldRefs[first].current?.focus();
        return;
      }
    }
    if (needsAck && !acknowledged) {
      setAckError(true);
      document.getElementById("masking-ack")?.focus();
      return;
    }
    if (printing.current) return;
    printing.current = true;
    startTransition(async () => {
      try {
        const result = await printLabelAction({ shipmentId, mask: effectiveMask, size, sender, acknowledged: effectiveMask && acknowledged });
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFailure(result.error);
          setReconcile(result.reconcile === true);
          if (result.error === FORMAT_LOCKED) router.refresh();
          if (result.error === MASKING_ACK_REQUIRED) setAckError(true);
          return;
        }
        setPrinted(result.snapshot);
        setNotice(`Permintaan cetak label versi ${result.snapshot.version} dicatat di riwayat dan dialog cetak peramban dibuka. Ini belum membuktikan kertas tercetak.`);
        setPrintNonce((n) => n + 1);
      } catch {
        setReconcile(true);
        setFailure(LABEL_UNKNOWN_RESULT);
      } finally {
        printing.current = false;
      }
    });
  };

  // Structured fields with the printed limits (owner, 2026-11-04: tidy label). The street is optional.
  const fields: { key: keyof SenderInput; label: string; autoComplete: string; inputMode?: "tel"; maxLength?: number; required: boolean; hint?: string }[] = [
    { key: "name", label: "Nama pengirim", autoComplete: "off", maxLength: SENDER_LIMITS.nameMax, required: true },
    { key: "phone", label: "No. HP pengirim", autoComplete: "off", inputMode: "tel", maxLength: 20, required: true },
    { key: "address", label: "Alamat pengirim (opsional)", autoComplete: "off", maxLength: SENDER_LIMITS.addressMax, required: false,
      hint: `Jalan dan nomor, maks. ${SENDER_LIMITS.addressMax} karakter.` },
    { key: "city", label: "Kecamatan/kota pengirim", autoComplete: "off", maxLength: SENDER_LIMITS.cityMax, required: true },
  ];

  return (
    <div data-testid="label-workbench" data-preference-restored={preferenceRestored ? "true" : undefined} className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start print:block">
      <section aria-label="Pengaturan label" className="flex flex-col rounded-lg bg-card ring-1 ring-border lg:col-start-1 lg:row-start-1 print:hidden">
        <div className="flex flex-col gap-3 p-5">
          <h2 id="size-heading" className="text-[17px]">Ukuran label</h2>
          <SegmentedControl value={size} onChange={(value) => choose({ size: value })} options={SIZE_OPTIONS.map((option) => ({ ...option, disabled: formatLock !== null || pending }))} labelledBy="size-heading" stretch />
          {formatLock ? <p data-testid="format-locked" className="text-sm text-muted-foreground">{FORMAT_LOCKED}</p> : <p className="text-sm text-muted-foreground">10 × 15 cm: label paket 10 × 10 cm + slip pelanggan 10 × 5 cm. Format terkunci saat cetak pertama.</p>}
        </div>

        <div className="flex flex-col gap-3 border-t border-border p-5">
          <h2 id="mask-heading" className="text-[17px]">Pengirim di label</h2>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <span className="flex min-w-0 flex-col">
              <span>Gunakan masking pengirim</span>
              <span data-testid="mask-state" className="text-sm text-muted-foreground">{effectiveMask ? "Aktif" : "Nonaktif"}</span>
              {maskingAllowed && acceptance.state !== "verified" ? (
                <span data-testid="mask-acceptance-state" className="text-sm text-warning">{acceptanceShortLabel(acceptance)}</span>
              ) : null}
            </span>
            <input
              type="checkbox"
              role="switch"
              className="relative h-[31px] w-[51px] shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-[27px] before:rounded-full before:bg-card before:ring-1 before:ring-border before:transition-transform before:content-[''] checked:bg-primary checked:before:translate-x-5 checked:before:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed motion-reduce:transition-none motion-reduce:before:transition-none"
              checked={effectiveMask}
              disabled={!maskingAllowed}
              aria-describedby={maskingAllowed ? "mask-help" : "mask-help mask-disabled"}
              onChange={(event) => choose({ mask: event.target.checked })}
            />
          </label>
          <p id="mask-help" className="text-sm text-muted-foreground">
            Nonaktif: label memakai nama, WhatsApp, dan alamat pickup gerai. Aktif: label memakai data pengirim pengiriman ini yang masih bisa Anda ubah khusus untuk label ini.
          </p>
          {!maskingAllowed ? (
            <p id="mask-disabled" data-testid="mask-disabled-reason" className="rounded-md bg-muted p-3 text-sm">{MASKING_DISABLED}</p>
          ) : null}
          {effectiveMask ? (
            <div className="flex flex-col gap-3" data-testid="sender-fields">
              {fields.map(({ key, label, autoComplete, inputMode, maxLength, required, hint }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`sender-${key}`}>{label}</Label>
                  <Input
                    id={`sender-${key}`}
                    ref={fieldRefs[key]}
                    value={sender[key]}
                    onChange={(event) => edit({ [key]: event.target.value })}
                    required={required}
                    maxLength={maxLength}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    aria-invalid={errors[key] ? true : undefined}
                    aria-describedby={[hint ? `sender-${key}-hint` : "", errors[key] ? `sender-${key}-error` : ""].filter(Boolean).join(" ") || undefined}
                  />
                  {hint ? <p id={`sender-${key}-hint`} className="text-sm text-muted-foreground">{hint}</p> : null}
                  {errors[key] ? (
                    <p id={`sender-${key}-error`} role="alert" className="flex items-center gap-1.5 text-sm text-danger">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{errors[key]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {effectiveMask ? (
            <>
              <MaskingAcceptanceGate
                pending={needsAck ? [acceptance] : []}
                acknowledged={acknowledged}
                onAcknowledgedChange={(value) => { setAcknowledged(value); setAckError(false); setFailure(null); }}
                disabled={pending}
                error={ackError}
              />
              <ReturnDestinationNotes notes={[{ key: "single", text: returnNote }]} />
            </>
          ) : null}
          {role === "tenant_admin" ? <p className="text-sm text-muted-foreground" data-testid="retention-note">{RETENTION_NOTE}</p> : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-border p-5">
          {whatsappBlocked ? (
            <Alert data-testid="whatsapp-missing" className="border-warning/40 bg-warning-soft">
              <AlertTriangle className="text-warning" aria-hidden="true" />
              <AlertDescription className="flex flex-col gap-1 text-foreground">
                <p>{WHATSAPP_MISSING}</p>
                {role === "tenant_admin" ? (
                  <Link href="/pengaturan#whatsapp-gerai" className="inline-flex min-h-11 items-center self-start font-medium text-primary no-underline! hover:underline!">
                    Isi nomor WhatsApp gerai di Pengaturan
                  </Link>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {failure || reconcile ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription className="text-foreground">
                {reconcile ? <>{LABEL_UNKNOWN_RESULT} <a href={`/pengiriman/${shipmentId}/label`} className="underline">Muat ulang</a></> : failure}
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? <p role="status" data-testid="print-notice" className="rounded-md bg-muted p-3 text-sm">{notice}</p> : null}
          <Button type="button" onClick={print} disabled={pending || whatsappBlocked || reconcile} aria-busy={pending} className="w-full">
            <Printer data-icon="inline-start" aria-hidden="true" />
            <PendingLabel pending={pending} label={reuse ? "Cetak ulang label" : "Cetak label"} pendingLabel="Menyimpan label…" />
          </Button>
          <p className="text-sm text-muted-foreground">
            {reuse
              ? `Memakai label tersimpan versi ${stored.version}; cetak ulang tidak membuat label baru.`
              : "Label disimpan saat Anda mencetak. Mengubah pilihan di atas membuat versi label baru."}
          </p>
        </div>
      </section>

      {/* Print output exists only for a stored snapshot: Ctrl+P on an unsaved preview prints nothing, so a masked label cannot leave without a snapshot and a print event (B-T044c). */}
      <section
        aria-labelledby="preview-heading"
        data-print-source={reuse ? "snapshot" : "none"}
        className={`flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${reuse ? "print:block" : "print:hidden"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="preview-heading" className="text-[17px]">Pratinjau</h2>
            {effectiveMask ? (
              <Badge variant="info"><EyeOff aria-hidden="true" />Masking aktif</Badge>
            ) : null}
            <span data-testid="preview-source" className="text-sm text-muted-foreground">
              {reuse ? `Label tersimpan versi ${stored.version} (${formatWib(stored.created_at)})` : "Belum disimpan"}
            </span>
          </div>
          <SegmentedControl value={zoom} onChange={setZoom} options={ZOOM_OPTIONS} label="Perbesaran pratinjau" />
        </div>
        <PreviewDesk>
          <ScaledSheet zoom={zoom} label="Pratinjau label" fitHeight>
            <LabelSheet content={content} />
          </ScaledSheet>
        </PreviewDesk>
        <p className="text-sm text-muted-foreground print:hidden">
          Pratinjau ini adalah isi yang dicetak; pilih 100% untuk ukuran asli. Alamat pickup asli tetap tampil di rincian pengiriman untuk retur.
        </p>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2 rounded-lg bg-card p-5 ring-1 ring-border lg:col-start-1 lg:row-start-2 print:hidden">
        <h2 id="history-heading" className="text-[17px]">Riwayat permintaan cetak</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada permintaan cetak. Riwayat tercatat saat Anda menekan Cetak label.</p> : (
          <ol data-testid="print-history" className="flex flex-col divide-y divide-border">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm first:pt-0 last:pb-0">
                <span>
                  Versi {entry.version} · {LABEL_SIZES[entry.size].label} · {entry.mask ? "Masking pengirim" : "Identitas gerai"}
                  {acceptanceHistoryLabel(entry.acceptanceState, entry.acknowledged) ? <> · {acceptanceHistoryLabel(entry.acceptanceState, entry.acknowledged)}</> : null}
                </span>
                <time dateTime={entry.at} className="tabular text-muted-foreground">{formatWib(entry.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
