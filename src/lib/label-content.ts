// What the local masked label prints (PR-34, PR-6, DATA-10, UX-9, UI-6), as pure functions so the preview,
// the stored snapshot and the tests share one definition. The printed sender comes from the masking switch
// only: the gerai identity (name, WhatsApp, pickup address) when it is off, the operator-confirmed sender
// when it is on: name, phone and area required, street optional (T-094), pre-filled from the shipment's
// sender (senderFromShipment). The Mengantar pickup name, the outlet name, the customer charge, the private net
// cost and any discount are not inputs here, so they cannot reach the printout (PR-22).
import { courierName } from "./format";
import type { GeraiLogo } from "./gerai-logo";

export type LabelSize = "10x15" | "10x10";

// Physical size of the printed sheet and the @page rule (UI-6): exactly the chosen label, one per page.
export const LABEL_SIZES: Record<LabelSize, { widthMm: number; heightMm: number; label: string }> = {
  "10x15": { widthMm: 100, heightMm: 150, label: "10 × 15 cm (standar)" },
  "10x10": { widthMm: 100, heightMm: 100, label: "10 × 10 cm" },
};
export const DEFAULT_LABEL_SIZE: LabelSize = "10x15";
export const isLabelSize = (value: unknown): value is LabelSize => value === "10x15" || value === "10x10";

// Same bounds as create_label_snapshot (20261104110000_sender_address.sql), which stays authoritative.
// Owner (2026-11-04): structured sender fields with text limits so the printed label stays tidy.
export const SENDER_LIMITS = { nameMin: 2, nameMax: 60, cityMin: 2, cityMax: 40, addressMin: 5, addressMax: 120 } as const;

export type SenderInput = { name: string; phone: string; city: string; address: string };
export type SenderErrors = Partial<Record<keyof SenderInput, string>>;

export const EMPTY_SENDER: SenderInput = { name: "", phone: "", city: "", address: "" };

// A pasted multi-line street prints on tidy lines: whitespace runs become one space (the database does
// the same before checking the limits).
export const tidyAddress = (raw: string) => raw.trim().replace(/\s+/g, " ");

// The masked sender starts from the shipment's own sender (T-094); the operator may still edit it. A
// value longer than the printed limit is kept as typed, so the field error tells the operator to shorten
// it instead of silently cutting a word.
export function senderFromShipment(s: { sender_name: string | null; sender_phone: string | null; sender_address: string | null; sender_area: string | null }): SenderInput {
  return { name: s.sender_name ?? "", phone: s.sender_phone ?? "", city: s.sender_area ?? "", address: s.sender_address ?? "" };
}

// Separators removed, digits with an optional leading +: the shape contact and shipment phones use.
export function cleanSenderPhone(raw: string): string | null {
  const stripped = raw.replace(/[\s().-]/g, "");
  return /^\+?[0-9]{8,15}$/.test(stripped) ? stripped : null;
}

// Field errors for the three operator-entered sender fields, in Bahasa Indonesia, next to each input.
export function senderErrors(input: SenderInput): SenderErrors {
  const errors: SenderErrors = {};
  const name = input.name.trim();
  const city = input.city.trim();
  const phone = input.phone.trim();
  // eslint-disable-next-line no-control-regex
  const control = /[\u0000-\u001f\u007f]/;
  if (!name) errors.name = "Isi nama pengirim.";
  else if (name.length < SENDER_LIMITS.nameMin || name.length > SENDER_LIMITS.nameMax || control.test(name)) {
    errors.name = `Nama pengirim ${SENDER_LIMITS.nameMin}–${SENDER_LIMITS.nameMax} karakter.`;
  }
  if (!phone) errors.phone = "Isi nomor HP pengirim.";
  else if (!cleanSenderPhone(phone)) errors.phone = "Nomor HP pengirim tidak valid. Gunakan 8–15 digit, misalnya 081234567890.";
  if (!city) errors.city = "Isi kecamatan / kota pengirim.";
  else if (city.length < SENDER_LIMITS.cityMin || city.length > SENDER_LIMITS.cityMax || control.test(city)) {
    errors.city = `Kecamatan / kota pengirim ${SENDER_LIMITS.cityMin}–${SENDER_LIMITS.cityMax} karakter.`;
  }
  const address = tidyAddress(input.address ?? "");
  if (address && (address.length < SENDER_LIMITS.addressMin || address.length > SENDER_LIMITS.addressMax || control.test(address))) {
    errors.address = `Alamat pengirim ${SENDER_LIMITS.addressMin}–${SENDER_LIMITS.addressMax} karakter, atau kosongkan.`;
  }
  return errors;
}

// The shipment and tenant facts a label may print. Deliberately no cost, charge, discount or pickup name.
export type LabelFacts = {
  reference: string;
  awb: string;
  courier: string | null;
  service: string | null;
  weightGrams: number | null;
  isCod: boolean;
  codAmountIdr: number | null;
  itemDescription: string | null;
  recipient: { name: string | null; phone: string | null; address: string | null; area: string | null; postalCode: string | null };
  geraiName: string;
  geraiLogo?: GeraiLogo | null;
  geraiWhatsapp: string | null;
  pickupAddress: string | null;
  pickupArea: string | null;
};

export type LabelChoice = { mask: boolean; size: LabelSize; sender: SenderInput };

export type LabelContent = {
  geraiName?: string;
  geraiLogo?: GeraiLogo | null;
  size: LabelSize;
  reference: string;
  awb: string;
  courierLine: string;
  weightGrams: number | null;
  sender: { name: string; phone: string; address: string | null; city: string | null };
  recipient: LabelFacts["recipient"];
  cod: { amountIdr: number | null } | null;
  itemDescription: string | null;
};

const courierLine = (courier: string | null, service: string | null) =>
  [courier ? courierName(courier) : null, service].filter(Boolean).join(" ") || "—";

// The preview of a label that is not stored yet. Never throws: a half-filled masked sender previews what
// has been typed, and printing stays gated by senderErrors and the database.
export function buildLabelContent(facts: LabelFacts, choice: LabelChoice): LabelContent {
  const sender = choice.mask
    ? {
        name: choice.sender.name.trim(),
        phone: cleanSenderPhone(choice.sender.phone.trim()) ?? choice.sender.phone.trim(),
        address: tidyAddress(choice.sender.address ?? "") || null,
        city: choice.sender.city.trim(),
      }
    : { name: facts.geraiName, phone: facts.geraiWhatsapp ?? "", address: facts.pickupAddress, city: facts.pickupArea };
  return {
    // Owner (2026-11-05): parcel branding is independent of masking; the gerai contact stays out
    // of the masked sender block and is not part of this separate logo/name identity.
    geraiName: facts.geraiName,
    geraiLogo: facts.geraiLogo ?? null,
    size: choice.size,
    reference: facts.reference,
    awb: facts.awb,
    courierLine: courierLine(facts.courier, facts.service),
    weightGrams: facts.weightGrams,
    sender,
    recipient: {
      name: facts.recipient.name, phone: facts.recipient.phone, address: facts.recipient.address,
      area: facts.recipient.area, postalCode: facts.recipient.postalCode,
    },
    cod: facts.isCod ? { amountIdr: facts.codAmountIdr } : null,
    itemDescription: facts.itemDescription,
  };
}

// The stored snapshot as the label page reads it (a subset of public.label_snapshots).
export type LabelSnapshot = {
  id: string;
  version: number;
  size: LabelSize;
  mask_sender: boolean;
  printed_sender_name: string;
  printed_sender_phone: string;
  printed_sender_address: string | null;
  printed_sender_city: string | null;
  awb: string;
  shipment_reference: string;
  courier: string | null;
  service: string | null;
  weight_grams: number | null;
  is_cod: boolean;
  cod_amount_idr: number | null;
  item_description: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  recipient_area: string | null;
  recipient_postal_code: string | null;
  created_at: string;
  true_tenant_name?: string;
  gerai_logo?: GeraiLogo | null;
  gerai_logo_revision?: number;
};

export const SNAPSHOT_COLUMNS =
  "id, version, size, mask_sender, printed_sender_name, printed_sender_phone, printed_sender_address, printed_sender_city, awb, shipment_reference, courier, service, weight_grams, is_cod, cod_amount_idr, item_description, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, created_at, true_tenant_name, gerai_logo, gerai_logo_revision";

// The label printed from a stored snapshot: only stored values, never live shipment, tenant or outlet data.
export function contentFromSnapshot(s: LabelSnapshot): LabelContent {
  return {
    geraiName: s.true_tenant_name ?? s.printed_sender_name,
    geraiLogo: s.gerai_logo ?? null,
    size: s.size,
    reference: s.shipment_reference,
    awb: s.awb,
    courierLine: courierLine(s.courier, s.service),
    weightGrams: s.weight_grams,
    sender: { name: s.printed_sender_name, phone: s.printed_sender_phone, address: s.printed_sender_address, city: s.printed_sender_city },
    recipient: { name: s.recipient_name, phone: s.recipient_phone, address: s.recipient_address, area: s.recipient_area, postalCode: s.recipient_postal_code },
    cod: s.is_cod ? { amountIdr: s.cod_amount_idr } : null,
    itemDescription: s.item_description,
  };
}

// True when printing this choice would reuse the stored snapshot (create_label_snapshot returns it
// unchanged): same switch and size and, when masked, the same sender fields.
export function sameChoice(snapshot: LabelSnapshot, choice: LabelChoice): boolean {
  if (snapshot.mask_sender !== choice.mask || snapshot.size !== choice.size) return false;
  if (!choice.mask) return true;
  const phone = cleanSenderPhone(choice.sender.phone.trim());
  return snapshot.printed_sender_name === choice.sender.name.trim()
    && snapshot.printed_sender_city === choice.sender.city.trim()
    && (snapshot.printed_sender_address ?? "") === tidyAddress(choice.sender.address ?? "")
    && phone !== null && snapshot.printed_sender_phone === phone;
}
