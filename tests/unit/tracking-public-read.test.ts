import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../src/lib/auth/instance", () => ({ anonClient: async () => ({ rpc }) }));
import { readPublicTracking } from "../../src/modules/tracking/public-read";
import { resetLimiters } from "../../src/lib/limiter";

const projection = {
  gerai_label: null, courier: "JT", service: "REG", awb: "JP1234567890", status_label: "Status belum tersedia",
  timeline: [], destination_city: null, sender_initials: null, recipient_initials: "P. U.",
  created_at: "2026-11-05T04:00:00Z", issued_at: null,
};
beforeEach(() => { resetLimiters(); rpc.mockReset().mockResolvedValue({ data: null, error: null }); });

it("uses exactly the anonymous token RPC, including malformed/unknown/revoked inputs", async () => {
  for (const token of ["malformed", "U".repeat(43), "R".repeat(43), ""]) {
    expect(await readPublicTracking(token, "192.0.2.1")).toEqual({ kind: "missing" });
    expect(rpc).toHaveBeenLastCalledWith("track_shipment", { token });
  }
});
it("returns only a reconstructed public projection; no raw RPC payload escapes", async () => {
  rpc.mockResolvedValue({ data: { ...projection, sender_name: "Rahasia" }, error: null });
  expect(await readPublicTracking("U".repeat(43), "192.0.2.1")).toEqual({ kind: "found", projection });
});
it("limits all requests before a lookup and counts invalid lookups in their own budget", async () => {
  for (let i = 0; i < 10; i++) expect((await readPublicTracking("bad", "192.0.2.1")).kind).toBe("missing");
  expect((await readPublicTracking("bad", "192.0.2.1")).kind).toBe("limited");
  rpc.mockResolvedValue({ data: projection, error: null });
  expect((await readPublicTracking("V".repeat(43), "192.0.2.1")).kind).toBe("found");
  for (let i = 12; i < 30; i++) await readPublicTracking("V".repeat(43), "192.0.2.1");
  const before = rpc.mock.calls.length;
  expect((await readPublicTracking("V".repeat(43), "192.0.2.1")).kind).toBe("limited");
  expect(rpc).toHaveBeenCalledTimes(before);
});
it("missing IP never reaches the data API and upstream failures never reveal details", async () => {
  expect((await readPublicTracking("bad", null)).kind).toBe("limited");
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockRejectedValue(new Error("private upstream detail"));
  expect(await readPublicTracking("bad", "192.0.2.1")).toEqual({ kind: "missing" });
});
