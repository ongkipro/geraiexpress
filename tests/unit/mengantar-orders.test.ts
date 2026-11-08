import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMengantarPublicClient, estimateTwoPassCod, InvalidOrderRequest, MengantarError, type CreateOrderRequest } from "../../src/lib/mengantar/public-api";

// Sanitized sandbox responses (T-020/T-021, 2026-10-14): phones, emails and user records removed.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8"));
const KEY = "TEST-KEY-0000000000";
const REF = "GE-T021-MV7W5HXB";

const request: CreateOrderRequest = {
  courier: "JT",
  pickupAddressId: "6acf44a4771fe2b474c055ca",
  reference: REF,
  recipient: { areaId: "5fc63169f8f44b34aa4c2ee1", address: " Jl. Kapitan 1 RT 01/04 ", name: "Penerima Uji", phone: "081234567890" },
  weightGrams: 1200,
  quantity: 1,
  parcelContent: "Dokumen uji",
  goodsValue: 50000,
};

function fakeFetch(...replies: { status?: number; body: unknown; type?: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: { "content-type": reply.type ?? "application/json; charset=utf-8" },
    });
  }) as typeof fetch;
  return { impl, calls };
}
const clientFor = (...replies: { status?: number; body: unknown; type?: string }[]) => {
  const f = fakeFetch(...replies);
  return { api: createMengantarPublicClient("sandbox", KEY, f.impl), calls: f.calls };
};
async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(MengantarError);
  for (const exposed of [error.message, error.stack, JSON.stringify(error)]) expect(String(exposed)).not.toContain(KEY);
  return error as MengantarError;
}
const withMark = (name: string, mark = REF) => {
  const body = fixture(name);
  body.data[0].destinationMark = mark;
  return body;
};

describe("create order (T-021)", () => {
  it("sends one drop-off order with our reference and weight in kilograms", async () => {
    const { api, calls } = clientFor({ body: withMark("order-create-jt-issued.json") });
    await api.createOrder(request);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`https://sandbox.mengantar.com/api/public/${KEY}/order`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(String(init.body))).toEqual({
      courier: "JT",
      pickup: { address_id: "6acf44a4771fe2b474c055ca", type: "dropOff" },
      orders: [{
        goodsValue: 50000, customerAddressDataId: "5fc63169f8f44b34aa4c2ee1", customerAddress: "Jl. Kapitan 1 RT 01/04",
        customerName: "Penerima Uji", customerPhone: "081234567890", weight: 1.2, quantity: 1, parcelContent: "Dokumen uji",
        destinationMark: REF,
      }],
    });
  });

  it("sends a COD amount instead of a goods value for COD orders", async () => {
    const { api, calls } = clientFor({ body: withMark("order-create-jt-issued.json") });
    const { goodsValue: _omit, ...rest } = request;
    await api.createOrder({ ...rest, codAmount: 160000 });
    const order = JSON.parse(String(calls[0].init.body)).orders[0];
    expect(order.COD).toBe(160000);
    expect(order).not.toHaveProperty("goodsValue");
  });

  it("reports an issued shipment only with a paid item, ORDER_ID, resi and our reference", async () => {
    expect(await clientFor({ body: withMark("order-create-jt-issued.json") }).api.createOrder(request)).toEqual({
      outcome: "issued", orderId: "261014LJ9GP7", trackingNumber: "JO6844983511", batch: "26101416Q0L7LJ", batchId: "6acf44c1771fe2b474c05676", tariffWithFees: 93000,
    });
  });

  it("reports an unpaid order (no resi yet) separately", async () => {
    expect(await clientFor({ body: fixture("order-create-jt-unpaid.json") }).api.createOrder(request))
      .toEqual({ outcome: "unpaid", orderId: "261014H0JAFR", batch: "26101416827JYE", batchId: "6acf476a6b00a9b494ff04b8", tariffWithFees: 111600 });
  });

  it("treats success:true with an error item as a failed attempt, not an order", async () => {
    expect(await clientFor({ body: fixture("order-create-jne-item-error.json") }).api.createOrder(request))
      .toEqual({ outcome: "failed", batch: "26101416ZI8BP1", batchId: "6acf44a4771fe2b474c055dc", providerRecordId: "6acf44a4771fe2b474c055fd" });
    const odd = fixture("order-create-jne-item-error.json");
    odd.data[0].ORDER_ID = "261014ZZZZZZ"; // an error item with an identity is not "nothing happened"
    expect((await codeOf(clientFor({ body: odd }).api.createOrder(request))).code).toBe("unknown_outcome");
  });

  it("issues a COD order whose COD value is what the courier collects", async () => {
    const { goodsValue: _omit, ...rest } = request;
    const body = fixture("order-create-jt-cod-issued.json");
    const result = await clientFor({ body }).api.createOrder({ ...rest, reference: body.data[0].destinationMark, codAmount: 150000 });
    expect(result).toEqual({ outcome: "issued", orderId: "2610142JG95B", trackingNumber: "JO6948371799", batch: body.data[0].batch, batchId: body.data[0].batch_id, tariffWithFees: 97994 });
    expect([body.data[0].COD_AMOUNT, body.data[0].GOODS_AMOUNT]).toEqual([150000, 150000]);
  });

  it("passes the provider's refusal text on a 400 refusal", async () => {
    const refused = fixture("order-create-anteraja-dropoff-refused.json");
    const error = await codeOf(clientFor({ status: refused.httpStatus, body: refused.body }).api.createOrder({ ...request, courier: "anteraja" }));
    expect([error.code, error.providerMessage]).toEqual(["rejected", "Ekspedisi Anteraja tidak mendukung pengiriman Drop Off"]);
  });

  it("calls every unclear answer an unknown outcome and never retries", async () => {
    const issued = withMark("order-create-jt-issued.json");
    const variants: { status?: number; body: unknown; type?: string }[] = [
      { status: 502, body: "<html>", type: "text/html" },
      { status: 504, body: { success: false } },
      { status: 200, body: "{not json" },
      { status: 200, body: { success: false, message: "x" } },
      { status: 200, body: { ...issued, success: false } },
      { status: 200, body: { success: true, data: [] } },
      { status: 200, body: { success: true, data: [issued.data[0], issued.data[0]] } },
      { status: 302, body: "" },
      // 4xx other than a plain 400 refusal: meaning unknown, the order may exist.
      { status: 409, body: { success: false, message: "already exists" } },
      { status: 422, body: { success: false, message: "x" } },
      { status: 429, body: { success: false, message: "slow down" } },
      { status: 400, body: { success: false, message: "x", data: issued.data } },
      { body: withMark("order-create-jt-issued.json", "GE-SOMEONE-ELSE") },
      { body: { ...issued, data: [{ ...issued.data[0], isPaid: true, cnote_no: null }] } },
      { body: { ...issued, data: [{ ...issued.data[0], isPaid: false }] } },
      { body: { ...issued, data: [{ ...issued.data[0], status: "draft" }] } },
      { body: { ...issued, data: [{ ...issued.data[0], ORDER_ID: "../x" }] } },
    ];
    for (const reply of variants) {
      const { api, calls } = clientFor(reply);
      expect((await codeOf(api.createOrder(request))).code).toBe("unknown_outcome");
      expect(calls).toHaveLength(1);
    }
    const throwing = (async () => { throw new TypeError("network"); }) as typeof fetch;
    expect((await codeOf(createMengantarPublicClient("sandbox", KEY, throwing).createOrder(request))).code).toBe("unknown_outcome");
    // 403 is a refusal before any work; it stays not_allowed.
    expect((await codeOf(clientFor({ status: 403, body: { success: false, message: "Not allowed" } }).api.createOrder(request))).code).toBe("not_allowed");
  });

  it("refuses invalid requests before sending anything", async () => {
    const { api, calls } = clientFor({ body: {} });
    const bad: Partial<CreateOrderRequest>[] = [
      { courier: "Ninja" }, { courier: "SAPLite" }, { reference: "order-1" }, { pickupAddressId: "x" },
      { recipient: { ...request.recipient, phone: "0812-3456-7890" } }, { recipient: { ...request.recipient, areaId: "x" } },
      { recipient: { ...request.recipient, name: " " } }, { weightGrams: 0 }, { weightGrams: 1.5 }, { quantity: 0 },
      { goodsValue: 0 }, { parcelContent: "" },
    ];
    for (const change of bad) await expect(api.createOrder({ ...request, ...change } as CreateOrderRequest)).rejects.toThrow("Invalid order request");
    await expect(api.createOrder({ ...request, codAmount: 1000 } as unknown as CreateOrderRequest)).rejects.toThrow("Invalid order request");
    const { goodsValue: _omit, ...neither } = request;
    await expect(api.createOrder(neither as CreateOrderRequest)).rejects.toThrow("Invalid order request");
    expect(calls).toEqual([]);
  });

  it("shares live recipient limits with quote/confirmation validation (100/101, 300/301 and local phone)", async () => {
    const valid = { ...request, recipient: { ...request.recipient, name: "N".repeat(100), address: "A".repeat(300) } };
    const ok = clientFor({ body: withMark("order-create-jt-issued.json") });
    await ok.api.createOrder(valid);
    expect(ok.calls).toHaveLength(1);
    for (const recipient of [
      { ...valid.recipient, name: "N".repeat(101) },
      { ...valid.recipient, address: "A".repeat(301) },
      { ...valid.recipient, phone: "1234567890" },
      { ...valid.recipient, phone: "081234567" },
      { ...valid.recipient, phone: "+441234567890" },
    ]) {
      const refused = clientFor({ body: {} });
      await expect(refused.api.createOrder({ ...valid, recipient })).rejects.toBeInstanceOf(InvalidOrderRequest);
      expect(refused.calls).toEqual([]);
    }
  });
});

describe("order reconciliation (T-021)", () => {
  it("finds one order by ORDER_ID and reads its reference and state", async () => {
    const { api, calls } = clientFor({ body: fixture("order-find-by-id.json") });
    expect(await api.findOrder("261014H0JAFR")).toEqual({
      orderId: "261014H0JAFR", cargo: false, batch: "26101416827JYE", batchId: "6acf476a6b00a9b494ff04b8", price: 111600, reference: REF, trackingNumber: null, status: "active", statusCategory: "ACTIVE", lastStatusChange: "2026-10-14T16:12:00.000Z", deleted: false, paid: false, createdAt: "2026-10-14T09:12:10.231Z",
    });
    expect(new URL(calls[0].url).searchParams.get("order_id")).toBe("261014H0JAFR");
    expect(await clientFor({ body: fixture("order-find-unknown-id.json") }).api.findOrder("ZZZZZZZZZZZZ")).toBeNull();
    const found = fixture("order-find-by-id.json");
    found.data.push(found.data[0]); // two rows for one ORDER_ID: ambiguous, not "the" order
    expect((await codeOf(clientFor({ body: found }).api.findOrder("261014H0JAFR"))).code).toBe("malformed");
  });

  const row = (orderId: string, createdAt: string, mark = "") => ({ ORDER_ID: orderId, destinationMark: mark, status: "active", isPaid: true, cnote_no: "JO1", createdAt });
  const pageOf = (n: number, createdAt: string) => Array.from({ length: n }, (_, i) => row(`26101400${String(i).padStart(4, "0")}`, createdAt));

  it("scans newest-first pages for our reference and stops at orders older than the attempt", async () => {
    const notBefore = new Date("2026-10-14T09:00:00Z");
    const first = [row("261014AAAAAA", "2026-10-14T09:30:00Z"), ...pageOf(49, "2026-10-14T09:20:00Z")];
    const second = [row("261014BBBBBB", "2026-10-14T09:10:00Z", REF), ...pageOf(48, "2026-10-14T09:05:00Z"), row("261013CCCCCC", "2026-10-14T08:59:00Z")];
    const { api, calls } = clientFor({ body: { success: true, data: first } }, { body: { success: true, data: second } }, { body: { success: true, data: [] } });
    const found = await api.findOrdersByReference({ reference: REF, courier: "JT", notBefore });
    expect(found.map((o) => o.orderId)).toEqual(["261014BBBBBB"]);
    // 08:59 is inside the 10-minute skew margin, so a third (empty) page is read before stopping.
    expect(calls).toHaveLength(3);
    expect(Object.fromEntries(new URL(calls[1].url).searchParams)).toEqual({ page: "2", size: "50", courier: "JT" });
  });

  it("keeps scanning past short pages and within the clock-skew margin", async () => {
    const notBefore = new Date("2026-10-14T09:00:00Z");
    // A provider-side page cap below 50 must not end the scan; a row 5 minutes "before" the attempt
    // (provider clock behind ours) must not hide our order on the next page.
    const first = [row("261014AAAAAA", "2026-10-14T09:20:00Z"), row("261014DDDDDD", "2026-10-14T08:55:00Z")];
    const second = [row("261014BBBBBB", "2026-10-14T08:54:00Z", REF), row("261014CCCCCC", "2026-10-14T08:40:00Z")];
    const { api, calls } = clientFor({ body: { success: true, data: first } }, { body: { success: true, data: second } });
    expect((await api.findOrdersByReference({ reference: REF, courier: "JT", notBefore })).map((o) => o.orderId)).toEqual(["261014BBBBBB"]);
    expect(calls).toHaveLength(2);
  });

  it("is inconclusive when rows are not newest-first", async () => {
    const rows = [row("261014AAAAAA", "2026-10-14T09:10:00Z"), row("261014BBBBBB", "2026-10-14T09:20:00Z")];
    // Followed by an empty page: without the ordering check this would wrongly read as "not found".
    const { api } = clientFor({ body: { success: true, data: rows } }, { body: { success: true, data: [] } });
    expect((await codeOf(api.findOrdersByReference({ reference: REF, courier: "JT", notBefore: new Date("2026-10-14T09:00:00Z") }))).code).toBe("unknown_outcome");
  });

  it("returns an error row that carries our reference so the caller can see it", async () => {
    const error = { ...row("x", "2026-10-14T09:10:00Z", REF), ORDER_ID: undefined, status: "error", cnote_no: null };
    const { api } = clientFor({ body: { success: true, data: [error] } }, { body: { success: true, data: [] } });
    expect(await api.findOrdersByReference({ reference: REF, courier: "JT", notBefore: new Date("2026-10-14T09:00:00Z") }))
      .toEqual([{ orderId: null, batch: null, batchId: null, price: null, reference: REF, trackingNumber: null, status: "error", statusCategory: null, lastStatusChange: null, paid: true, createdAt: "2026-10-14T09:10:00Z" }]);
  });

  it("does not claim 'not found' when the scan could not reach the attempt time", async () => {
    const recent = pageOf(50, "2026-10-14T09:30:00Z");
    const { api } = clientFor({ body: { success: true, data: recent } });
    expect((await codeOf(api.findOrdersByReference({ reference: REF, courier: "JT", notBefore: new Date("2026-10-14T09:00:00Z"), maxPages: 2 }))).code).toBe("unknown_outcome");
  });

  it("refuses an unreadable order list instead of guessing", async () => {
    const { api } = clientFor({ body: { success: true, data: [{ ORDER_ID: "261014AAAAAA", status: "active" }] } });
    expect((await codeOf(api.findOrdersByReference({ reference: REF, courier: "JT", notBefore: new Date() }))).code).toBe("malformed");
  });
});

describe("COD two-pass quoting and discontinued couriers (T-025)", () => {
  it("computes two-pass COD fees per distinct tariff without double-applying the COD fee", async () => {
    const seenCodAmounts: number[] = [];
    const results = await estimateTwoPassCod(
      async (input) => {
        seenCodAmounts.push(input.codAmount!);
        // Pass 1: codAmount = 50000 (goodsValueIdr). JNE and SiCepat share tariff 40000; JT has tariff 93000.
        if (input.codAmount === 50000) {
          return [
            { courier: "JNE", tariff: 40000, codFee: 1750, netShipping: 32000, discountBps: null, etaText: "1-2" },
            { courier: "SiCepat", tariff: 40000, codFee: 1750, netShipping: 31000, discountBps: null, etaText: "1-2" },
            { courier: "JT", tariff: 93000, codFee: 1750, netShipping: 65100, discountBps: null, etaText: "2-4" },
          ];
        }
        // Pass 2 for tariff 40000: codAmount = 50000 + 40000 = 90000 -> codFee = 3150
        if (input.codAmount === 90000) {
          return [
            { courier: "JNE", tariff: 40000, codFee: 3150, netShipping: 32000, discountBps: 2000, etaText: "1-2" },
            { courier: "SiCepat", tariff: 40000, codFee: 3150, netShipping: 31000, discountBps: 2250, etaText: "1-2" },
            { courier: "JT", tariff: 93000, codFee: 3150, netShipping: 65100, discountBps: 9999, etaText: "2-4" },
          ];
        }
        // Pass 2 for tariff 93000: codAmount = 50000 + 93000 = 143000 -> codFee = 4994
        return [
          { courier: "JNE", tariff: 40000, codFee: 4994, netShipping: 32000, discountBps: 1, etaText: "1-2" },
          { courier: "SiCepat", tariff: 40000, codFee: 4994, netShipping: 31000, discountBps: 1, etaText: "1-2" },
          { courier: "JT", tariff: 93000, codFee: 4994, netShipping: 65100, discountBps: 3000, etaText: "2-4" },
        ];
      },
      {
        originAreaId: "5fc63201f8f44b34aa4c4e24",
        destinationAreaId: "5fc63169f8f44b34aa4c2ee1",
        weightGrams: 1000,
        goodsValueIdr: 50000,
      },
    );
    // 1 pass-1 call + 2 distinct tariff pass-2 calls (90000 and 143000)
    expect(seenCodAmounts).toEqual([50000, 90000, 143000]);
    expect(results).toEqual([
      // The discount comes from the same (second) answer as the net cost and COD fee.
      { courier: "JNE", tariff: 40000, codFee: 3150, netShipping: 32000, discountBps: 2000, etaText: "1-2" },
      { courier: "SiCepat", tariff: 40000, codFee: 3150, netShipping: 31000, discountBps: 2250, etaText: "1-2" },
      { courier: "JT", tariff: 93000, codFee: 4994, netShipping: 65100, discountBps: 3000, etaText: "2-4" },
    ]);
    // For JT: customer_charge = 93000 + 4994 = 97994; recipient COD = 50000 + 97994 = 147994 (fee applied once).
    const jt = results.find((r) => r.courier === "JT")!;
    const customerCharge = jt.tariff + jt.codFee;
    const recipientCodAmount = 50000 + customerCharge;
    expect(customerCharge).toBe(97994);
    expect(recipientCodAmount).toBe(147994);
  });

  it("refuses COD quoting when goodsValueIdr is below Rp1.000 and tags Ninja as courier_discontinued", async () => {
    await expect(
      estimateTwoPassCod(async () => [], {
        originAreaId: "5fc63201f8f44b34aa4c4e24",
        destinationAreaId: "5fc63169f8f44b34aa4c2ee1",
        weightGrams: 1000,
        goodsValueIdr: 500,
      }),
    ).rejects.toMatchObject({ reason: "cod_goods_value_required" });

    const { api } = clientFor({ body: {} });
    const ninjaErr = await api.createOrder({ ...request, courier: "Ninja" }).then(() => null, (e) => e);
    expect(ninjaErr).toBeInstanceOf(InvalidOrderRequest);
    expect((ninjaErr as InvalidOrderRequest).reason).toBe("courier_discontinued");
  });
});

describe("batch listing and pay-unpaid (T-026, T-033)", () => {
  // The unpaid fixture holds one provider batch whose CODE and OBJECT id differ.
  const CODE = "26101416827JYE";
  const OBJECT_ID = "6acf476a6b00a9b494ff04b8";
  const unpaidRow = () => fixture("order-find-by-id.json").data[0];

  it("keeps the batch code and the batch object id apart from create and read responses", async () => {
    const created = await clientFor({ body: fixture("order-create-jt-unpaid.json") }).api.createOrder(request);
    expect(created).toMatchObject({ outcome: "unpaid", batch: CODE, batchId: OBJECT_ID });
    expect(created).not.toMatchObject({ batch: OBJECT_ID });
    const read = await clientFor({ body: fixture("order-find-by-id.json") }).api.findOrder("261014H0JAFR");
    expect([read?.batch, read?.batchId]).toEqual([CODE, OBJECT_ID]);
    // An unreadable object id is null, never copied from the code or guessed.
    const odd = fixture("order-create-jt-unpaid.json");
    odd.data[0].batch_id = CODE;
    expect(await clientFor({ body: odd }).api.createOrder(request)).toMatchObject({ outcome: "unpaid", batch: CODE, batchId: null });
  });

  it("lists a batch by its code and pays it with the object id, reading the documented count", async () => {
    const other = { ...unpaidRow(), ORDER_ID: "261014OTHER1", batch: "26101499999999", batch_id: "6acf476a6b00a9b494ff0000", destinationMark: "GX261014-OTHER1", isPaid: true, cnote_no: "JO111" };
    const { api, calls } = clientFor(
      { body: { success: true, data: [unpaidRow(), other] } },
      { body: fixture("pay-unpaid-jt-success.json") },
    );
    const listed = await api.listOrdersByBatch(CODE, "JT");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ orderId: "261014H0JAFR", batch: CODE, batchId: OBJECT_ID, paid: false });
    expect(new URL(calls[0].url).searchParams.get("batch")).toBe(CODE);

    const paid = await api.payUnpaidBatch(OBJECT_ID, "JT");
    expect(paid).toEqual({ paidCount: 1, awbs: ["JO6948371799"] });
    expect(calls[1].url).toBe(`https://sandbox.mengantar.com/api/public/${KEY}/order/pay-unpaid`);
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ batch_id: OBJECT_ID, courier: "JT" });
  });

  it("refuses a code-valued payment body locally and a fake provider rejects it too", async () => {
    // The fake accepts only the object id, like the documented endpoint ("Batch _id").
    const calls: { method: string; url: string; body: unknown }[] = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: String(init?.method), url: String(url), body });
      const reply = body && body.batch_id !== OBJECT_ID ? { status: 400, body: { success: false, message: "Batch tidak ditemukan" } } : { status: 200, body: fixture("pay-unpaid-jt-success.json") };
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const api = createMengantarPublicClient("sandbox", KEY, impl);
    // The adapter never puts the code (uppercase, 14 chars) on the wire.
    await expect(api.payUnpaidBatch(CODE, "JT")).rejects.toThrow("Invalid order request");
    expect(calls).toHaveLength(0);
    // A well-formed id that is not the batch's id is what the provider itself refuses.
    const err = await codeOf(api.payUnpaidBatch("6acf476a6b00a9b494ff0000", "JT"));
    expect([err.code, err.providerMessage]).toEqual(["rejected", "Batch tidak ditemukan"]);
    expect((await api.payUnpaidBatch(OBJECT_ID, "JT")).paidCount).toBe(1);
    expect(calls.map((c) => c.body)).toEqual([{ batch_id: "6acf476a6b00a9b494ff0000", courier: "JT" }, { batch_id: OBJECT_ID, courier: "JT" }]);
  });

  it("reads the count in data (a number) and treats any other answer as an unknown outcome", async () => {
    for (const body of [
      { success: true, data: [{ orderId: "261014H0JAFR" }], cnote_no: ["JO1"] }, // data is not the documented count
      { success: true, data: "1", cnote_no: ["JO1"] },
      { success: true, data: -1, cnote_no: ["JO1"] },
      { success: true, cnote_no: ["JO1"] },
      { success: true, data: 1, cnote_no: "JO1" },
      { success: true, data: 1, cnote_no: [1] },
    ]) {
      expect((await codeOf(clientFor({ body }).api.payUnpaidBatch(OBJECT_ID, "JT"))).code, JSON.stringify(body)).toBe("unknown_outcome");
    }
    // A count without a tracking list is readable; the caller compares it with the batch.
    expect(await clientFor({ body: { success: true, data: 2 } }).api.payUnpaidBatch(OBJECT_ID, "JT")).toEqual({ paidCount: 2, awbs: [] });
    expect(await clientFor({ body: { success: true, data: 0, cnote_no: [] } }).api.payUnpaidBatch(OBJECT_ID, "JT")).toEqual({ paidCount: 0, awbs: [] });
  });

  it("refuses invalid batch ids or couriers locally and preserves providerMessage on 400 pay-unpaid refusal", async () => {
    const { api, calls } = clientFor({ status: 400, body: { success: false, message: "Saldo tidak mencukupi" } });
    for (const bad of ["../bad", CODE, OBJECT_ID.toUpperCase(), OBJECT_ID.slice(1), ""]) {
      await expect(api.payUnpaidBatch(bad, "JT"), bad).rejects.toThrow("Invalid order request");
    }
    await expect(api.payUnpaidBatch(OBJECT_ID, "Ninja")).rejects.toThrow("Invalid order request");
    expect(calls).toHaveLength(0);

    const err = await codeOf(api.payUnpaidBatch(OBJECT_ID, "JT"));
    expect([err.code, err.providerMessage]).toEqual(["rejected", "Saldo tidak mencukupi"]);
    // The list filter still takes only the batch code shape.
    await expect(api.listOrdersByBatch(OBJECT_ID, "JT")).rejects.toThrow("Invalid order request");
  });
});
