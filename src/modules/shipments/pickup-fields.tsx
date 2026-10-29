"use client";

// T-043 / PR-5 / UX-10: per-shipment handover choice (drop-off or pickup) with the pickup date, the
// one-hour slot, the vehicle class and a local note. Every input is a plain named form control, so
// the values travel with the intake form (names: handover, pickup_date, pickup_slot_hour,
// pickup_volume, pickup_note) and are validated on the server (draft.ts); what is disabled or
// hidden here is a hint only. The clock used for the hints is the browser's and is read after
// mount, so the server render never depends on it. Rendered inside the "Paket & serah" step, so it
// draws no frame of its own.
import { useEffect, useState } from "react";
import { Info, Store, Truck } from "lucide-react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  dateLabel, PICKUP_LEAD_MINUTES, PICKUP_SLOT_HOURS, pickupDates, pickupSlotError, PICKUP_VOLUMES, slotLabel, VOLUME_LABEL, isPickupVolume,
} from "@/lib/mengantar/pickup";
import type { DraftField, DraftValues } from "./draft";
import { FieldMessage } from "./intake-step";
import { ChoiceSelect } from "./choice-select";

type Props = {
  values: DraftValues;
  errors: Partial<Record<DraftField, string>>;
  onChange: (field: DraftField, value: string) => void;
};

// One line for the confirmation review: how the parcel reaches the courier.
export function handoverSummary(values: Pick<DraftValues, "handover" | "pickup_date" | "pickup_slot_hour">): string {
  if (values.handover !== "pickup") return "Antar sendiri ke gerai kurir";
  const hour = Number(values.pickup_slot_hour);
  return values.pickup_date && Number.isInteger(hour) ? `Jemput kurir · ${dateLabel(values.pickup_date)} · ${slotLabel(hour)}` : "Jemput kurir";
}

const OPTIONS = [
  ["dropoff", "Antar sendiri ke gerai kurir", "Paket diantar ke gerai atau agen kurir. Tidak ada jadwal.", Store],
  ["pickup", "Jemput kurir", "Kurir menjemput di alamat pickup gerai pada jadwal yang dipilih.", Truck],
] as const;

export function PickupFields({ values, errors, onChange }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const pickup = values.handover === "pickup";
  const dates = now ? pickupDates(now) : values.pickup_date ? [values.pickup_date] : [];
  const dateOptions = values.pickup_date && !dates.includes(values.pickup_date) ? [values.pickup_date, ...dates] : dates;
  const err = (name: DraftField, id: string) => (errors[name] ? <FieldMessage id={`${id}-err`}>{errors[name]}</FieldMessage> : null);
  const invalid = (name: DraftField) => (errors[name] ? true : undefined);

  return (
    <fieldset className="flex min-w-0 flex-col gap-4" data-testid="pickup-fields">
      <legend className="mb-3 text-base font-semibold">Penyerahan paket</legend>
      {/* T-072: the handover stays a group of native radio cards, not a select: two choices whose explanations must stay
          visible side by side, and native radios keep arrow-key selection and a no-JavaScript submit of `handover`. */}
      <div role="radiogroup" aria-label="Cara paket sampai ke kurir" className="grid gap-3 @md:grid-cols-2">
        {OPTIONS.map(([value, label, hint, Icon]) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-3 ring-1 ring-border transition-colors has-[:checked]:bg-info-soft has-[:checked]:ring-2 has-[:checked]:ring-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
          >
            <input type="radio" name="handover" value={value} checked={values.handover === value}
              onChange={() => onChange("handover", value)} className="mt-0.5 size-5 shrink-0 accent-primary focus-visible:outline-none" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 font-semibold">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {label}
              </span>
              <span className="text-sm text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </div>

      {pickup ? (
        <div className="flex flex-col gap-4" data-testid="pickup-details">
          <div className="grid gap-4 @md:grid-cols-2">
            <Field data-invalid={invalid("pickup_date")}>
              <FieldLabel htmlFor="f-pickup_date">Tanggal jemput</FieldLabel>
              <ChoiceSelect id="f-pickup_date" name="pickup_date" value={values.pickup_date} placeholder="Pilih tanggal"
                invalid={!!errors.pickup_date} describedBy={errors.pickup_date ? "f-pickup_date-err" : undefined}
                onValueChange={(v) => onChange("pickup_date", v)}
                options={dateOptions.map((d) => ({ value: d, label: dateLabel(d) }))} />
              {err("pickup_date", "f-pickup_date")}
            </Field>
            <Field data-invalid={invalid("pickup_slot_hour")}>
              <FieldLabel htmlFor="f-pickup_slot_hour">Jam jemput (WIB)</FieldLabel>
              <ChoiceSelect id="f-pickup_slot_hour" name="pickup_slot_hour" value={values.pickup_slot_hour} placeholder="Pilih jam"
                invalid={!!errors.pickup_slot_hour} describedBy={`f-pickup_slot_hour-hint${errors.pickup_slot_hour ? " f-pickup_slot_hour-err" : ""}`}
                onValueChange={(v) => onChange("pickup_slot_hour", v)}
                options={PICKUP_SLOT_HOURS.map((h) => {
                  // Hint only: the server decides with its own clock.
                  const early = !!now && !!values.pickup_date && pickupSlotError(values.pickup_date, h, now) === "too_soon";
                  return { value: String(h), label: `${slotLabel(h)}${early ? " (terlalu dekat)" : ""}`, disabled: early };
                })} />
              <FieldDescription id="f-pickup_slot_hour-hint">
                Slot per jam, 09.00 sampai 18.00 WIB, minimal {PICKUP_LEAD_MINUTES} menit dari sekarang.
              </FieldDescription>
              {err("pickup_slot_hour", "f-pickup_slot_hour")}
            </Field>
          </div>
          <Field data-invalid={invalid("pickup_volume")}>
            <FieldLabel htmlFor="f-pickup_volume">Perkiraan kendaraan penjemput</FieldLabel>
            <ChoiceSelect id="f-pickup_volume" name="pickup_volume" value={isPickupVolume(values.pickup_volume) ? values.pickup_volume : "volumeMotor"}
              invalid={!!errors.pickup_volume} describedBy={errors.pickup_volume ? "f-pickup_volume-err" : undefined}
              onValueChange={(v) => onChange("pickup_volume", v)}
              options={PICKUP_VOLUMES.map((v) => ({ value: v, label: VOLUME_LABEL[v] }))} />
            {err("pickup_volume", "f-pickup_volume")}
          </Field>
          <Field data-invalid={invalid("pickup_note")}>
            <FieldLabel htmlFor="f-pickup_note">Catatan jemput (opsional)</FieldLabel>
            <Textarea id="f-pickup_note" name="pickup_note" rows={2} maxLength={200} value={values.pickup_note}
              aria-describedby={`f-pickup_note-hint${errors.pickup_note ? " f-pickup_note-err" : ""}`} onChange={(e) => onChange("pickup_note", e.target.value)} />
            <FieldDescription id="f-pickup_note-hint">Hanya catatan untuk gerai; tidak dikirim ke Mengantar.</FieldDescription>
            {err("pickup_note", "f-pickup_note")}
          </Field>
          <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="pickup-note">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Slot jemput dipesan di Mengantar saat Anda mengonfirmasi, sebelum pesanan dibuat. Alamat jemput tetap alamat pickup gerai
              ({"\u201C"}alamat asli{"\u201D"} di detail pengiriman), bukan alamat pengirim pelanggan. Jika konfirmasi tertunda atau hasilnya
              belum pasti, sistem memeriksa pesanan yang sama; slot tidak dipesan dua kali.
            </span>
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
