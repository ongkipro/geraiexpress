// T-044 / PR-6 / TD-13 / DATA-10: the AWB barcode on the local label is a Code128 symbol that decodes
// back to the exact AWB. The decoder below works from the bar and space runs only, so it proves the
// encoder (including set switching and the checksum) instead of mirroring it. The vectors were produced
// once by an independent encoder (the jsbarcode package, version 3.12.3, used outside the repository) and
// are pinned here, so the pattern table is checked against a second implementation.
import { describe, expect, it } from "vitest";
import {
  CODE128_PATTERNS, CODE128_QUIET_MODULES, CODE128_STOP, code128Bars, code128Width, encodeCode128, encodeCode128B,
} from "../../src/lib/label-code128";

// Decodes a module string ('1' bar, '0' space; quiet zones optional) back to text.
function decode(modules: string): string {
  const runs = [...modules.replace(/^0+|0+$/g, "").matchAll(/0+|1+/g)].map((m) => m[0].length);
  expect((runs.length - 7) % 6, "symbol boundaries").toBe(0);
  const count = (runs.length - 7) / 6;
  const values: number[] = [];
  for (let j = 0; j < count; j++) {
    const pattern = runs.slice(6 * j, 6 * j + 6).join("");
    const value = CODE128_PATTERNS.slice(0, 106).indexOf(pattern);
    expect(value, `symbol ${j} (${pattern}) is a Code128 symbol`).toBeGreaterThanOrEqual(0);
    values.push(value);
  }
  expect(runs.slice(6 * count).join(""), "stop symbol").toBe(CODE128_PATTERNS[CODE128_STOP]);
  const [start, ...rest] = values;
  const check = rest.pop()!;
  expect([103, 104, 105], "start symbol").toContain(start);
  const sum = start + rest.reduce((acc, v, i) => acc + v * (i + 1), 0);
  expect(sum % 103, "check symbol").toBe(check);
  let set: "A" | "B" | "C" = start === 103 ? "A" : start === 104 ? "B" : "C";
  let out = "";
  for (const v of rest) {
    if (v === 99 && set !== "C") set = "C";
    else if (v === 100 && set !== "B") set = "B";
    else if (v === 101 && set !== "A") set = "A";
    else if (set === "C") {
      if (v > 99) throw new Error(`unsupported symbol ${v} in set C`);
      out += String(v).padStart(2, "0");
    } else if (v >= 96) throw new Error(`unsupported function symbol ${v}`);
    else if (set === "A") out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
    else out += String.fromCharCode(v + 32);
  }
  return out;
}

// AWB shapes as couriers print them: all-digit, letter prefix plus digits, with a dash, mixed case.
const AWBS = [
  "JP1234567890", "JD0123456789", "SPXID012345678901", "000123456789", "1234567890123", "CM12345678901",
  "TLJX-0000123456-Zz", "10001234567890", "ABC-1234-XYZ", "a-b-c-d-e-f", "AB1234", "123456", "12345678",
  "A1B2C3D4E5F6", "SC00012345678", "NLIDAP12345678901", "9".repeat(40), "Z".repeat(40),
];

describe("Code128 pattern table", () => {
  it("has 106 symbols and a stop, each 11 modules (13 for stop), starting with a bar, with even bar width", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const widths = [...p].map(Number);
      expect(widths.reduce((a, b) => a + b, 0), `symbol ${i} width`).toBe(i === CODE128_STOP ? 13 : 11);
      expect(widths.length).toBe(i === CODE128_STOP ? 7 : 6);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...widths)).toBeLessThanOrEqual(4);
      const barWidth = widths.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
      expect(barWidth % 2, `symbol ${i} bar parity`).toBe(0);
    });
  });
});

describe("encoder against independent vectors", () => {
  const SET_B: Record<string, string> = {
    JP1234567890: "11010010000101101110001110111011010011100110110011100101100101110011001001110110111001001100111010011101101110111010011001110010110010011101100100100001101100011101011",
    SPXID012345678901: "110100100001101110100011101110110111000101101100010001010110001000100111011001001110011011001110010110010111001100100111011011100100110011101001110110111011101001100111001011001001110110010011100110110001000101100011101011",
    CM12345678901: "1101001000010001000110101110110001001110011011001110010110010111001100100111011011100100110011101001110110111011101001100111001011001001110110010011100110100001001101100011101011",
    "ABC-1234-XYZ": "11010010000101000110001000101100010001000110100110111001001110011011001110010110010111001100100111010011011100111000101101110110100011101100010100001011001100011101011",
    "TLJX-0000123456-Zz": "11010010000110111000101000110111010110111000111000101101001101110010011101100100111011001001110110010011101100100111001101100111001011001011100110010011101101110010011001110100100110111001110110001011011110110111101110101100011101011",
    "a-b-c-d-e-f": "110100100001001011000010011011100100100001101001101110010000101100100110111001000010011010011011100101100100001001101110010110000100110000100101100011101011",
  };
  const SET_C: Record<string, string> = {
    "000123456789": "11010011100110110011001100110110011101101110101110110001000010110011011011110101011110001100011101011",
    "12345678": "1101001110010110011100100010110001110001011011000010100100011101101100011101011",
  };
  const AUTO: Record<string, string> = {
    "000123456789": SET_C["000123456789"],
    JP1234567890: "110100100001011011100011101110110101110111101011001110010001011000111000101101100001010011011110110101000111101100011101011",
    "10001234567890": "1101001110011001000100110110011001011001110010001011000111000101101100001010011011110110100111001101100011101011",
    SPXID012345678901: "11010010000110111010001110111011011100010110110001000101011000100010111011110110011011001110110111010111011000100001011001101101111011001101100110010010001100011101011",
    "123456AB7890": "11010011100101100111001000101100011100010110111010111101010001100010001011000101110111101100001010011011110110111011110101100011101011",
    "ABC-1234-XYZ": "11010010000101000110001000101100010001000110100110111001011101111010110011100100010110001110101111010011011100111000101101110110100011101100010110010000101100011101011",
  };

  it("set B output is bit-identical to the reference encoder", () => {
    for (const [value, bits] of Object.entries(SET_B)) expect(encodeCode128B(value).modules, value).toBe(bits);
  });

  it("digit runs use set C exactly as the reference encoder does", () => {
    for (const [value, bits] of Object.entries(SET_C)) expect(encodeCode128(value).modules, value).toBe(bits);
  });

  it("the reference encoder's own symbols (set switches included) decode to the value", () => {
    for (const [value, bits] of Object.entries({ ...SET_B, ...SET_C, ...AUTO })) expect(decode(bits), value).toBe(value);
  });

  it("the auto encoding is never longer than the reference's and decodes to the value", () => {
    for (const [value, bits] of Object.entries(AUTO)) {
      const mine = encodeCode128(value);
      expect(mine.modules.length, value).toBeLessThanOrEqual(bits.length);
      expect(decode(mine.modules), value).toBe(value);
    }
  });
});

describe("AWB decode round trip (PR-6, TD-13)", () => {
  it("every representative AWB shape decodes to exactly the AWB, bare or with quiet zones", () => {
    for (const awb of AWBS) {
      const code = encodeCode128(awb);
      expect(decode(code.modules), awb).toBe(awb);
      expect(decode(encodeCode128B(awb).modules), `${awb} (set B)`).toBe(awb);
      const quiet = "0".repeat(CODE128_QUIET_MODULES);
      expect(decode(quiet + code.modules + quiet), `${awb} (quiet zones)`).toBe(awb);
      expect(code.symbols.length).toBeLessThanOrEqual(encodeCode128B(awb).symbols.length);
    }
  });

  it("random values over the accepted AWB alphabet and lengths round-trip", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-0123456789";
    let seed = 20261028;
    const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 300; n++) {
      const length = 6 + Math.floor(next() * 35);
      let awb = "";
      for (let i = 0; i < length; i++) awb += alphabet[Math.floor(next() * alphabet.length)];
      expect(decode(encodeCode128(awb).modules), awb).toBe(awb);
    }
  });

  it("all printable ASCII round-trips in set B", () => {
    const all = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    expect(decode(encodeCode128(all).modules)).toBe(all);
  });

  it("an odd digit run keeps the odd digit in set B and still decodes", () => {
    for (const awb of ["X123456789", "123456789", "1234567", "AB12345678C"]) expect(decode(encodeCode128(awb).modules), awb).toBe(awb);
  });

  it("refuses values that cannot be drawn instead of drawing them wrong", () => {
    expect(() => encodeCode128("")).toThrow(/empty/);
    expect(() => encodeCode128("AWB\u00e9123")).toThrow(/printable ASCII/);
    expect(() => encodeCode128("AWB\n123")).toThrow(/printable ASCII/);
    expect(() => encodeCode128B("")).toThrow(/empty/);
  });
});

describe("drawing geometry", () => {
  it("the bars rebuild the module string and the width includes both quiet zones", () => {
    const code = encodeCode128("JP1234567890");
    const rebuilt = Array.from({ length: code.modules.length }, () => "0");
    for (const [x, w] of code128Bars(code)) {
      expect(x).toBeGreaterThanOrEqual(CODE128_QUIET_MODULES);
      for (let i = 0; i < w; i++) rebuilt[x - CODE128_QUIET_MODULES + i] = "1";
    }
    expect(rebuilt.join("")).toBe(code.modules);
    expect(code128Width(code)).toBe(code.modules.length + 2 * CODE128_QUIET_MODULES);
    expect(code.modules.startsWith("1")).toBe(true);
    expect(code.modules.endsWith("11")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// Label content assembly (PR-34, PR-22, DATA-10): the printed sender follows the switch; the Mengantar
// pickup name, the outlet name, the customer charge and the private net cost never reach the printout.
import {
  DEFAULT_LABEL_SIZE, LABEL_SIZES, EMPTY_SENDER, buildLabelContent, cleanSenderPhone, contentFromSnapshot, sameChoice,
  senderErrors, senderFromShipment, SENDER_LIMITS, type LabelChoice, type LabelFacts, type LabelSnapshot,
} from "../../src/lib/label-content";

const PICKUP_NAME = "Pickup Mengantar Rahasia";
const OUTLET_NAME = "Outlet Uji A";
const NET_COST = 13579;
const CHARGE = 24680;

const facts: LabelFacts = {
  reference: "GERA-261028-001", awb: "JP1234567890", courier: "JT", service: "REG", weightGrams: 1500,
  isCod: true, codAmountIdr: 125000, itemDescription: "Buku",
  recipient: { name: "Penerima Uji", phone: "081234567890", address: "Jl. Tujuan Uji No. 9", area: "Kec. Tujuan, Kota Uji", postalCode: "40132" },
  geraiName: "Gerai Uji A", geraiWhatsapp: "081355550000", pickupAddress: "Jl. Pickup Nyata No. 5", pickupArea: "Kec. Pickup, Kota Nyata",
};
// A caller that over-shares: the extra fields must be ignored, not copied.
const overshared = { ...facts, pickupName: PICKUP_NAME, outletName: OUTLET_NAME, netCostIdr: NET_COST, customerChargeIdr: CHARGE, discountBps: 250 } as LabelFacts;
const off: LabelChoice = { mask: false, size: "10x15", sender: EMPTY_SENDER };
const on: LabelChoice = { mask: true, size: "10x10", sender: { name: "  Toko Pelanggan ", phone: "0813-1111-2222", city: " Bandung ", address: "" } };
// T-094: the masked sender may carry a street; a pasted multi-line street is printed on tidy lines.
const onWithAddress: LabelChoice = { ...on, sender: { ...on.sender, address: "  Jl. Pelanggan\n  No. 7 " } };

describe("label content (PR-34)", () => {
  it("masking off prints the gerai name, WhatsApp and pickup address as the sender", () => {
    const c = buildLabelContent(overshared, off);
    expect(c.sender).toEqual({ name: "Gerai Uji A", phone: "081355550000", address: "Jl. Pickup Nyata No. 5", city: "Kec. Pickup, Kota Nyata" });
    expect(c.size).toBe("10x15");
    expect(c.courierLine).toBe("J&T Express REG");
    expect(c.cod).toEqual({ amountIdr: 125000 });
  });

  it("masking on prints exactly the entered sender (street optional) and never the gerai pickup address", () => {
    const c = buildLabelContent(overshared, on);
    expect(c.sender).toEqual({ name: "Toko Pelanggan", phone: "081311112222", address: null, city: "Bandung" });
    expect(c.size).toBe("10x10");
    const withAddress = buildLabelContent(overshared, onWithAddress);
    expect(withAddress.sender).toEqual({ name: "Toko Pelanggan", phone: "081311112222", address: "Jl. Pelanggan No. 7", city: "Bandung" });
    for (const content of [c, withAddress]) {
      const printed = JSON.stringify(content);
      expect(content.geraiName).toBe("Gerai Uji A");
      for (const gerai of ["081355550000", "Jl. Pickup Nyata No. 5", "Kec. Pickup, Kota Nyata"]) expect(printed).not.toContain(gerai);
    }
  });

  it.each(["10x15", "10x10"] as const)("previews masked parcel branding without the gerai contact (%s)", (size) => {
    const logo = { version: 2, mime: "image/png" as const, base64: "iVBORw0KGgo=" };
    for (const geraiLogo of [logo, null]) {
      const content = buildLabelContent({ ...facts, geraiLogo }, { ...onWithAddress, size });
      expect(content).toMatchObject({ geraiName: facts.geraiName, geraiLogo, sender: { name: "Toko Pelanggan", phone: "081311112222", address: "Jl. Pelanggan No. 7", city: "Bandung" } });
      expect(JSON.stringify(content)).not.toContain(facts.geraiWhatsapp);
      expect(JSON.stringify(content)).not.toContain(facts.pickupAddress);
    }
  });

  it("pre-fills the masked sender from the shipment's sender (T-094), keeping long values for validation", () => {
    expect(senderFromShipment({ sender_name: "Budi", sender_phone: "081234567890", sender_address: "Jl. Kenanga No. 3", sender_area: "Kec. Coblong, Bandung" }))
      .toEqual({ name: "Budi", phone: "081234567890", address: "Jl. Kenanga No. 3", city: "Kec. Coblong, Bandung" });
    expect(senderFromShipment({ sender_name: null, sender_phone: null, sender_address: null, sender_area: null })).toEqual(EMPTY_SENDER);
    const long = "y".repeat(SENDER_LIMITS.addressMax + 1);
    expect(senderFromShipment({ sender_name: "Budi", sender_phone: "081234567890", sender_address: long, sender_area: "Bandung" }).address).toBe(long);
  });

  it("never carries the Mengantar pickup name, the outlet name, any cost, charge or discount, with the switch on or off", () => {
    for (const choice of [off, on]) {
      const c = buildLabelContent(overshared, choice);
      const printed = JSON.stringify(c);
      for (const secret of [PICKUP_NAME, OUTLET_NAME, String(NET_COST), String(CHARGE), "discount", "Rahasia"]) expect(printed, secret).not.toContain(secret);
      expect(Object.keys(c).sort()).toEqual(["awb", "cod", "courierLine", "geraiLogo", "geraiName", "itemDescription", "recipient", "reference", "sender", "size", "weightGrams"].sort());
      expect(Object.keys(c.sender).sort()).toEqual(["address", "city", "name", "phone"]);
    }
  });

  it("a non-COD shipment carries no COD instruction and the size defaults to 10x15", () => {
    expect(buildLabelContent({ ...facts, isCod: false, codAmountIdr: null }, off).cod).toBeNull();
    expect(DEFAULT_LABEL_SIZE).toBe("10x15");
    expect(LABEL_SIZES["10x15"]).toMatchObject({ widthMm: 100, heightMm: 150 });
    expect(LABEL_SIZES["10x10"]).toMatchObject({ widthMm: 100, heightMm: 100 });
  });

  it("previews a half-filled masked sender without throwing, and gates printing with field errors", () => {
    expect(buildLabelContent(facts, { mask: true, size: "10x15", sender: { name: "Toko", phone: "", city: "", address: "" } }).sender)
      .toEqual({ name: "Toko", phone: "", address: null, city: "" });
    expect(senderErrors(EMPTY_SENDER)).toEqual({ name: "Isi nama pengirim.", phone: "Isi nomor HP pengirim.", city: "Isi kecamatan / kota pengirim." });
    expect(senderErrors({ name: "Toko Pelanggan", phone: "081311112222", city: "Bandung", address: "" })).toEqual({});
    expect(senderErrors({ name: "Toko Pelanggan", phone: "081311112222", city: "Bandung", address: "Jl. Pelanggan No. 7" })).toEqual({});
    expect(senderErrors({ name: "A", phone: "abc", city: "B", address: "Jl" })).toMatchObject({
      name: expect.stringContaining("2–60"), phone: expect.stringContaining("tidak valid"), city: expect.stringContaining("2–40"),
      address: expect.stringContaining("5–120"),
    });
    // One limit per case, each from a valid baseline, so every client-side limit is checked on its own.
    const valid = { name: "Toko Pelanggan", phone: "081311112222", city: "Bandung", address: "" };
    expect(senderErrors({ ...valid, name: "x".repeat(61) })).toEqual({ name: expect.stringContaining("2–60") });
    expect(senderErrors({ ...valid, city: "y".repeat(41) })).toEqual({ city: expect.stringContaining("2–40") });
    expect(senderErrors({ ...valid, phone: "12345" })).toEqual({ phone: expect.stringContaining("tidak valid") });
    expect(senderErrors({ ...valid, address: "z".repeat(121) })).toEqual({ address: expect.stringContaining("5–120") });
    expect(senderErrors({ name: "Toko", phone: "081311112222", city: "Bandung", address: "Jl. A\u0007 No. 7" })).toHaveProperty("address");
    // Whitespace is collapsed before counting, exactly as the database does.
    expect(senderErrors({ name: "Toko", phone: "081311112222", city: "Bandung", address: `Jl.${" ".repeat(200)}No. 7` })).toEqual({});
    expect(cleanSenderPhone("+62 812-3456-7890")).toBe("+6281234567890");
    expect(cleanSenderPhone("123")).toBeNull();
  });

  it("a stored snapshot renders only its own values, equal to the preview it was created from", () => {
    const snapshot: LabelSnapshot = {
      id: "s1", version: 2, size: "10x10", mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222",
      printed_sender_address: null, printed_sender_city: "Bandung", awb: facts.awb, shipment_reference: facts.reference, courier: "JT", service: "REG",
      weight_grams: 1500, is_cod: true, cod_amount_idr: 125000, item_description: "Buku", recipient_name: "Penerima Uji",
      recipient_phone: "081234567890", recipient_address: "Jl. Tujuan Uji No. 9", recipient_area: "Kec. Tujuan, Kota Uji",
      recipient_postal_code: "40132", created_at: "2026-10-28T03:00:00Z", true_tenant_name: facts.geraiName,
    };
    expect(contentFromSnapshot(snapshot)).toEqual(buildLabelContent(facts, on));
    // Live data changing afterwards (gerai renamed, WhatsApp edited) does not matter to a stored snapshot.
    expect(contentFromSnapshot(snapshot).geraiName).toBe("Gerai Uji A");
    expect(contentFromSnapshot(snapshot)).not.toEqual(buildLabelContent({ ...facts, geraiName: "Nama Baru", geraiWhatsapp: null }, on));
  });

  it("freezes the gerai logo and fallback name independently of later live branding", () => {
    const logo = { version: 2, mime: "image/png" as const, base64: "iVBORw0KGgo=" };
    const snapshot = { ...contentSnapshot(), true_tenant_name: "Gerai Saat Cetak", gerai_logo: logo, gerai_logo_revision: 2 };
    expect(contentFromSnapshot(snapshot)).toMatchObject({ geraiName: "Gerai Saat Cetak", geraiLogo: logo });
    expect(sameChoice(snapshot, off)).toBe(true);
    expect(buildLabelContent({ ...facts, geraiName: "Nama Baru", geraiLogo: null }, off)).toMatchObject({ geraiName: "Nama Baru", geraiLogo: null });
    expect(contentFromSnapshot(snapshot).geraiLogo).toBe(logo);
    expect(contentFromSnapshot({ ...snapshot, gerai_logo: null, gerai_logo_revision: 3 })).toMatchObject({ geraiName: "Gerai Saat Cetak", geraiLogo: null });
    // Owner (2026-11-05): masked parcels show frozen branding too, never the gerai contact.
    const masked = { ...snapshot, mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222", printed_sender_address: null, printed_sender_city: "Bandung" };
    const content = contentFromSnapshot(masked);
    expect(content).toMatchObject({ geraiName: "Gerai Saat Cetak", geraiLogo: logo, sender: { name: "Toko Pelanggan", phone: "081311112222", address: null, city: "Bandung" } });
    expect(JSON.stringify(content)).not.toContain(facts.geraiWhatsapp);
    expect(sameChoice(masked, { ...off, mask: true, sender: { name: "Toko Pelanggan", phone: "081311112222", address: "", city: "Bandung" } })).toBe(true);
    expect(contentFromSnapshot({ ...masked, gerai_logo: null, gerai_logo_revision: 3 })).toMatchObject({ geraiName: "Gerai Saat Cetak", geraiLogo: null });
  });

  it("the same choice reuses the stored snapshot; a changed switch, size or sender field does not", () => {
    // A masked snapshot stores only what was printed: no street here (contentSnapshot() is the unmasked one).
    const stored = { ...contentSnapshot(), mask_sender: true, size: "10x10" as const, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222", printed_sender_city: "Bandung", printed_sender_address: null };
    expect(sameChoice(stored, on)).toBe(true);
    expect(sameChoice(stored, { ...on, size: "10x15" })).toBe(false);
    expect(sameChoice(stored, { ...on, mask: false })).toBe(false);
    expect(sameChoice(stored, { ...on, sender: { ...on.sender, city: "Cimahi" } })).toBe(false);
    expect(sameChoice(stored, { ...on, sender: { ...on.sender, phone: "abc" } })).toBe(false);
    // T-094: the street is part of the choice; an equal street after whitespace tidying reuses the snapshot.
    expect(sameChoice(stored, onWithAddress)).toBe(false);
    const storedWithAddress = { ...stored, printed_sender_address: "Jl. Pelanggan No. 7" };
    expect(sameChoice(storedWithAddress, onWithAddress)).toBe(true);
    expect(sameChoice(storedWithAddress, on)).toBe(false);
    const ungated = { ...stored, mask_sender: false, size: "10x15" as const };
    expect(sameChoice(ungated, { mask: false, size: "10x15", sender: { name: "ignored", phone: "", city: "", address: "ignored" } })).toBe(true);
  });
});

function contentSnapshot(): LabelSnapshot {
  return {
    id: "s0", version: 1, size: "10x15", mask_sender: false, printed_sender_name: "Gerai Uji A", printed_sender_phone: "081355550000",
    printed_sender_address: "Jl. Pickup Nyata No. 5", printed_sender_city: "Kec. Pickup, Kota Nyata", awb: "JP1234567890",
    shipment_reference: "GERA-261028-001", courier: "JT", service: "REG", weight_grams: 1500, is_cod: false, cod_amount_idr: null,
    item_description: null, recipient_name: null, recipient_phone: null, recipient_address: null, recipient_area: null,
    recipient_postal_code: null, created_at: "2026-10-28T03:00:00Z",
  };
}

// ---------------------------------------------------------------------------------------------------
// No provider call from the label path (DEC-017, PR-34): neither a Mengantar client, a label-generation
// request nor a dropshipper mapping is reachable from the files that build, store and print the label.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("the label path makes no provider request (DEC-017)", () => {
  const labelFiles = [
    ...filesUnder("src/modules/labels"),
    ...filesUnder("src/components/label"),
    ...filesUnder("src/app/(workspace)/pengiriman/[id]/label"),
    "src/lib/label-code128.ts",
    "src/lib/label-content.ts",
  ];

  it("imports no Mengantar client, issues no network request and mentions no label-generation or dropshipper call", () => {
    expect(labelFiles.length).toBeGreaterThan(6);
    for (const file of labelFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*mengantar[^"']*["']/i);
      expect(source, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/);
      expect(source, file).not.toMatch(/label-generation|labelGeneration|dropship|createOrder|tenantMengantar/i);
    }
  });

  it("the database commands for the label contain no provider operation", () => {
    const sqlSource = readFileSync("db/migrations/20261028150000_masked_label.sql", "utf8");
    expect(sqlSource).not.toMatch(/provider_operations|dispatch_|seller_credentials|label_jobs/);
  });
});
