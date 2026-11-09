// T-043 / PR-5 / TD-12: pickup orders with a provider time reservation. Fixtures are built from the
// provider documentation (operations contract section 2), NOT from a sandbox capture: every shape
// asserted here is Unverified until the supervised sandbox pickup (T-048).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { dispatchOperation, reconcileOperation, type Rpc } from "../../src/lib/mengantar/dispatcher";
import {
  PICKUP_ERROR_TEXT, PICKUP_LEAD_MINUTES, pickupDates, pickupSlotError, providerTimeFields, slotLabel, slotStartMs, wibDate,
} from "../../src/lib/mengantar/pickup";
import { cutoffLabel, PICKUP_CUTOFF_SOURCE, PICKUP_CUTOFFS, pickupCutoffWarning } from "../../src/lib/mengantar/pickup-cutoffs";
import { createMengantarPublicClient, InvalidOrderRequest, MengantarError } from "../../src/lib/mengantar/public-api";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8"));

const SEAL_KEY = Buffer.alloc(32, 9).toString("base64");
const SELLER_KEY = "API-UNITTESTKEY0001";
const TENANT = "00000000-0000-4000-b000-0000000000d1";
const REF = "GX261014-ABC123";
const ADDRESS = "6acf44a4771fe2b474c055ca";
const TIME_ID = "6b0c2a1e9d3f4a5b6c7d8e90";
// The slot of the documentation-derived fixtures: 2026-02-03 at 13:00 WIB.
const DATE = "2026-02-03";
const HOUR = 13;
const NOW = new Date("2026-02-02T03:00:00Z"); // 10:00 WIB the day before: plenty of lead time

describe("per-courier same-day pickup cut-offs (Mengantar help article, verified 2026-11-09)", () => {
  // WIB wall clock on 2026-02-03 as an instant.
  const at = (hh: number, mm: number, ss = 0) => new Date(Date.UTC(2026, 1, 3, hh - 7, mm, ss));
  const TODAY = "2026-02-03";
  const VERIFIED: [string, string, number][] = [
    ["JNE", "JNE", 15], ["SiCepat", "SiCepat", 12], ["Sap", "SAP Express", 15], ["iDexpress", "ID Express", 11], ["JT", "J&T Express", 12],
    ["lion", "Lion Parcel", 15], ["anteraja", "AnterAja", 15], ["pos", "Pos Indonesia", 16], ["spx", "SPX Express", 15],
  ];

  it("records the source and the date it was verified", () => {
    expect(PICKUP_CUTOFF_SOURCE.url).toBe("https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx");
    expect(PICKUP_CUTOFF_SOURCE.verifiedOn).toBe("2026-11-09");
  });

  it.each(VERIFIED)("%s (%s): cut-off %i.00 WIB, warns from the cut-off minute and not before", (code, name, hour) => {
    expect(PICKUP_CUTOFFS[code]).toMatchObject({ hour, minute: 0 });
    expect(cutoffLabel(PICKUP_CUTOFFS[code])).toBe(`${String(hour).padStart(2, "0")}.00`);
    expect(pickupCutoffWarning(code, TODAY, at(hour - 1, 59, 59))).toBeNull();
    const warning = pickupCutoffWarning(code, TODAY, at(hour, 0));
    expect(warning).toBe(`Kurir ${name} menjemput di hari yang sama untuk pesanan yang diinput sebelum ${String(hour).padStart(2, "0")}.00 WIB. Pesanan ini kemungkinan dijemput besok.`);
    expect(pickupCutoffWarning(code, TODAY, at(hour, 1))).toBe(warning);
  });

  it("lists exactly the nine verified couriers, with only AnterAja marked pickup-only", () => {
    expect(Object.keys(PICKUP_CUTOFFS).sort()).toEqual(VERIFIED.map(([c]) => c).sort());
    expect(Object.entries(PICKUP_CUTOFFS).filter(([, c]) => c.pickupOnly).map(([k]) => k)).toEqual(["anteraja"]);
  });

  it("gives no warning for an unknown courier, a missing courier or an inherited property name", () => {
    for (const code of ["UNKNOWN", "", null, undefined, "toString", "constructor"]) expect(pickupCutoffWarning(code, TODAY, at(23, 0))).toBeNull();
  });

  it("gives no warning for a slot on a later or earlier date than today (WIB)", () => {
    expect(pickupCutoffWarning("JNE", "2026-02-04", at(23, 59))).toBeNull();
    expect(pickupCutoffWarning("JNE", "2026-02-02", at(23, 59))).toBeNull();
  });

  it("decides 'today' and the minute in WIB: 17:30 UTC is already the next WIB day", () => {
    const lateUtc = new Date("2026-02-02T17:30:00Z"); // 00:30 WIB on the 3rd: before every cut-off
    expect(pickupCutoffWarning("JNE", "2026-02-03", lateUtc)).toBeNull();
    expect(pickupCutoffWarning("JNE", "2026-02-02", lateUtc)).toBeNull();
    expect(pickupCutoffWarning("JNE", "2026-02-02", new Date("2026-02-02T08:00:00Z"))).not.toBeNull(); // 15:00 WIB on the 2nd
  });
});

describe("pickup rules (documented: start hours 9:00-18:00; lead time: documented 90 minutes, web UI 2 hours)", () => {
  it("the minimum lead time defaults to 120 minutes (the web UI's 2 hours, stricter than the API's 90)", () => {
    expect(PICKUP_LEAD_MINUTES).toBe(120);
    expect(PICKUP_ERROR_TEXT.too_soon).toContain("minimal 120 menit");
    const start = slotStartMs("2026-02-03", 9)!;
    // 119 minutes ahead is refused (it would have passed under the old 90); 120 is accepted.
    expect(pickupSlotError("2026-02-03", 9, new Date(start - 119 * 60_000))).toBe("too_soon");
    expect(pickupSlotError("2026-02-03", 9, new Date(start - 120 * 60_000))).toBeNull();
  });

  it("accepts a slot exactly at the lead time and refuses one millisecond less", () => {
    const start = slotStartMs("2026-02-03", 9)!;
    expect(pickupSlotError("2026-02-03", 9, new Date(start - PICKUP_LEAD_MINUTES * 60_000))).toBeNull();
    expect(pickupSlotError("2026-02-03", 9, new Date(start - PICKUP_LEAD_MINUTES * 60_000 + 1))).toBe("too_soon");
  });

  it("refuses a past slot, hours outside 9-18, impossible dates and dates too far ahead", () => {
    expect(pickupSlotError("2026-02-01", 10, NOW)).toBe("too_soon");
    expect(pickupSlotError("2026-02-03", 8, NOW)).toBe("slot_invalid");
    expect(pickupSlotError("2026-02-03", 19, NOW)).toBe("slot_invalid");
    expect(pickupSlotError("2026-02-03", 9.5, NOW)).toBe("slot_invalid");
    expect(pickupSlotError("2026-02-30", 10, NOW)).toBe("date_invalid");
    expect(pickupSlotError("03-02-2026", 10, NOW)).toBe("date_invalid");
    expect(pickupSlotError("2026-03-30", 10, NOW)).toBe("too_far");
    // The 9:00 and 18:00 documented values are both reservable.
    expect(pickupSlotError("2026-02-03", 18, NOW)).toBeNull();
    expect(pickupSlotError("2026-02-03", 9, NOW)).toBeNull();
  });

  it("measures the clock in WIB: 17:30 UTC is already the next day", () => {
    expect(wibDate(new Date("2026-02-02T17:30:00Z"))).toBe("2026-02-03");
    expect(pickupDates(new Date("2026-02-02T17:30:00Z"))[0]).toBe("2026-02-03");
    expect(slotStartMs("2026-02-03", 9)).toBe(Date.parse("2026-02-03T02:00:00Z"));
  });

  it("formats POST /time fields as documented (mm-dd-yyyy, h:00) and rejects the rest", () => {
    expect(providerTimeFields("2026-02-03", 9)).toEqual({ date: "02-03-2026", time: "9:00" });
    expect(providerTimeFields("2026-11-27", 18)).toEqual({ date: "11-27-2026", time: "18:00" });
    expect(providerTimeFields("2026-02-03", 8)).toBeNull();
    expect(providerTimeFields("2026-13-01", 10)).toBeNull();
    expect(slotLabel(9)).toBe("09.00–10.00 WIB");
  });
});

function jsonReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const client = (fetchImpl: typeof fetch) => createMengantarPublicClient("sandbox", SELLER_KEY, fetchImpl);

describe("Mengantar client: POST /time and GET /time (documentation-derived shapes)", () => {
  it("reserves a slot with the documented body and returns the time id", async () => {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body)) });
      return jsonReply(fixture("pickup-time-post-success.json"));
    }) as unknown as typeof fetch;
    expect(await client(impl).reservePickupTime({ addressId: ADDRESS, date: DATE, hour: HOUR })).toEqual({ timeId: TIME_ID });
    expect(seen).toEqual([{ url: `https://sandbox.mengantar.com/api/public/${SELLER_KEY}/time`, method: "POST", body: { address_id: ADDRESS, date: "02-03-2026", time: "13:00" } }]);
  });

  it("treats the documented refusal as a definite 'rejected' and 403 as 'not_allowed'", async () => {
    const refused = (async () => jsonReply(fixture("pickup-time-post-refused.json"), 400)) as unknown as typeof fetch;
    await expect(client(refused).reservePickupTime({ addressId: ADDRESS, date: DATE, hour: HOUR }))
      .rejects.toMatchObject({ code: "rejected", providerMessage: "invalid pickup time" });
    const denied = (async () => jsonReply({ success: false }, 403)) as unknown as typeof fetch;
    await expect(client(denied).reservePickupTime({ addressId: ADDRESS, date: DATE, hour: HOUR })).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("calls any other failure an unknown outcome: timeout, 5xx, odd status, an answer for another slot or address", async () => {
    const post = { addressId: ADDRESS, date: DATE, hour: HOUR };
    const wrongSlot = fixture("pickup-time-post-success.json"); wrongSlot.data.time = "14:00";
    const wrongDate = fixture("pickup-time-post-success.json"); wrongDate.data.date = "2026-02-04T00:00:00.000Z";
    const wrongAddress = fixture("pickup-time-post-success.json"); wrongAddress.data.address._id = "5fc62f60f8f44b34aa4c0dcd";
    const noId = fixture("pickup-time-post-success.json"); delete noId.data._id;
    const cases: (() => Response)[] = [
      () => new Response("gateway", { status: 504 }),
      () => { throw new TypeError("network"); },
      () => jsonReply({ success: true, data: {} }, 202),
      () => jsonReply({ success: false, message: "x" }, 409),
      () => jsonReply(wrongSlot), () => jsonReply(wrongDate), () => jsonReply(wrongAddress), () => jsonReply(noId),
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    ];
    for (const reply of cases) {
      await expect(client((async () => reply()) as unknown as typeof fetch).reservePickupTime(post)).rejects.toMatchObject({ code: "unknown_outcome" });
    }
  });

  it("refuses invalid input locally, before any request", async () => {
    let called = false;
    const impl = (async () => { called = true; return jsonReply({}); }) as unknown as typeof fetch;
    for (const bad of [{ addressId: "x", date: DATE, hour: HOUR }, { addressId: ADDRESS, date: DATE, hour: 20 }, { addressId: ADDRESS, date: "nope", hour: HOUR }]) {
      await expect(client(impl).reservePickupTime(bad)).rejects.toBeInstanceOf(InvalidOrderRequest);
    }
    expect(called).toBe(false);
  });

  it("lists the seller's time records, each with ONE date (UTC clock shape or real WIB instant, never both)", async () => {
    const impl = (async () => jsonReply(fixture("pickup-time-get-list.json"))) as unknown as typeof fetch;
    const rows = await client(impl).listPickupTimes();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ id: TIME_ID, hour: 13, date: DATE, addressId: null });
    expect(rows[1]).toMatchObject({ hour: 12, date: "2023-02-24" });
    // Rows that do not parse are dropped, never guessed.
    const odd = (async () => jsonReply({ success: true, data: [{ _id: "x", date: 1, time: "12:00" }, { _id: TIME_ID, date: "bad", time: "13:00" }, { _id: TIME_ID, date: 1770123600000, time: "7:00" }, null] })) as unknown as typeof fetch;
    expect(await client(odd).listPickupTimes()).toEqual([]);
    // Strict (the reservation read-back): any unparseable row makes the whole list malformed.
    await expect(client(odd).listPickupTimes({ strict: true })).rejects.toMatchObject({ code: "malformed" });
    expect(await client(impl).listPickupTimes({ strict: true })).toHaveLength(3);
    const notList = (async () => jsonReply({ success: true, data: {} })) as unknown as typeof fetch;
    await expect(client(notList).listPickupTimes()).rejects.toBeInstanceOf(MengantarError);
  });

  it("sends scheduledPickup with the reserved time id and the volume class", async () => {
    let body: Record<string, unknown> = {};
    const issued = fixture("order-create-jt-issued.json");
    issued.data[0].destinationMark = REF;
    const impl = (async (_url: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return jsonReply(issued); }) as unknown as typeof fetch;
    const base = {
      courier: "JT", pickupAddressId: ADDRESS, reference: REF, quantity: 1, weightGrams: 1000, parcelContent: "Dokumen", goodsValue: 50000,
      recipient: { areaId: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "Penerima", phone: "081234567890" },
    };
    await client(impl).createOrder({ ...base, pickup: { timeId: TIME_ID, volume: "volumeMotor" } });
    expect(body.pickup).toEqual({ address_id: ADDRESS, type: "scheduledPickup", time_id: TIME_ID, volume: "volumeMotor" });
    await client(impl).createOrder(base);
    expect(body.pickup).toEqual({ address_id: ADDRESS, type: "dropOff" });
    // A malformed time id or volume never leaves the process.
    await expect(client(impl).createOrder({ ...base, pickup: { timeId: "x", volume: "volumeMotor" } })).rejects.toBeInstanceOf(InvalidOrderRequest);
    await expect(client(impl).createOrder({ ...base, pickup: { timeId: TIME_ID, volume: "volumeBus" as never } })).rejects.toBeInstanceOf(InvalidOrderRequest);
  });
});

// ---- dispatcher scenarios --------------------------------------------------------------------

async function pickupPayload(overrides: Record<string, unknown> = {}) {
  const sealed = await sealCredential(SELLER_KEY, credentialAad(TENANT, 2), SEAL_KEY);
  return {
    operation_id: "op-1", tenant_id: TENANT, attempt: 3, provider_env: "sandbox", dispatched_at: "2026-02-02T03:00:00Z",
    operation_state: "in_flight", reference: REF, courier: "JT", pickup_address_id: ADDRESS, pickup_area_id: "5fc62f60f8f44b34aa4c0dcd",
    handover: "pickup", pickup_date: DATE, pickup_slot_hour: HOUR, pickup_volume: "volumeMotor", pickup_phase: null, pickup_time_id: null,
    recipient: { area_id: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "Penerima", phone: "+6281234567890" },
    weight_grams: 1000, item_description: "Dokumen", goods_value_idr: 50000,
    credential: { ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 2 },
    ...overrides,
  };
}

type Reply = () => Response;
type Replies = Partial<Record<"getTime" | "postTime" | "postOrder" | "getOrder", Reply>>;

// One timeline of database commands and provider requests, in the order they happened, so a test can
// prove a write-ahead state precedes the request it guards.
function scenario(claim: unknown, replies: Replies = {}, rpcErrors: Record<string, string> = {}, knownIds: string[] = []) {
  const timeline: string[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args) => {
    timeline.push(`rpc:${fn}`);
    rpcCalls.push({ fn, args });
    if (rpcErrors[fn]) return { data: null, error: { message: rpcErrors[fn] } };
    if (fn === "dispatch_claim" || fn === "dispatch_begin_reconcile") return { data: claim, error: null };
    if (fn === "dispatch_pickup_known_time_ids") return { data: knownIds, error: null };
    return { data: { state: "ok", replayed: false, price_mismatch: false }, error: null };
  };
  const issued = fixture("order-create-jt-issued.json");
  issued.data[0].destinationMark = REF;
  const defaults: Record<keyof Replies, Reply> = {
    getTime: () => jsonReply({ success: true, data: [] }),
    postTime: () => jsonReply(fixture("pickup-time-post-success.json")),
    postOrder: () => jsonReply(issued),
    getOrder: () => jsonReply({ success: true, data: [] }),
  };
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(`/api/public/${SELLER_KEY}`, "");
    const method = init?.method ?? "GET";
    if (path === "/address") return jsonReply(fixture("address-list-sandbox.json"));
    const key = path === "/time" ? (method === "POST" ? "postTime" : "getTime") : method === "POST" ? "postOrder" : "getOrder";
    timeline.push(`http:${method} ${path}`);
    if (method === "POST") bodies[key] = JSON.parse(String(init?.body));
    return (replies[key] ?? defaults[key])();
  }) as typeof fetch;
  const bodies: Record<string, unknown> = {};
  const deps = { rpc, environment: "sandbox" as const, credentialKey: SEAL_KEY, fetchImpl: impl, now: () => NOW };
  const count = (entry: string) => timeline.filter((t) => t === entry).length;
  const recorded = () => rpcCalls.filter((c) => c.fn === "dispatch_record").map((c) => c.args);
  const rpcArgs = (fn: string) => rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);
  return { deps, timeline, count, recorded, rpcArgs, bodies };
}

const OK_ISSUED = { p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ", p_price: 93000, p_batch_id: "6acf44c1771fe2b474c05676" };

describe("dispatchOperation: pickup with time reservation (TD-12)", () => {
  it("reads GET /time, reserves once, then creates the order with the reserved time id, each write-ahead first", async () => {
    const s = scenario(await pickupPayload());
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "issued" });
    expect(s.timeline).toEqual([
      "rpc:dispatch_claim",
      "http:GET /time", // read-only availability / reachability check
      "rpc:dispatch_pickup_known_time_ids", // ids the tenant's other operations hold (T-056)
      "rpc:dispatch_pickup_begin_reservation", // write-ahead for POST /time
      "http:POST /time",
      "rpc:dispatch_pickup_record_reservation",
      "rpc:dispatch_pickup_begin_create", // write-ahead for POST /order
      "http:POST /order",
      "rpc:dispatch_record",
    ]);
    expect(s.bodies.postTime).toEqual({ address_id: ADDRESS, date: "02-03-2026", time: "13:00" });
    expect(s.rpcArgs("dispatch_pickup_record_reservation")).toEqual([{ p_operation: "op-1", p_attempt: 3, p_time_id: TIME_ID }]);
    expect((s.bodies.postOrder as { pickup: unknown }).pickup).toEqual({ address_id: ADDRESS, type: "scheduledPickup", time_id: TIME_ID, volume: "volumeMotor" });
    expect(s.recorded()).toEqual([OK_ISSUED]);
  });

  it("leaves drop-off untouched: no /time call and the dropOff body", async () => {
    const s = scenario(await pickupPayload({ handover: "dropoff", pickup_date: null, pickup_slot_hour: null, pickup_volume: null }));
    await dispatchOperation("op-1", s.deps);
    expect(s.timeline.filter((t) => t.includes("/time") || t.includes("pickup_"))).toEqual([]);
    expect((s.bodies.postOrder as { pickup: unknown }).pickup).toEqual({ address_id: ADDRESS, type: "dropOff" });
    // A payload from before pickup existed (no handover key at all) is drop-off too.
    const old = await pickupPayload();
    for (const key of ["handover", "pickup_date", "pickup_slot_hour", "pickup_volume", "pickup_phase", "pickup_time_id", "operation_state"]) delete (old as Record<string, unknown>)[key];
    const s2 = scenario(old);
    await dispatchOperation("op-1", s2.deps);
    expect(s2.count("http:POST /time")).toBe(0);
    expect((s2.bodies.postOrder as { pickup: { type: string } }).pickup.type).toBe("dropOff");
  });

  it("a refused slot stops for renewed review: no order, no second reservation, no create write-ahead", async () => {
    const s = scenario(await pickupPayload(), { postTime: () => jsonReply(fixture("pickup-time-post-refused.json"), 400) });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "rejected" });
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "PICKUP_TIME_INVALID", p_detail: "invalid pickup time" }]);
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(0);
    expect(s.rpcArgs("dispatch_pickup_begin_create")).toEqual([]);

    // Slot unavailable (another plain refusal): its own code, still no order.
    const other = scenario(await pickupPayload(), { postTime: () => jsonReply({ success: false, message: "Slot penuh" }, 400) });
    await dispatchOperation("op-1", other.deps);
    expect(other.recorded()[0]).toMatchObject({ p_outcome: "rejected", p_code: "PICKUP_SLOT_UNAVAILABLE", p_detail: "Slot penuh" });
    expect(other.count("http:POST /order")).toBe(0);

    const denied = scenario(await pickupPayload(), { postTime: () => jsonReply({ success: false }, 403) });
    await dispatchOperation("op-1", denied.deps);
    expect(denied.recorded()[0]).toMatchObject({ p_outcome: "rejected", p_code: "NOT_ALLOWED" });
  });

  it("a lost reservation answer is recorded as unknown; nothing is resent and no order is created", async () => {
    for (const lost of [() => new Response("gateway timeout", { status: 504 }), () => { throw new TypeError("network down"); }, () => jsonReply({ success: true, data: { _id: "6b0c2a1e9d3f4a5b6c7d8e99", date: "2026-02-04T00:00:00.000Z", time: "13:00" } })]) {
      const s = scenario(await pickupPayload(), { postTime: lost });
      expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "unknown" });
      expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "PICKUP_RESERVATION_UNKNOWN" }]);
      expect(s.count("http:POST /time")).toBe(1);
      expect(s.count("http:POST /order")).toBe(0);
      expect(s.rpcArgs("dispatch_pickup_record_reservation")).toEqual([]);
      expect(s.rpcArgs("dispatch_release")).toEqual([]); // a started reservation is never released
    }
  });

  it("never adopts a returned time id another operation of the tenant holds: Unknown, no order, nothing resent (T-056)", async () => {
    const s = scenario(await pickupPayload(), {}, {}, [TIME_ID]);
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "unknown" });
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "PICKUP_TIME_ID_HELD" }]);
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(0);
    expect(s.rpcArgs("dispatch_pickup_record_reservation")).toEqual([]);
    expect(s.rpcArgs("dispatch_pickup_known_time_ids")).toEqual([{ p_operation: "op-1" }]);
  });

  it("sends no reservation when the held ids cannot be read: the claim is released (T-056)", async () => {
    const s = scenario(await pickupPayload(), {}, { dispatch_pickup_known_time_ids: "not_found" });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "not_claimed", reason: "pickup_known_ids_unavailable" });
    expect(s.rpcArgs("dispatch_pickup_begin_reservation")).toEqual([]);
    expect(s.count("http:POST /time")).toBe(0);
    expect(s.rpcArgs("dispatch_release")).toHaveLength(1);
  });

  it("an answer that cannot be stored leaves the operation in flight for read-back, with no order", async () => {
    const s = scenario(await pickupPayload(), {}, { dispatch_pickup_record_reservation: "stale_attempt" });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "record_failed", outcome: "reserved" });
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(0);
    expect(s.rpcArgs("dispatch_release")).toEqual([]);
  });

  it("sends no reservation when the write-ahead cannot be stored, or when GET /time fails: the claim is released", async () => {
    const noMark = scenario(await pickupPayload(), {}, { dispatch_pickup_begin_reservation: "reservation_already_started" });
    expect(await dispatchOperation("op-1", noMark.deps)).toEqual({ status: "not_claimed", reason: "pickup_reservation_not_recorded" });
    expect(noMark.count("http:POST /time")).toBe(0);
    expect(noMark.rpcArgs("dispatch_release")).toHaveLength(1);

    const down = scenario(await pickupPayload(), { getTime: () => new Response("down", { status: 503 }) });
    expect(await dispatchOperation("op-1", down.deps)).toEqual({ status: "not_claimed", reason: "mengantar_unavailable" });
    expect(down.rpcArgs("dispatch_pickup_begin_reservation")).toEqual([]);
    expect(down.count("http:POST /time")).toBe(0);
    expect(down.rpcArgs("dispatch_release")).toHaveLength(1);
  });

  it("a GET /time body over the size cap still proves the account answers: the reservation goes ahead", async () => {
    const huge = () => new Response(`{"success":true,"data":[${'{"_id":"6b0c2a1e9d3f4a5b6c7d8e90","date":1,"time":"9:00"},'.repeat(6000)}null]}`, { status: 200, headers: { "content-type": "application/json" } });
    const s = scenario(await pickupPayload(), { getTime: huge });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "issued" });
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(1);
  });

  it("sends no order when its write-ahead cannot be stored: the recorded reservation is kept, the claim released", async () => {
    const s = scenario(await pickupPayload(), {}, { dispatch_pickup_begin_create: "create_already_started" });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "not_claimed", reason: "pickup_create_not_recorded" });
    expect(s.count("http:POST /order")).toBe(0);
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.rpcArgs("dispatch_release")).toHaveLength(1);
  });

  it("a lost create answer after a reservation is recorded as unknown: one reservation, one order, then reconciliation", async () => {
    const s = scenario(await pickupPayload(), { postOrder: () => new Response("gateway timeout", { status: 504 }) });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "unknown" });
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(1);
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "UNKNOWN_OUTCOME" }]);
    expect(s.rpcArgs("dispatch_release")).toEqual([]);

    // Reconciliation of that operation (create began): the order is found by its reference; nothing is POSTed.
    const created = { ORDER_ID: "261014LKLL3E", batch: "26101416OJ04NF", batch_id: "6acf44c1771fe2b474c05676", destinationMark: REF, status: "active", isPaid: true, cnote_no: "JO6948371799", estimatedPrice: 93000, createdAt: "2026-02-02T03:00:30Z" };
    let page = 0;
    const r = scenario(await pickupPayload({ operation_state: "unknown", pickup_phase: "creating", pickup_time_id: TIME_ID, dispatched_at: "2026-02-02T03:00:00Z" }),
      { getOrder: () => jsonReply({ success: true, data: page++ === 0 ? [created] : [] }) });
    expect(await reconcileOperation("op-1", r.deps)).toEqual({ status: "recorded", outcome: "issued" });
    expect(r.recorded()[0]).toMatchObject({ p_outcome: "issued", p_order_id: "261014LKLL3E", p_code: "RECONCILED" });
    expect(r.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
    expect(r.count("http:GET /time")).toBe(0);
  });

  it("a rejected time id (or any 400 on the order) is a definite refusal: nothing is sent again", async () => {
    const s = scenario(await pickupPayload(), { postOrder: () => jsonReply({ success: false, message: "time_id tidak valid" }, 400) });
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "rejected" });
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "PROVIDER_REJECTED", p_detail: "time_id tidak valid" }]);
    expect(s.count("http:POST /time")).toBe(1);
    expect(s.count("http:POST /order")).toBe(1);
  });

  it("refuses locally, before any provider write, when the queued slot is now inside the lead time", async () => {
    const s = scenario(await pickupPayload());
    const late = { ...s.deps, now: () => new Date("2026-02-03T05:30:00Z") }; // 12:30 WIB for a 13:00 slot
    expect(await dispatchOperation("op-1", late)).toEqual({ status: "recorded", outcome: "rejected" });
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "PICKUP_TIME_INVALID" }]);
    expect(s.timeline.filter((t) => t.includes("/time") || t.includes("POST") || t.includes("pickup_"))).toEqual([]);
    // An incomplete frozen slot is refused too.
    const incomplete = scenario(await pickupPayload({ pickup_date: null }));
    await dispatchOperation("op-1", incomplete.deps);
    expect(incomplete.recorded()[0]).toMatchObject({ p_outcome: "rejected", p_code: "INPUT_INCOMPLETE" });
  });

  it("a requeued operation (phase reserved) sends the order with its stored time id and never reserves again", async () => {
    const s = scenario(await pickupPayload({ pickup_phase: "reserved", pickup_time_id: TIME_ID }));
    expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "issued" });
    expect(s.timeline).toEqual(["rpc:dispatch_claim", "rpc:dispatch_pickup_begin_create", "http:POST /order", "rpc:dispatch_record"]);
    expect((s.bodies.postOrder as { pickup: { time_id: string } }).pickup.time_id).toBe(TIME_ID);
  });

  it("never claims past a started reservation or create: those phases only reconcile", async () => {
    for (const phase of ["reserving", "creating"]) {
      const s = scenario(await pickupPayload({ pickup_phase: phase, pickup_time_id: phase === "creating" ? TIME_ID : null }));
      expect(await dispatchOperation("op-1", s.deps)).toEqual({ status: "inconclusive", reason: "pickup_phase_unexpected" });
      expect(s.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
    }
  });
});

describe("reconcileOperation: pickup reservation read-back (TD-12)", () => {
  const unknownReserving = (over: Record<string, unknown> = {}) => pickupPayload({ operation_state: "unknown", pickup_phase: "reserving", ...over });

  it("finds a lost reservation by GET /time and requeues the order; no POST of any kind", async () => {
    const s = scenario(await unknownReserving(), { getTime: () => jsonReply(fixture("pickup-time-get-list.json")) });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "reservation_confirmed" });
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([{ p_operation: "op-1", p_attempt: 3, p_time_id: TIME_ID }]);
    expect(s.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
    expect(s.recorded()).toEqual([]);
  });

  it("a reservation stored but not followed by an order (phase reserved) is requeued without any provider call", async () => {
    const s = scenario(await unknownReserving({ pickup_phase: "reserved", pickup_time_id: TIME_ID }));
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "reservation_confirmed" });
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([{ p_operation: "op-1", p_attempt: 3 }]);
    expect(s.timeline.filter((t) => t.startsWith("http:"))).toEqual([]);
  });

  it("stays inconclusive and sends nothing when several records match or the list cannot be read", async () => {
    const twin = fixture("pickup-time-get-list.json");
    twin.data.push({ _id: "6b0c2a1e9d3f4a5b6c7d8eaa", date: 1770123600000, time: "13:00" });
    const many = scenario(await unknownReserving(), { getTime: () => jsonReply(twin) });
    expect(await reconcileOperation("op-1", many.deps)).toEqual({ status: "inconclusive", reason: "reservation_ambiguous" });
    expect(many.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
    expect(many.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);

    const down = scenario(await unknownReserving(), { getTime: () => new Response("down", { status: 503 }) });
    expect(await reconcileOperation("op-1", down.deps)).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    expect(down.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
  });

  it("a record that names another address is not taken as ours", async () => {
    const other = fixture("pickup-time-get-list.json");
    other.data[0].address = { _id: "5fc62f60f8f44b34aa4c0dcd" };
    const s = scenario(await unknownReserving(), { getTime: () => jsonReply(other) });
    await reconcileOperation("op-1", s.deps);
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
    expect(s.recorded()[0]).toMatchObject({ p_outcome: "not_created", p_code: "NOT_CREATED" });
  });

  it("no matching record concludes 'not created' only after the database's waiting period, and never POSTs", async () => {
    const s = scenario(await unknownReserving(), { getTime: () => jsonReply({ success: true, data: [] }) });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "not_created" });
    expect(s.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "not_created", p_code: "NOT_CREATED" }]);
    expect(s.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
  });

  it("never adopts a time id another operation of the tenant already holds (a sibling's reservation of the same slot)", async () => {
    // Only the sibling's record is visible: nothing of ours exists, so nothing is adopted.
    const only = scenario(await unknownReserving(), { getTime: () => jsonReply(fixture("pickup-time-get-list.json")) }, {}, [TIME_ID]);
    expect(await reconcileOperation("op-1", only.deps)).toEqual({ status: "recorded", outcome: "not_created" });
    expect(only.rpcArgs("dispatch_pickup_known_time_ids")).toEqual([{ p_operation: "op-1" }]);
    expect(only.rpcArgs("dispatch_pickup_requeue")).toEqual([]);

    // The same slot twice, one of them the sibling's: the other one is ours, not "ambiguous".
    const twin = fixture("pickup-time-get-list.json");
    twin.data.push({ _id: "6b0c2a1e9d3f4a5b6c7d8eaa", date: 1770123600000, time: "13:00" });
    const both = scenario(await unknownReserving(), { getTime: () => jsonReply(twin) }, {}, [TIME_ID]);
    expect(await reconcileOperation("op-1", both.deps)).toEqual({ status: "recorded", outcome: "reservation_confirmed" });
    expect(both.rpcArgs("dispatch_pickup_requeue")).toEqual([{ p_operation: "op-1", p_attempt: 3, p_time_id: "6b0c2a1e9d3f4a5b6c7d8eaa" }]);
  });

  it("stays inconclusive when the tenant's known time ids cannot be read: nothing is adopted", async () => {
    const s = scenario(await unknownReserving(), { getTime: () => jsonReply(fixture("pickup-time-get-list.json")) }, { dispatch_pickup_known_time_ids: "boom" });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
    expect(s.recorded()).toEqual([]);
  });

  it("an 18:00 row of the previous day does not match the next day, in either date shape", async () => {
    const list = { success: true, data: [
      { _id: "6b0c2a1e9d3f4a5b6c7d8f01", date: Date.parse("2026-02-02T18:00:00Z"), time: "18:00" }, // UTC clock shape: 2 Feb
      { _id: "6b0c2a1e9d3f4a5b6c7d8f02", date: Date.parse("2026-02-02T11:00:00Z"), time: "18:00" }, // real instant, 18:00 WIB: 2 Feb
    ] };
    const s = scenario(await unknownReserving({ pickup_slot_hour: 18 }), { getTime: () => jsonReply(list) });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "not_created" });
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
    // The next day's own 18:00 row (either shape) is the one that matches.
    for (const instant of ["2026-02-03T18:00:00Z", "2026-02-03T11:00:00Z"]) {
      const next = { success: true, data: [...list.data, { _id: "6b0c2a1e9d3f4a5b6c7d8f03", date: Date.parse(instant), time: "18:00" }] };
      const t = scenario(await unknownReserving({ pickup_slot_hour: 18 }), { getTime: () => jsonReply(next) });
      expect(await reconcileOperation("op-1", t.deps)).toEqual({ status: "recorded", outcome: "reservation_confirmed" });
      expect(t.rpcArgs("dispatch_pickup_requeue")).toEqual([{ p_operation: "op-1", p_attempt: 3, p_time_id: "6b0c2a1e9d3f4a5b6c7d8f03" }]);
    }
  });

  it("an unreadable /time row is never read as absence: the read-back stays inconclusive and records nothing", async () => {
    // The audit's row: a valid id and slot hour whose date cannot be parsed. It may be this very reservation.
    const list = { success: true, data: [{ _id: "6b0c2a1e9d3f4a5b6c7d8e99", date: "bad", time: "13:00" }] };
    const s = scenario(await unknownReserving(), { getTime: () => jsonReply(list) });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    expect(s.recorded()).toEqual([]);
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
    expect(s.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
    // Beside a readable matching row the unreadable one could be a second match: still nothing is adopted.
    const mixed = { success: true, data: [...fixture("pickup-time-get-list.json").data, list.data[0]] };
    const m = scenario(await unknownReserving(), { getTime: () => jsonReply(mixed) });
    expect(await reconcileOperation("op-1", m.deps)).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    expect(m.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
  });

  it("a reservation read-back that concluded 'not created' is checked again and requeued when a complete read shows it", async () => {
    const s = scenario(await pickupPayload({ operation_state: "failed", pickup_phase: "reserving" }), { getTime: () => jsonReply(fixture("pickup-time-get-list.json")) });
    expect(await reconcileOperation("op-1", s.deps)).toEqual({ status: "recorded", outcome: "reservation_confirmed" });
    expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([{ p_operation: "op-1", p_attempt: 3, p_time_id: TIME_ID }]);
    expect(s.timeline.filter((t) => t.startsWith("http:POST"))).toEqual([]);
    // An unreadable row blocks that recovery too.
    const bad = { success: true, data: [...fixture("pickup-time-get-list.json").data, { _id: "6b0c2a1e9d3f4a5b6c7d8e99", date: "bad", time: "13:00" }] };
    const t = scenario(await pickupPayload({ operation_state: "failed", pickup_phase: "reserving" }), { getTime: () => jsonReply(bad) });
    expect(await reconcileOperation("op-1", t.deps)).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    expect(t.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
  });

  it("a failed operation whose create began (or whose reservation was stored) is never requeued from a read-back", async () => {
    for (const phase of ["reserved", "creating"]) {
      const s = scenario(await pickupPayload({ operation_state: "failed", pickup_phase: phase, pickup_time_id: TIME_ID }), { getTime: () => jsonReply(fixture("pickup-time-get-list.json")) });
      await reconcileOperation("op-1", s.deps);
      expect(s.rpcArgs("dispatch_pickup_requeue")).toEqual([]);
      expect(s.count("http:GET /time")).toBe(0);
    }
  });
});
