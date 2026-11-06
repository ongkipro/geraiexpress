import { describe, expect, expectTypeOf, it } from "vitest";
import { courierTrackingUrl, publicTracking, type PublicTracking } from "../../src/modules/tracking/projection";

const safeTracking: PublicTracking = {
  gerai_label: null, courier: "JT", service: "REG", awb: "JP1234567890", status_label: "Status belum tersedia",
  timeline: [], destination_city: "Kota Uji", sender_initials: null, recipient_initials: "P. U.",
  created_at: "2026-11-05T04:00:00Z", issued_at: "2026-11-05T04:00:00Z",
};

it("the projection TYPE has no full identity, phone, address, amount, item or raw provider field", () => {
  type Forbidden = "name" | "sender_name" | "recipient_name" | "phone" | "sender_phone" | "recipient_phone"
    | "address" | "sender_address" | "recipient_address" | "amount" | "cod_amount_idr" | "goods_value_idr"
    | "customer_charge_idr" | "item_description" | "detail" | "pickup_snapshot" | "tenant_id" | "shipment_id";
  expectTypeOf<Extract<keyof PublicTracking, Forbidden>>().toEqualTypeOf<never>();
  expectTypeOf<keyof PublicTracking>().toEqualTypeOf<
    "gerai_label" | "courier" | "service" | "awb" | "status_label" | "timeline" | "destination_city"
    | "sender_initials" | "recipient_initials" | "created_at" | "issued_at"
  >();
});

describe("public projection allowlist", () => {
  it("reconstructs exactly the permitted object, discarding extra fields", () => {
    const result = publicTracking({ ...safeTracking, sender_name: "Pengirim Rahasia", phone: "081234567890", address: "Jl. Rahasia", amount: 9999, item: "Rahasia" });
    expect(result).toEqual(safeTracking);
    expect(Object.keys(result!)).toEqual(Object.keys(safeTracking));
    expect(JSON.stringify(result)).not.toMatch(/Rahasia|081234567890|9999|sender_name|phone|address|amount|item/);
  });
  it("fails closed on missing fields, a provider event payload, or an invented status", () => {
    const at = "2026-11-06T04:00:00Z";
    for (const value of [null, {}, { ...safeTracking, timeline: [{ detail: "raw secret" }] },
      // T-045: only whitelisted labels and kinds, and nothing but {kind, at} per entry.
      { ...safeTracking, status_label: "Sedang diproses di hub Jakarta" },
      { ...safeTracking, timeline: [{ kind: "ON DELIVERY", at }] },
      { ...safeTracking, timeline: [{ kind: "in_transit", at, hub_city: "Jakarta" }] },
      { ...safeTracking, timeline: [{ kind: "in_transit", at: "yesterday" }] },
      { ...safeTracking, timeline: Array.from({ length: 51 }, () => ({ kind: "in_transit", at })) },
      { ...safeTracking, awb: "<script>" }]) expect(publicTracking(value)).toBeNull();
  });
  it("carries a real status and a kind-and-time timeline (T-045)", () => {
    const at = "2026-11-06T04:00:00Z";
    const result = publicTracking({ ...safeTracking, status_label: "Dalam perjalanan", timeline: [{ kind: "awaiting_pickup", at }, { kind: "in_transit", at }] });
    expect(result?.status_label).toBe("Dalam perjalanan");
    expect(result?.timeline).toEqual([{ kind: "awaiting_pickup", at }, { kind: "in_transit", at }]);
  });
  it("returns full AWB as required by UX-18, but puts no AWB in a courier URL", () => {
    expect(publicTracking(safeTracking)?.awb).toBe("JP1234567890");
    for (const code of ["JT", "JNE", "SiCepat", null, "unknown"]) {
      const url = courierTrackingUrl(code);
      if (url) { expect(url).toMatch(/^https:\/\//); expect(url).not.toContain(safeTracking.awb); }
    }
    expect(courierTrackingUrl("unknown")).toBeNull();
  });
});
