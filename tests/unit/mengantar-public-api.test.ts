import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMengantarPublicClient, discountPercentToBps, MengantarError, parseEstimates } from "../../src/lib/mengantar/public-api";

// Sanitized production responses captured read-only on 2026-10-14 (owner-approved); see
// docs/research/geraiexpress-mengantar-public-api.md.
const fixture = (name: string) => readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8");
const KEY = "TEST-KEY-0000000000";
const DEPOK = "5fc63169f8f44b34aa4c2ee1";
const MELAWAI = "5fc62f60f8f44b34aa4c0dcd";

function fakeFetch(body: string, init: { status?: number; type?: string } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url));
    expect(options?.redirect).toBe("manual");
    return new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "application/json; charset=utf-8" } });
  }) as typeof fetch;
  return { impl, calls };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(MengantarError);
  for (const exposed of [error.message, error.stack, JSON.stringify(error), String(error.cause)]) {
    expect(String(exposed)).not.toContain(KEY);
  }
  return (error as MengantarError).code;
}

describe("Mengantar Public API estimate (DEL-1 stage 3)", () => {
  it("normalizes a COD estimate into documented couriers with tariff, COD fee and net cost", async () => {
    const { impl, calls } = fakeFetch(fixture("estimate-all-cod-depok-melawai-1.5kg.json"));
    const client = createMengantarPublicClient("production", KEY, impl);
    const rows = await client.estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1500, codAmount: 150000 });

    const url = new URL(calls[0]);
    expect(url.origin).toBe("https://api-public.mengantar.com");
    expect(url.pathname).toBe(`/api/public/${KEY}/order/estimate`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin_id: DEPOK, destination_id: MELAWAI, courier: "all", weight: "1.5", COD_AMOUNT: "150000",
    });

    expect(rows.map((r) => r.courier)).toEqual(["Sap", "spx", "JT", "SiCepat", "anteraja", "iDexpress", "pos", "JNE", "lion"]);
    expect(rows.find((r) => r.courier === "JNE")).toEqual({ courier: "JNE", tariff: 20000, codFee: 4994, netShipping: 14000, discountBps: 3000, etaText: "1 - 2 days" });
    expect(rows.find((r) => r.courier === "pos")).toMatchObject({ tariff: 18000, netShipping: 15300 });
    // Undocumented variants (cargo, SAPLite) are not offered.
    expect(rows.some((r) => /cargo|lite/i.test(r.courier))).toBe(false);
  });

  it("normalizes a non-COD estimate with no COD fee", () => {
    const rows = parseEstimates(JSON.parse(fixture("estimate-all-noncod-depok-melawai-1kg.json")).data, false);
    expect(rows).toEqual([
      { courier: "Sap", tariff: 7000, codFee: 0, netShipping: 6500, discountBps: 0, etaText: "1 - 3 days" },
      { courier: "spx", tariff: 8700, codFee: 0, netShipping: 5655, discountBps: 3000, etaText: "1 - 2 days" },
      { courier: "JT", tariff: 9000, codFee: 0, netShipping: 6300, discountBps: 3000, etaText: null },
      { courier: "SiCepat", tariff: 9000, codFee: 0, netShipping: 6300, discountBps: 3000, etaText: "2 - 3 Days" },
      { courier: "anteraja", tariff: 9000, codFee: 0, netShipping: 6300, discountBps: 3000, etaText: "1-2 Day" },
      { courier: "iDexpress", tariff: 9000, codFee: 0, netShipping: 6300, discountBps: 3000, etaText: null },
      { courier: "pos", tariff: 9000, codFee: 0, netShipping: 7650, discountBps: 1500, etaText: "4 HARI" },
      { courier: "JNE", tariff: 10000, codFee: 0, netShipping: 7000, discountBps: 3000, etaText: "1 - 2 days" },
      { courier: "lion", tariff: 11160, codFee: 0, netShipping: 7811, discountBps: 3000, etaText: "1 - 2 Hari" },
    ]);
  });

  // T-053 / DATA-9: the documented `discountPercent` becomes integer basis points; unknown is null, never 0.
  it("converts discountPercent to basis points exactly and keeps unknown apart from a real 0%", () => {
    expect(discountPercentToBps(22.5)).toBe(2250);
    expect(discountPercentToBps(20)).toBe(2000);
    expect(discountPercentToBps(7.14)).toBe(714);
    expect(discountPercentToBps(0.01)).toBe(1);
    expect(discountPercentToBps(100)).toBe(10000);
    expect(discountPercentToBps(0)).toBe(0); // present 0 is a real 0%
    for (const unknown of [undefined, null, "abc", "22.5", true, {}, [], NaN, Infinity, -Infinity, -1, -0.01, 100.01, 120, 22.555, 1e-7, 5e-324]) {
      expect(discountPercentToBps(unknown), String(unknown)).toBeNull();
    }
  });

  it("stores the estimate's discountPercent per courier, null when absent or unreadable, and ignores discountExtraPercent", () => {
    const data = JSON.parse(fixture("estimate-all-noncod-depok-melawai-1kg.json")).data;
    data.JNE.discountPercent = 22.5;
    delete data.JT.discountPercent;
    data.pos.discountPercent = "abc";
    data.spx.discountPercent = 120;
    data.lion.discountExtraPercent = 12; // undocumented: never read
    delete data.lion.discountPercent;
    const bps = Object.fromEntries(parseEstimates(data, false).map((r) => [r.courier, r.discountBps]));
    expect(bps).toMatchObject({ JNE: 2250, JT: null, pos: null, spx: null, lion: null, Sap: 0, SiCepat: 3000 });
  });

  it("drops SiCepat when its origin or pickup is not served", () => {
    for (const flag of ["unsupportedPickup", "unsupportedOriginSicepat"]) {
      const data = JSON.parse(fixture("estimate-all-noncod-depok-melawai-1kg.json")).data;
      data.SiCepat[flag] = true;
      expect(parseEstimates(data, false).map((r) => r.courier)).not.toContain("SiCepat");
    }
  });

  it("drops couriers that cannot carry COD to the destination", () => {
    const data = JSON.parse(fixture("estimate-all-cod-depok-merauke-1kg.json")).data;
    expect(parseEstimates(data, true).map((r) => r.courier)).toEqual(["anteraja", "JNE", "Sap"]);
    // A COD response read as non-COD no longer adds up (its totals include the COD fee): nothing.
    expect(parseEstimates(data, false)).toEqual([]);
  });

  it("drops a row whose numbers do not add up instead of guessing", () => {
    const data = JSON.parse(fixture("estimate-all-cod-depok-melawai-1.5kg.json")).data;
    data.JNE.estimatedPrice += 1; // total no longer equals price + codFee
    data.JT.estimatedSpecialPrice = data.JT.price + data.JT.codFee + 1; // net cost above the tariff
    data.pos.price = "18000"; // not a number
    data.spx.price = 0;
    const couriers = parseEstimates(data, true).map((r) => r.courier);
    for (const dropped of ["JNE", "JT", "pos", "spx"]) expect(couriers).not.toContain(dropped);
    expect(couriers).toContain("Sap");
  });

  it("offers only documented courier codes, even when an extra key looks valid", () => {
    const data = JSON.parse(fixture("estimate-all-cod-depok-melawai-1.5kg.json")).data;
    for (const extra of ["SAPLite", "JNECargo", "Ninja", "newCourier"]) data[extra] = { ...data.JNE };
    expect(parseEstimates(data, true).map((r) => r.courier).sort()).toEqual(
      ["JNE", "JT", "SiCepat", "Sap", "anteraja", "iDexpress", "lion", "pos", "spx"].sort());
  });

  it("does not read a single-courier response shape as courier rows", () => {
    const data = JSON.parse(fixture("estimate-jne-noncod-depok-melawai-1kg.json")).data;
    expect(parseEstimates(data, false)).toEqual([]);
  });

  it("maps provider refusals and transport problems to codes without leaking the key", async () => {
    const make = (body: string, init?: { status?: number; type?: string }) =>
      createMengantarPublicClient("production", KEY, fakeFetch(body, init).impl)
        .estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1000 });
    expect(await codeOf(make(fixture("estimate-unknown-destination.json")))).toBe("rejected");
    expect(await codeOf(make('{"success":false,"message":"Not allowed"}', { status: 403 }))).toBe("not_allowed");
    expect(await codeOf(make("bad gateway", { status: 502, type: "text/html" }))).toBe("unavailable");
    expect(await codeOf(make("<html></html>", { type: "text/html" }))).toBe("malformed");
    expect(await codeOf(make("{not json"))).toBe("malformed");
    const oversized = JSON.parse(fixture("estimate-all-cod-depok-melawai-1.5kg.json"));
    oversized.padding = "x".repeat(300 * 1024);
    expect(await codeOf(make(JSON.stringify(oversized)))).toBe("malformed");
    expect(await codeOf(make('{"success":true,"data":[]}'))).toBe("malformed");
    // Redirects are never followed: a 3xx (even towards another host) is a transport refusal.
    expect(await codeOf(make("", { status: 301 }))).toBe("unavailable");

    // A stream that fails mid-read (timeout, reset) is a transport problem too.
    const broken = (async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"success":')); controller.error(new Error(`reset ${KEY}`)); },
    }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    expect(await codeOf(createMengantarPublicClient("production", KEY, broken)
      .estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1000 }))).toBe("unavailable");

    const throwing = (async () => { throw new TypeError(`fetch failed for https://api-public.mengantar.com/api/public/${KEY}`); }) as typeof fetch;
    expect(await codeOf(createMengantarPublicClient("production", KEY, throwing)
      .estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1000 }))).toBe("unavailable");
  });

  it("refuses bad input before any request is made", async () => {
    const { impl, calls } = fakeFetch("{}");
    const client = createMengantarPublicClient("sandbox", KEY, impl);
    await expect(client.estimate({ originAreaId: "x", destinationAreaId: MELAWAI, weightGrams: 1000 })).rejects.toThrow();
    await expect(client.estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 0 })).rejects.toThrow();
    await expect(client.estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1.5 })).rejects.toThrow();
    await expect(client.estimate({ originAreaId: DEPOK, destinationAreaId: MELAWAI, weightGrams: 1000, codAmount: -1 })).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(() => createMengantarPublicClient("sandbox", "../../admin?x=", impl)).toThrow();
    expect(() => createMengantarPublicClient("staging" as "sandbox", KEY, impl)).toThrow();
  });
});

describe("Mengantar Public API area search", () => {
  it("returns area options from the provider index", async () => {
    const { impl, calls } = fakeFetch(fixture("address-search-melawai.json"));
    const areas = await createMengantarPublicClient("sandbox", KEY, impl).searchAreas("  melawai ");
    expect(new URL(calls[0]).origin).toBe("https://sandbox.mengantar.com");
    expect(new URL(calls[0]).searchParams.get("keyword")).toBe("melawai");
    expect(areas).toEqual([{ id: MELAWAI, province: "DKI JAKARTA", city: "JAKARTA SELATAN", district: "KEBAYORAN BARU", subdistrict: "MELAWAI", zip: "12160" }]);
  });

  it("returns nothing for an empty result or a too-short keyword", async () => {
    const { impl, calls } = fakeFetch(fixture("address-search-empty.json"));
    const client = createMengantarPublicClient("production", KEY, impl);
    expect(await client.searchAreas("zzqxv")).toEqual([]);
    expect(await client.searchAreas("ab")).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("Mengantar seller pickup addresses (T-023)", () => {
  it("returns id, area, name and address, never the contact person or phone", async () => {
    const { impl, calls } = fakeFetch(fixture("address-list-sandbox.json"));
    const list = await createMengantarPublicClient("sandbox", KEY, impl).listPickupAddresses();
    expect(new URL(calls[0]).pathname).toBe(`/api/public/${KEY}/address`);
    expect(list).toEqual([{ id: "6acf44a4771fe2b474c055ca", areaId: "5fc62f60f8f44b34aa4c0dcd", name: "GeraiExpress Sandbox Uji",
      address: "Jl. Uji Sandbox No. 1", area: "MELAWAI, KEBAYORAN BARU, JAKARTA SELATAN", hidden: false }]);
  });

  it("skips rows without a usable id, area or address", async () => {
    const body = JSON.parse(fixture("address-list-sandbox.json"));
    const good = body.data[0];
    body.data = [good, { ...good, _id: "x" }, { ...good, PICKUP_AUTOFILL: null }, { ...good, PICKUP_ADDRESS: "" }];
    const { impl } = fakeFetch(JSON.stringify(body));
    expect(await createMengantarPublicClient("sandbox", KEY, impl).listPickupAddresses()).toHaveLength(1);
  });
});

