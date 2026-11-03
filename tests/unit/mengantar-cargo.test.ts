import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createMengantarPublicClient, estimateServiceKey, estimateTwoPassCod,
  InvalidOrderRequest, MengantarError, parseEstimates,
  type CourierEstimate, type CreateOrderRequest,
} from "../../src/lib/mengantar/public-api";

// Public, unauthenticated provider snapshots are shape evidence, NOT seller terms or entitlement.
const snapshot = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/mengantar/${name}`, import.meta.url), "utf8"));
const area = "5fc62de8f8f44b34aa4bdc49";
const estimateRequest = { originAreaId: area, destinationAreaId: area, weightGrams: 10000 };
const request: CreateOrderRequest = {
  courier: "JNE", pickupAddressId: area, reference: "GX261103-CARGO1",
  recipient: { areaId: area, address: "Synthetic test address", name: "Synthetic recipient", phone: "081234567890" },
  weightGrams: 10000, quantity: 1, parcelContent: "Synthetic test parcel", goodsValue: 100000,
};
const item = {
  status: "active", ORDER_ID: "261103ABCDEF", batch: "261103ABCDEF", destinationMark: request.reference,
  isPaid: true, cnote_no: "TEST12345678", estimatedPrice: 45000,
};
const transport = (data: unknown) => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ success: true, data }));
  return { fetcher, api: createMengantarPublicClient("sandbox", "synthetic-test-key", fetcher as typeof fetch) };
};

const cargoRow = () => structuredClone(snapshot("cargo-public-noncod.json").data.SiCepatCargo);

describe("cargo estimates remain an explicit, fail-closed transport capability", () => {
  it("does not return cargo or change legacy regular rows without explicit opt-in", () => {
    const data = snapshot("cargo-public-noncod.json").data;
    expect(parseEstimates(data, false).every((r) => r.service_class !== "cargo")).toBe(true);
    const mixed = parseEstimates(data, false, true);
    expect(mixed.filter((r) => r.service_class !== "cargo")).toEqual(parseEstimates(data, false));
  });

  it("reads cargo-specific tariff, seller cost, discount, ETA and route minimum", () => {
    const cargo = parseEstimates(snapshot("cargo-public-noncod.json").data, false, true).filter((r) => r.service_class === "cargo");
    expect(cargo).toHaveLength(4);
    expect(cargo.find((r) => r.courier === "SiCepat")).toMatchObject({
      tariff: 35000, netShipping: 33250, codFee: 0, discountBps: 500,
      minimum_weight_grams: 10000, etaText: "2 - 4 Days",
    });
    expect(cargo.find((r) => r.courier === "JNE")).toMatchObject({ tariff: 45000, netShipping: 42750, discountBps: 500 });
    expect(cargo.find((r) => r.courier === "iDexpress")).toMatchObject({ tariff: 30000, netShipping: 27000, discountBps: 1000 });
    expect(cargo.find((r) => r.courier === "Sap")).toMatchObject({ minimum_weight_grams: 5000 });
  });

  it.each([undefined, null, 0, -10, "10", Infinity, 0.0001, 1001])("drops an unknown/invalid route minimum %s", (minimum) => {
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), minimumWeightCargo: minimum } }, false, true)).toEqual([]);
  });

  it("keeps a positive fractional-kg minimum at exact integer-gram precision", () => {
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), minimumWeightCargo: 0.5 } }, false, true)[0])
      .toMatchObject({ minimum_weight_grams: 500 });
  });

  it.each(["unsupported", "unsupportedPickup", "unsupportedOriginSicepat"])("drops cargo when %s is true", (flag) => {
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), [flag]: true } }, false, true)).toEqual([]);
  });

  it("does not fall back to unrelated generic prices or accept inconsistent cargo totals", () => {
    const row = cargoRow();
    delete row.cargoPrice;
    expect(parseEstimates({ SiCepatCargo: row }, false, true)).toEqual([]);
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), cargoEstimatedPrice: 35001 } }, false, true)).toEqual([]);
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), cargoEstimatedSpecialPrice: 35001 } }, false, true)).toEqual([]);
    expect(parseEstimates({ SiCepatCargo: { ...cargoRow(), cargoEstimatedSpecialPrice: 0 } }, false, true)).toEqual([]);
  });

  it("keeps all cargo COD disabled rather than accepting the observed one-rupiah disagreement", () => {
    const data = snapshot("cargo-public-cod-inconsistent.json").data;
    expect(data.SiCepatCargo.cargoEstimatedPrice - data.SiCepatCargo.cargoPrice).toBe(3330);
    expect(data.SiCepatCargo.codFee).toBe(3329);
    expect(parseEstimates(data, true, true).every((r) => r.service_class !== "cargo")).toBe(true);
  });

  it("opts in locally without inventing an estimate query parameter", async () => {
    const data = snapshot("cargo-public-noncod.json").data;
    const { api, fetcher } = transport(data);
    expect((await api.estimate({ ...estimateRequest, includeCargo: true })).filter((r) => r.service_class === "cargo")).toHaveLength(4);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("weight")).toBe("10");
    expect(url.searchParams.get("courier")).toBe("all");
    expect(url.searchParams.has("includeCargo")).toBe(false);
    expect(url.searchParams.has("cargo")).toBe(false);
    await expect(api.estimate({ ...estimateRequest, includeCargo: "true" as unknown as boolean })).rejects.toThrow(InvalidOrderRequest);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("cargo order transport — synthetic fetch only, no live order", () => {
  it.each(["JNE", "SiCepat", "Sap", "iDexpress"])("uses base courier %s and the per-item Boolean cargo flag", async (courier) => {
    const { api, fetcher } = transport([{ ...item, cargo: true }]);
    expect((await api.createOrder({ ...request, courier, cargo: true })).outcome).toBe("issued");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.courier).toBe(courier);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({ cargo: true, weight: 10, destinationMark: request.reference });
    expect(body).not.toHaveProperty("cargo");
  });

  it("keeps legacy regular payloads free of cargo flags", async () => {
    const { api, fetcher } = transport([item]);
    await api.createOrder(request);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).orders[0]).not.toHaveProperty("cargo");
  });

  it.each(["JT", "lion", "anteraja", "spx", "pos", "JNECargo"])("refuses unsupported cargo courier %s before sending", async (courier) => {
    const { api, fetcher } = transport([]);
    await expect(api.createOrder({ ...request, courier, cargo: true })).rejects.toThrow(InvalidOrderRequest);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a string flag and every cargo COD request locally", async () => {
    const { api, fetcher } = transport([]);
    await expect(api.createOrder({ ...request, cargo: "true" as unknown as boolean })).rejects.toThrow(InvalidOrderRequest);
    const { goodsValue: _goods, ...base } = request;
    await expect(api.createOrder({ ...base, cargo: true, codAmount: 145000 })).rejects.toThrow(InvalidOrderRequest);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, false, null, "true"])("keeps cargo creation unknown without a true Boolean mode echo (%s), and never retries", async (cargo) => {
    const { api, fetcher } = transport([{ ...item, cargo }]);
    await expect(api.createOrder({ ...request, cargo: true })).rejects.toMatchObject({ code: "unknown_outcome" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { estimatedPrice: null },
    { cargoEstimatedPrice: 35000 },
  ])("keeps a cargo response unknown when its selected-service price is unreadable or contradictory (%j)", async (prices) => {
    const { api, fetcher } = transport([{ ...item, cargo: true, ...prices }]);
    await expect(api.createOrder({ ...request, cargo: true })).rejects.toMatchObject({ code: "unknown_outcome" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not accept a cargo order for a regular request", async () => {
    const { api } = transport([{ ...item, cargo: true }]);
    await expect(api.createOrder(request)).rejects.toThrow(MengantarError);
  });

  it("retains known mode on read-back without turning an absent/malformed mode into regular", async () => {
    for (const cargo of [true, false, undefined, "true"]) {
      const { api } = transport([{ ...item, cargo, createdAt: "2026-11-03T00:00:00Z" }]);
      const result = await api.findOrder(item.ORDER_ID);
      if (typeof cargo === "boolean") expect(result?.cargo).toBe(cargo);
      else expect(result).not.toHaveProperty("cargo");
    }
  });
});

describe("service identity survives two-pass COD even for a shared base courier", () => {
  it("does not overwrite regular/cargo rows with the same courier and tariff in a supplied estimator", async () => {
    const regular: CourierEstimate = { courier: "JNE", tariff: 45000, codFee: 100, netShipping: 40000, discountBps: null, etaText: null };
    // Synthetic supplied estimator only. The live parser/create path still blocks all cargo COD.
    const cargo: CourierEstimate = { ...regular, service_class: "cargo", minimum_weight_grams: 10000, codFee: 200, netShipping: 42000 };
    expect(estimateServiceKey(regular)).not.toBe(estimateServiceKey(cargo));
    const rows = await estimateTwoPassCod(async () => [regular, cargo], { ...estimateRequest, goodsValueIdr: 100000 });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => !r.service_class)).toMatchObject({ codFee: 100, netShipping: 40000 });
    expect(rows.find((r) => r.service_class === "cargo")).toMatchObject({ codFee: 200, netShipping: 42000, minimum_weight_grams: 10000 });
  });
});
