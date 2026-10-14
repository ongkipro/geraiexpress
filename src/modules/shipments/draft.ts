// Server-side draft validation (PR-4/PR-5, DATA-2). Pure so it is unit-testable; the database
// constraints remain the final authority.

export const DRAFT_FIELDS = [
  "sender_name", "sender_phone", "recipient_name", "recipient_phone", "recipient_address",
  "recipient_area", "recipient_area_id", "recipient_postal_code", "item_description", "weight_grams", "length_cm",
  "width_cm", "height_cm", "goods_value_idr",
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftValues = Record<DraftField, string>;
export type DraftUpdate = Partial<Record<DraftField, string | number | null>>;

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

export function parseDraft(form: FormData): { values: DraftValues; update: DraftUpdate; errors: Partial<Record<DraftField, string>> } {
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
  return { values, update, errors };
}

// Fields the database requires before quoting (mirrors request_quotes' incomplete_draft check).
export const REQUIRED_FOR_QUOTE: DraftField[] = [
  "sender_name", "sender_phone", "recipient_name", "recipient_phone", "recipient_address",
  "recipient_area", "item_description", "weight_grams",
];

// A live (Mengantar) quote also needs the recipient's provider area.
export function missingForQuote(update: DraftUpdate, live = false): DraftField[] {
  const missing = REQUIRED_FOR_QUOTE.filter((f) => update[f] == null || update[f] === "");
  if (live && !update.recipient_area_id && !missing.includes("recipient_area")) missing.push("recipient_area");
  return missing;
}
