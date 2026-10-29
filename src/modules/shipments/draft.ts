// Server-side draft validation (PR-4/PR-5, DATA-2). Pure so it is unit-testable; the database
// constraints remain the final authority.
import { friendlyError } from "../../lib/errors";
import { LIVE_RECIPIENT_ADDRESS_MAX, LIVE_RECIPIENT_NAME_MAX, providerPhone } from "../../lib/mengantar/public-api";
import { DEFAULT_PICKUP_VOLUME, isPickupVolume, PICKUP_ERROR_TEXT, pickupSlotError } from "../../lib/mengantar/pickup";

export const DRAFT_FIELDS = [
  "sender_name", "sender_phone", "recipient_name", "recipient_phone", "recipient_address",
  "recipient_area", "recipient_area_id", "recipient_postal_code", "item_description", "weight_grams", "length_cm",
  "width_cm", "height_cm", "goods_value_idr", "is_cod",
  // T-043: handover choice ("dropoff" | "pickup") and, for pickup, the slot (WIB date and start hour),
  // vehicle volume class and a local note.
  "handover", "pickup_date", "pickup_slot_hour", "pickup_volume", "pickup_note",
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftValues = Record<DraftField, string>;
export type DraftUpdate = Partial<Record<DraftField, string | number | boolean | null>>;

const PHONE = /^\+?[0-9]{8,15}$/;
const POSTAL = /^[0-9]{5}$/;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s().-]/g, "");
  return digits.startsWith("+62") ? `0${digits.slice(3)}` : digits;
}

function int(raw: string, min: number, max: number): number | null | "invalid" {
  if (raw.trim() === "") return null;
  if (!/^[0-9]+$/.test(raw.trim())) return "invalid";
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : "invalid";
}

export function parseDraft(form: FormData, live = false, now: Date = new Date()): { values: DraftValues; update: DraftUpdate; errors: Partial<Record<DraftField, string>> } {
  const values = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, String(form.get(f) ?? "").trim()])) as DraftValues;
  const errors: Partial<Record<DraftField, string>> = {};
  const update: DraftUpdate = {};

  const text = (field: DraftField, max: number, min = 1) => {
    const v = values[field];
    if (v === "") return void (update[field] = null);
    if (v.length < min || v.length > max) errors[field] = `Isi ${min}–${max} karakter.`;
    else update[field] = v;
  };
  text("sender_name", 120, 2);
  text("recipient_name", 120, 2);
  text("recipient_address", 500, 5);
  text("recipient_area", 160, 3);
  text("item_description", 200, 2);

  for (const field of ["sender_phone", "recipient_phone"] as const) {
    const v = normalizePhone(values[field]);
    if (v === "") update[field] = null;
    else if (!PHONE.test(v)) errors[field] = "Nomor HP 8–15 digit, contoh 081234567890.";
    else update[field] = v;
  }
  // Mengantar area id chosen from the provider's index (connected gerai only).
  if (values.recipient_area_id === "") update.recipient_area_id = null;
  else if (!/^[a-f0-9]{24}$/.test(values.recipient_area_id)) errors.recipient_area = "Pilih wilayah dari hasil pencarian.";
  else update.recipient_area_id = values.recipient_area_id;

  if (values.recipient_postal_code === "") update.recipient_postal_code = null;
  else if (!POSTAL.test(values.recipient_postal_code)) errors.recipient_postal_code = "Kode pos 5 digit.";
  else update.recipient_postal_code = values.recipient_postal_code;

  const bounds: [DraftField, number, number, string][] = [
    ["weight_grams", 1, 50000, "Berat 1–50.000 gram."],
    ["length_cm", 1, 200, "1–200 cm."],
    ["width_cm", 1, 200, "1–200 cm."],
    ["height_cm", 1, 200, "1–200 cm."],
    ["goods_value_idr", 0, 100_000_000, "Nilai barang 0–100.000.000 rupiah, tanpa titik."],
  ];
  for (const [field, min, max, message] of bounds) {
    // Thousand separators ("1.250.000") are accepted for rupiah only; "1.5" cm stays invalid.
    const raw = field === "goods_value_idr" ? values[field].replace(/\./g, "") : values[field];
    const n = int(raw, min, max);
    if (n === "invalid") errors[field] = message;
    else update[field] = n;
  }
  const isCod = values.is_cod === "true" || values.is_cod === "on" || values.is_cod === "1";
  values.is_cod = isCod ? "true" : "false";
  update.is_cod = isCod;
  if (isCod && typeof update.goods_value_idr === "number" && update.goods_value_idr < 1000) {
    errors.goods_value_idr = "Untuk pengiriman COD, nilai barang minimal Rp1.000.";
  }
  Object.assign(errors, parseHandover(values, update, now));
  if (live) Object.assign(errors, liveRecipientErrors(update));
  return { values, update, errors };
}

// T-043: the handover choice. Drop-off carries no pickup data (the database requires it to be
// empty); pickup needs a date and a start hour that `pickupSlotError` accepts at `now` (a client
// hint is never trusted: this runs on the server for every save).
function parseHandover(values: DraftValues, update: DraftUpdate, now: Date): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  const pickup = values.handover === "pickup";
  values.handover = pickup ? "pickup" : "dropoff";
  update.handover = values.handover;
  if (!pickup) {
    for (const field of ["pickup_date", "pickup_slot_hour", "pickup_volume", "pickup_note"] as const) {
      values[field] = "";
      update[field] = null;
    }
    return errors;
  }
  Object.assign(errors, pickupFieldErrors(values, now));
  if (values.pickup_volume === "") values.pickup_volume = DEFAULT_PICKUP_VOLUME;
  if (!isPickupVolume(values.pickup_volume)) errors.pickup_volume = "Pilih perkiraan kendaraan penjemput.";
  if (values.pickup_note.length > 200) errors.pickup_note = "Catatan maksimal 200 karakter.";
  update.pickup_date = values.pickup_date || null;
  update.pickup_slot_hour = /^[0-9]{1,2}$/.test(values.pickup_slot_hour) ? Number(values.pickup_slot_hour) : null;
  update.pickup_volume = values.pickup_volume;
  update.pickup_note = values.pickup_note || null;
  return errors;
}

// Bahasa field errors for a pickup date and start hour at `now`; empty when it can be reserved.
// Shared with the confirmation check, which reads the stored draft.
export function pickupFieldErrors(fields: { pickup_date: string; pickup_slot_hour: string }, now: Date): Partial<Record<DraftField, string>> {
  if (!fields.pickup_date) return { pickup_date: PICKUP_ERROR_TEXT.date_invalid };
  if (!/^[0-9]{1,2}$/.test(fields.pickup_slot_hour)) return { pickup_slot_hour: "Pilih jam jemput." };
  const reason = pickupSlotError(fields.pickup_date, Number(fields.pickup_slot_hour), now);
  if (reason === null) return {};
  return reason === "date_invalid" || reason === "too_far"
    ? { pickup_date: PICKUP_ERROR_TEXT[reason] }
    : { pickup_slot_hour: PICKUP_ERROR_TEXT[reason] };
}

// Partial saves keep the broader draft contract; quoting/confirming a real shipment cannot
// accept recipient data the local create-order adapter is guaranteed to refuse.
export function liveRecipientErrors(update: DraftUpdate): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  if (typeof update.recipient_name === "string" && update.recipient_name.length > LIVE_RECIPIENT_NAME_MAX) {
    errors.recipient_name = friendlyError({ message: "live_recipient_name_invalid" });
  }
  if (typeof update.recipient_address === "string" && update.recipient_address.length > LIVE_RECIPIENT_ADDRESS_MAX) {
    errors.recipient_address = friendlyError({ message: "live_recipient_address_invalid" });
  }
  if (typeof update.recipient_phone === "string" && !providerPhone(update.recipient_phone)) {
    errors.recipient_phone = friendlyError({ message: "live_recipient_phone_invalid" });
  }
  return errors;
}

// Fields the database requires before quoting (mirrors request_quotes' incomplete_draft check).
export const REQUIRED_FOR_QUOTE: DraftField[] = [
  "sender_name", "sender_phone", "recipient_name", "recipient_phone", "recipient_address",
  "recipient_area", "item_description", "weight_grams",
];

// A live (Mengantar) quote also needs the recipient's provider area; COD needs goods_value_idr >= 1000.
export function missingForQuote(update: DraftUpdate, live = false): DraftField[] {
  const missing = REQUIRED_FOR_QUOTE.filter((f) => update[f] == null || update[f] === "");
  if (live && !update.recipient_area_id && !missing.includes("recipient_area")) missing.push("recipient_area");
  if (update.is_cod === true && (typeof update.goods_value_idr !== "number" || update.goods_value_idr < 1000) && !missing.includes("goods_value_idr")) {
    missing.push("goods_value_idr");
  }
  return missing;
}
