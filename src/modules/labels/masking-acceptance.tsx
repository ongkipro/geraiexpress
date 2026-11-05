"use client";

// T-084 / PR-46 / UX-9 acceptance gate, shared by the label, batch and "Resi + invoice" print views:
// the notice for couriers without recorded scan acceptance, the explicit acknowledgement checkbox, and
// the return-destination help text. Screen only (print:hidden); the printed label is unchanged.
import { AlertTriangle } from "lucide-react";
import { MASKING_ACK_REQUIRED } from "./messages";
import { acceptanceNotice, type CourierAcceptance } from "./masking-acceptance-state";

export function MaskingAcceptanceGate({
  pending, acknowledged, onAcknowledgedChange, disabled, error, id = "masking-ack",
}: {
  pending: CourierAcceptance[];
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  disabled?: boolean;
  error?: boolean;
  id?: string;
}) {
  if (pending.length === 0) return null;
  return (
    <div data-testid="masking-acceptance" className="flex flex-col gap-2 rounded-md bg-warning-soft p-3 text-sm print:hidden">
      <p className="flex items-start gap-1.5 font-medium">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        Penerimaan label masking belum terverifikasi
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="masking-acceptance-couriers">
        {pending.map((entry) => <li key={entry.courier ?? "unknown"}>{acceptanceNotice(entry)}</li>)}
      </ul>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
        <input
          id={id}
          type="checkbox"
          className="size-5 shrink-0 accent-primary"
          checked={acknowledged}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
        />
        <span>Saya mengerti penerimaannya belum terverifikasi dan tetap mencetak label masking. Konfirmasi ini dicatat di riwayat cetak.</span>
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{MASKING_ACK_REQUIRED}
        </p>
      ) : null}
    </div>
  );
}

export function ReturnDestinationNotes({ notes }: { notes: { key: string; label?: string; text: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <div data-testid="return-destination" className="flex flex-col gap-1 text-sm text-muted-foreground print:hidden">
      <p className="font-medium text-foreground">Tujuan retur</p>
      {notes.length === 1 && !notes[0].label ? <p>{notes[0].text}</p> : (
        <ul className="flex flex-col gap-1">
          {notes.map((note) => <li key={note.key}>{note.label ? <span className="tabular font-medium text-foreground">{note.label}: </span> : null}{note.text}</li>)}
        </ul>
      )}
    </div>
  );
}
