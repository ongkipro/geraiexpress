"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/notice";
import { PendingLabel } from "@/modules/labels/print-ui";
import { setGeraiDiscountAction, type DiscountState } from "./actions";
import { bpsToInput, formatPercentBps, formatPointsBps, parsePercentToBps, STATUS_LABEL, STATUS_NOTE } from "./percent";

const SELECT = "min-h-11 w-full rounded-sm border border-input bg-card px-3 text-base";

type Props = {
  // null = the platform default template (a prefill only, owner-stated).
  tenantId: string | null;
  tenantName: string;
  expectedVersion: number;
  today: string;
  currentBps: number | null;
  currentStatus: string | null;
  // Highest provider-observed discount among the couriers of the latest estimate batch (the ceiling);
  // null means not observed (unknown).
  observedBps: number | null;
  // Template value copied into the input as a suggestion; it is never saved without a click.
  prefillBps: number | null;
};

// UX-12 / UX-13: one assignment form. The typed fields stay controlled so an error or a stale
// version never clears them; saving needs a reason and goes through a confirmation that names the
// tenant, the old and new values and the effect. The platform remainder is never an input: it is
// shown as the value the database will derive (highest observed minus the new gerai discount).
export function DiscountForm(p: Props) {
  const isTemplate = p.tenantId === null;
  const [state, action, pending] = useActionState<DiscountState, FormData>(setGeraiDiscountAction, {});
  const [percent, setPercent] = useState(p.prefillBps === null ? "" : bpsToInput(p.prefillBps));
  const [status, setStatus] = useState("owner_stated");
  const [source, setSource] = useState("");
  const [verification, setVerification] = useState("");
  const [effective, setEffective] = useState(p.today);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = `discount-form-${p.tenantId ?? "template"}`;

  const basisPoints = parsePercentToBps(percent);
  const aboveObserved = !isTemplate && basisPoints !== null && p.observedBps !== null && basisPoints > p.observedBps;
  // Teramati dari Mengantar must equal the highest observed value exactly (tolerance 0, enforced by the database).
  const observedMismatch = !isTemplate && status === "provider_observed" && basisPoints !== null && p.observedBps !== null && !aboveObserved && basisPoints !== p.observedBps;
  const percentInvalid = percent !== "" && basisPoints === null;
  const derivedRemainder = !isTemplate && basisPoints !== null && p.observedBps !== null && !aboveObserved ? p.observedBps - basisPoints : null;

  return (
    <div className="flex flex-col gap-5">
      {state.error ? <Notice tone="danger" data-testid="discount-error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success" data-testid="discount-saved">{state.ok}</Notice> : null}
      <form
        id={formId}
        ref={formRef}
        action={(data) => { setConfirming(false); action(data); }}
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="tenant_id" value={p.tenantId ?? ""} />
        <input type="hidden" name="expected_version" value={p.expectedVersion} />

        <FieldGroup className="gap-5">
          <Field data-invalid={percentInvalid || aboveObserved || undefined}>
            <FieldLabel htmlFor={`${formId}-percent`}>Diskon gerai (%)</FieldLabel>
            <Input id={`${formId}-percent`} name="percent" inputMode="decimal" autoComplete="off" required className="tabular"
              value={percent} onChange={(e) => setPercent(e.target.value)} aria-invalid={percentInvalid || aboveObserved}
              aria-describedby={`${formId}-percent-help`} placeholder="mis. 12,5" />
            <FieldDescription id={`${formId}-percent-help`}>
              Persen dengan maksimal dua desimal, disimpan sebagai poin dasar bulat
              {basisPoints !== null ? ` (${basisPoints} poin dasar)` : ""}. Sisa platform tidak bisa diketik: dihitung dari diskon Mengantar tertinggi yang teramati dikurangi diskon gerai.
            </FieldDescription>
            {p.prefillBps !== null && percent === bpsToInput(p.prefillBps) ? (
              <FieldDescription data-testid="discount-prefill">Terisi dari templat default sebagai saran. Belum tersimpan untuk gerai ini.</FieldDescription>
            ) : null}
            {percentInvalid ? <FieldError>Isi persen antara 0 dan 100 dengan maksimal dua desimal.</FieldError> : null}
          </Field>

          {aboveObserved ? (
            <Notice id={`${formId}-blocked`} tone="danger" className="text-sm" data-testid="discount-blocked">
              Diskon gerai {formatPercentBps(basisPoints)} melebihi diskon Mengantar tertinggi yang teramati ({formatPercentBps(p.observedBps)}). GeraiExpress tidak menanggung selisihnya, sehingga nilai ini tidak dapat disimpan. Turunkan diskon gerai menjadi {formatPercentBps(p.observedBps)} atau lebih rendah.
            </Notice>
          ) : null}
          {!isTemplate && p.observedBps === null ? (
            <Notice tone="info" className="text-sm" data-testid="discount-pending-note">
              Diskon Mengantar belum teramati; diskon gerai ditahan sebagai menunggu. Nilai tetap tersimpan sebagai belum terverifikasi dan biaya gerai tampil sebagai belum diketahui sampai ada estimasi sungguhan.
            </Notice>
          ) : null}
          {observedMismatch ? (
            <Notice id={`${formId}-mismatch`} tone="danger" className="text-sm" data-testid="discount-observed-mismatch">
              Status Teramati dari Mengantar hanya untuk nilai yang sama persis dengan diskon Mengantar tertinggi yang teramati ({formatPercentBps(p.observedBps)}). Samakan nilainya atau pilih status Pernyataan pemilik.
            </Notice>
          ) : null}

          {!isTemplate ? (
            <div className="flex flex-col gap-1 border-y border-border py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Perkiraan sisa platform untuk nilai ini (dihitung, tidak diketik)</span>
              <output htmlFor={`${formId}-percent`} className="text-lg font-semibold tabular">
                {derivedRemainder === null ? "belum diketahui" : `${formatPointsBps(derivedRemainder)} (perkiraan)`}
              </output>
            </div>
          ) : null}

          {!isTemplate ? (
            <Field>
              <FieldLabel htmlFor={`${formId}-status`}>Status nilai</FieldLabel>
              <select id={`${formId}-status`} name="status" className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <FieldDescription>{STATUS_NOTE[status]}</FieldDescription>
            </Field>
          ) : (
            <FieldDescription>Templat selalu berstatus pernyataan pemilik dan hanya dipakai sebagai saran isian; tidak pernah diterapkan otomatis ke gerai.</FieldDescription>
          )}

          <Field>
            <FieldLabel htmlFor={`${formId}-effective`}>Berlaku mulai</FieldLabel>
            <Input id={`${formId}-effective`} name="effective" type="date" required min={p.today} value={effective} onChange={(e) => setEffective(e.target.value)} className="min-h-11" />
            <FieldDescription>Hari ini atau setelahnya. Hanya estimasi sesudah tanggal ini yang memakai versi baru; estimasi lama tidak berubah.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${formId}-source`}>Referensi sumber</FieldLabel>
            <Input id={`${formId}-source`} name="source" required minLength={3} maxLength={500} autoComplete="off"
              value={source} onChange={(e) => setSource(e.target.value)} placeholder="mis. Pernyataan pemilik 2026-10-28" />
          </Field>

          {!isTemplate && status === "provider_verified" ? (
            <Field>
              <FieldLabel htmlFor={`${formId}-verification`}>Referensi konfirmasi tertulis Mengantar</FieldLabel>
              <Input id={`${formId}-verification`} name="verification" required minLength={3} maxLength={500} autoComplete="off"
                value={verification} onChange={(e) => setVerification(e.target.value)} placeholder="mis. nomor atau tanggal email konfirmasi" />
              <FieldDescription>Wajib untuk status Terverifikasi Mengantar: ketik referensi konfirmasi tertulis yang Anda terima.</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor={`${formId}-reason`}>Alasan (dicatat di audit)</FieldLabel>
            <Textarea id={`${formId}-reason`} name="reason" rows={2} required minLength={5} maxLength={500}
              value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </FieldGroup>

        <Button
          type="button"
          className="self-start max-sm:w-full"
          disabled={pending || aboveObserved || observedMismatch}
          // A blocked value says why next to the field; the button points at that reason (T-107).
          aria-describedby={aboveObserved ? `${formId}-blocked` : observedMismatch ? `${formId}-mismatch` : undefined}
          aria-busy={pending}
          onClick={() => { if (formRef.current?.reportValidity() && basisPoints !== null) setConfirming(true); }}
        >
          <PendingLabel pending={pending} label="Tinjau & simpan" pendingLabel="Menyimpan versi…" />
        </Button>
        {pending ? <p role="status" className="-mt-3 text-sm text-muted-foreground">Menyimpan versi diskon…</p> : null}
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>Simpan versi diskon {isTemplate ? "templat" : p.tenantName}?</DialogTitle>
            <DialogDescription>
              Berlaku untuk estimasi sesudah tanggal berlaku. Tidak mengubah tagihan Mengantar maupun harga yang dibayar pengirim (tarif normal).
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="discount-confirm">
            <dt className="text-muted-foreground">Gerai</dt><dd>{isTemplate ? "Templat default" : p.tenantName}</dd>
            <dt className="text-muted-foreground">Nilai lama</dt>
            <dd className="tabular">{p.currentBps === null ? "belum ada" : `${formatPercentBps(p.currentBps)} (${STATUS_LABEL[p.currentStatus ?? ""] ?? "—"})`}</dd>
            <dt className="text-muted-foreground">Nilai baru</dt><dd className="font-semibold tabular">{formatPercentBps(basisPoints)} ({STATUS_LABEL[isTemplate ? "owner_stated" : status]})</dd>
            <dt className="text-muted-foreground">Berlaku mulai</dt><dd className="tabular">{effective}</dd>
            <dt className="text-muted-foreground">Sumber</dt><dd className="break-words">{source}</dd>
            <dt className="text-muted-foreground">Alasan</dt><dd className="break-words">{reason}</dd>
          </dl>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="ghost">Kembali</Button></DialogClose>
            <SubmitButton form={formId} pending={pending} pendingLabel="Menyimpan…">Simpan versi</SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
