import { describe, expect, it } from "vitest";
import { createPartnerClient } from "../../src/lib/mengantar/partner-api";
import { createMengantarPublicClient, type MengantarEnvironment } from "../../src/lib/mengantar/public-api";

// DEL-1 stage 3 live contract check. READ-ONLY: area search and estimate; it never creates, pays,
// deletes or edits anything. Skipped unless a key is supplied through the secrets store, e.g.
//   MENGANTAR_CONTRACT_KEY_VAR=GERAIEXPRESS_MENGANTAR_PROD_READ_KEY \
//   MENGANTAR_CONTRACT_ENV=production secrets-env run -- pnpm test:contract
// The variable holding the key is named indirectly so the key never appears on a command line.
// Only variables meant for this check may be sent to Mengantar as a key.
const keyVar = process.env.MENGANTAR_CONTRACT_KEY_VAR ?? "MENGANTAR_CONTRACT_KEY";
if (keyVar !== "MENGANTAR_CONTRACT_KEY" && !keyVar.startsWith("GERAIEXPRESS_MENGANTAR_")) throw new Error("MENGANTAR_CONTRACT_KEY_VAR must name a GERAIEXPRESS_MENGANTAR_* variable");
const key = process.env[keyVar];
const environment = (process.env.MENGANTAR_CONTRACT_ENV ?? "sandbox") as MengantarEnvironment;
const DEPOK_TAPOS_SUKATANI = "5fc63169f8f44b34aa4c2ee1";
const JAKSEL_MELAWAI = "5fc62f60f8f44b34aa4c0dcd";

describe.skipIf(!key)(`Mengantar Public API live contract (${environment}, read-only)`, () => {
  // The describe body runs even when skipped, so the client is created on first use.
  const client = () => createMengantarPublicClient(environment, key!, fetch);

  it("finds the counter's area in the provider index", async () => {
    const areas = await client().searchAreas("sukatani");
    expect(areas.find((a) => a.id === DEPOK_TAPOS_SUKATANI)).toMatchObject({ city: "DEPOK", district: "TAPOS", subdistrict: "SUKATANI" });
  });

  it("quotes non-COD and COD shipments with consistent numbers", async () => {
    const base = { originAreaId: DEPOK_TAPOS_SUKATANI, destinationAreaId: JAKSEL_MELAWAI, weightGrams: 1000 };
    const plain = await client().estimate(base);
    expect(plain.length).toBeGreaterThan(2);
    for (const row of plain) {
      expect(row.codFee).toBe(0);
      expect(row.netShipping).toBeLessThanOrEqual(row.tariff);
    }
    const cod = await client().estimate({ ...base, codAmount: 150000 });
    expect(cod.length).toBeGreaterThan(0);
    for (const row of cod) expect(row.codFee).toBeGreaterThan(0);
  });
});

// Partner (sandbox): a signed read of the partner's sellers proves ID, secret and signing.
//   MENGANTAR_CONTRACT_PARTNER_ID=ongkirich \
//   MENGANTAR_CONTRACT_PARTNER_SECRET_VAR=GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET secrets-env run -- pnpm test:contract
const partnerId = process.env.MENGANTAR_CONTRACT_PARTNER_ID;
const secretVar = process.env.MENGANTAR_CONTRACT_PARTNER_SECRET_VAR ?? "";
if (secretVar && !secretVar.startsWith("GERAIEXPRESS_MENGANTAR_")) throw new Error("MENGANTAR_CONTRACT_PARTNER_SECRET_VAR must name a GERAIEXPRESS_MENGANTAR_* variable");
const partnerSecret = secretVar ? process.env[secretVar] : undefined;

describe.skipIf(!partnerId || !partnerSecret)("Mengantar Partner API live contract (sandbox, read-only)", () => {
  it("lists the partner's sellers with a valid signature", async () => {
    const result = await createPartnerClient("sandbox", partnerId!, partnerSecret!, fetch).listSellers({ size: 5 });
    expect(result.total).toBeGreaterThanOrEqual(0);
    for (const s of result.sellers) expect(Object.keys(s).sort()).toEqual(["active", "externalUserId", "sellerId"]);
  });
});
