// T-084 / PR-46: the Java/non-Java × courier return-destination matrix (help 14715369).
import { describe, expect, it } from "vitest";
import {
  JAVA_PROVINCES, returnDestinationKind, returnDestinationNote, type ReturnDestinationKind,
} from "../../src/modules/labels/return-destination";

const JAVA = "JAWA BARAT", JAVA_2 = "DKI JAKARTA", OUTSIDE = "SUMATERA UTARA", OUTSIDE_2 = "BALI";
const COURIERS = ["JNE", "SiCepat", "Sap", "JT", "iDexpress", "lion", "anteraja", "spx", "pos"] as const;
const ELIGIBLE = new Set(["JNE", "SiCepat", "Sap"]);

describe("returnDestinationKind (Java/non-Java × courier)", () => {
  const routes: [string, string | null, string | null, boolean | null][] = [
    ["Java→Java", JAVA, JAVA_2, true],
    ["Java→non-Java", JAVA, OUTSIDE, false],
    ["non-Java→Java", OUTSIDE, JAVA, false],
    ["non-Java→non-Java", OUTSIDE, OUTSIDE_2, false],
    ["unknown origin", null, JAVA, null],
    ["unknown destination", JAVA, null, null],
  ];
  for (const courier of COURIERS) {
    for (const [name, origin, destination, javaToJava] of routes) {
      const expected: ReturnDestinationKind = !ELIGIBLE.has(courier) ? "pickup"
        : javaToJava === null ? "route_unknown" : javaToJava ? "java_web_return_unverified" : "pickup";
      it(`${courier} ${name} → ${expected}`, () => {
        expect(returnDestinationKind(courier, { originProvince: origin, destinationProvince: destination })).toBe(expected);
      });
    }
  }

  it("treats a missing courier (NULL snapshot courier) as the pickup rule", () => {
    expect(returnDestinationKind(null, { originProvince: JAVA, destinationProvince: JAVA })).toBe("pickup");
  });

  it("covers the six Java provinces and matches the catalogue spelling case-insensitively", () => {
    expect([...JAVA_PROVINCES].sort()).toEqual(["BANTEN", "DI YOGYAKARTA", "DKI JAKARTA", "JAWA BARAT", "JAWA TENGAH", "JAWA TIMUR"]);
    expect(returnDestinationKind("JNE", { originProvince: "jawa timur", destinationProvince: "Banten" })).toBe("java_web_return_unverified");
    expect(returnDestinationKind("JNE", { originProvince: "NUSA TENGGARA BARAT (NTB)", destinationProvince: "BANTEN" })).toBe("pickup");
  });
});

describe("returnDestinationNote", () => {
  it("always names the pickup address and never the printed sender as the destination", () => {
    for (const courier of COURIERS) {
      const note = returnDestinationNote(courier, { originProvince: JAVA, destinationProvince: OUTSIDE }, "Jl. Pickup 5");
      expect(note).toContain("alamat pickup (Jl. Pickup 5)");
      expect(note).toContain("bukan ke pengirim yang tercetak di label");
    }
  });

  it("states 'belum terverifikasi' for the Java–Java web return address and 'Rute tidak diketahui' for a missing province", () => {
    expect(returnDestinationNote("SiCepat", { originProvince: JAVA, destinationProvince: JAVA_2 }, null)).toMatch(/belum terverifikasi/);
    expect(returnDestinationNote("Sap", { originProvince: null, destinationProvince: JAVA }, null)).toMatch(/Rute tidak diketahui/);
    expect(returnDestinationNote("JT", { originProvince: JAVA, destinationProvince: JAVA_2 }, null)).not.toMatch(/belum terverifikasi/);
    expect(returnDestinationNote("JT", { originProvince: null, destinationProvince: null }, null)).toContain("rincian pengiriman");
  });
});
