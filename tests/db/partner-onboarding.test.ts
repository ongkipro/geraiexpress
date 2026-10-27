// T-027 / PR-17 / PR-20 / DEC-006: database tests for Partner seller onboarding RPCs,
// consent enforcement, role/demo/cross-tenant refusal, immutable external_user_id,
// 503 partial-provisioning seller_id preservation, 409 existing_account_required, and completion.

import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { IDS, client, demoVisitor, signIn, sql } from "./helpers";

const SEAL_KEY = Buffer.alloc(32, 5).toString("base64");
const PLAIN_KEY = "API-PARTNERSECRETKEY9876";
const SELLER_ID = "66ab1234567890abcdef1234";

async function sealedFor(tenant: string, version: number) {
  const s = await sealCredential(PLAIN_KEY, credentialAad(tenant, version), SEAL_KEY);
  return {
    p_ciphertext: s.ciphertext,
    p_iv: s.iv,
    p_key_version: s.keyVersion,
    p_hint: "9876",
  };
}

const validBeginArgs = (tenant: string = IDS.tenantA) => ({
  p_tenant: tenant,
  p_owner_name: "Budi Santoso",
  p_owner_email: "budi.santoso@gerai-uji.id",
  p_owner_phone: "081234567890",
  p_terms_version: "2026-10",
  p_privacy_version: "2026-10",
  p_agreed: true,
});

describe("Partner seller onboarding authorization and validation (PR-17 / PR-20 / IAM-3)", () => {
  it("refuses demo visitors, operators, foreign tenant admins, and unauthenticated callers", async () => {
    const demo = await demoVisitor();
    expect(
      (await demo.c.rpc("begin_partner_seller_onboarding", validBeginArgs(demo.tenant))).error?.message,
    ).toBe("demo_restricted");

    const operatorA = await signIn("operator-a@geraiexpress.test");
    expect(
      (await operatorA.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error?.message,
    ).toBe("admin_required");

    const ownerB = await signIn("owner-b@geraiexpress.test");
    expect(
      (await ownerB.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error?.message,
    ).toBe("admin_required");
    expect(
      (await ownerB.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA })).error?.message,
    ).toBe("not_found");

    expect(
      (await client().rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error,
    ).not.toBeNull();
  });

  it("refuses missing consent and invalid owner identity fields", async () => {
    const ownerA = await signIn("owner-a@geraiexpress.test");

    expect(
      (await ownerA.rpc("begin_partner_seller_onboarding", { ...validBeginArgs(), p_agreed: false })).error?.message,
    ).toBe("consent_required");
    expect(
      (await ownerA.rpc("begin_partner_seller_onboarding", { ...validBeginArgs(), p_terms_version: "   " })).error?.message,
    ).toBe("consent_required");

    for (const bad of [
      { p_owner_name: "" },
      { p_owner_name: "Invalid <script>" },
      { p_owner_email: "budi@example.com" },
      { p_owner_email: "budi@geraiexpress.local" },
      { p_owner_email: "not-an-email" },
      { p_owner_phone: "0215551234" },
      { p_owner_phone: "08123" },
    ]) {
      expect(
        (await ownerA.rpc("begin_partner_seller_onboarding", { ...validBeginArgs(), ...bad })).error?.message,
      ).toBe("invalid_input");
    }
  });
});

describe("Partner seller onboarding lifecycle & recovery (DEC-006)", () => {
  it("enforces immutable external_user_id, preserves seller_id on 503 recovery, handles 409 BYOK routing, and seals completion", async () => {
    sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null`);

    const ownerA = await signIn("owner-a@geraiexpress.test");
    const operatorA = await signIn("operator-a@geraiexpress.test");

    try {
      // 1. Begin onboarding
      const begin1 = await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs());
      expect(begin1.error).toBeNull();
      const expectedExtId = `geraiexpress:tenant:${IDS.tenantA}`;
      expect(begin1.data).toMatchObject({
        external_user_id: expectedExtId,
        partner_seller_id: null,
      });

      // Immutable external_user_id cannot be mutated even by table update
      expect(() =>
        sql(`update private.tenant_mengantar_onboarding set external_user_id = 'geraiexpress:tenant:other' where tenant_id = '${IDS.tenantA}'`),
      ).toThrow();

      // 2. Simulate 409 EMAIL_ALREADY_REGISTERED outcome
      const outcome409 = await ownerA.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA,
        p_state: "existing_account_required",
        p_seller_id: null,
        p_error_code: "EMAIL_ALREADY_REGISTERED",
        p_retry_after_seconds: null,
      });
      expect(outcome409.error).toBeNull();

      const status409 = await operatorA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(status409.error).toBeNull();
      expect(status409.data![0]).toMatchObject({
        connection_mode: "none",
        onboarding_state: "existing_account_required",
        last_error_code: "EMAIL_ALREADY_REGISTERED",
      });

      // 3. Simulate 503 KEY_PROVISIONING_FAILED with seller_id preservation across retry
      const outcome503 = await ownerA.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA,
        p_state: "registered_key_pending",
        p_seller_id: SELLER_ID,
        p_error_code: "KEY_PROVISIONING_FAILED",
        p_retry_after_seconds: 15,
      });
      expect(outcome503.error).toBeNull();

      const beginRetry = await ownerA.rpc("begin_partner_seller_onboarding", {
        ...validBeginArgs(),
        p_owner_email: "budi.updated@gerai-uji.id",
      });
      expect(beginRetry.error).toBeNull();
      expect(beginRetry.data).toMatchObject({
        external_user_id: expectedExtId,
        partner_seller_id: SELLER_ID,
      });

      // 4. Complete onboarding and verify key sealing + pickup clearing + already_partner_connected guard
      const latestVer = Number((beginRetry.data as { latest_credential_version: number }).latest_credential_version);
      sql(`update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca', mengantar_area_id = '5fc62f60f8f44b34aa4c0dcd' where id = '${IDS.outletA}'`);

      const completed = await ownerA.rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantA,
        p_seller_id: SELLER_ID,
        ...(await sealedFor(IDS.tenantA, latestVer + 1)),
      });
      expect(completed.error).toBeNull();
      expect(completed.data).toBe(latestVer + 1);

      // Outlet pickup was cleared on credential replacement
      expect(
        sql(`select coalesce(mengantar_pickup_address_id, '') from public.outlets where id = '${IDS.outletA}'`),
      ).toBe("");

      // Status reflects partner_managed + connected without leaking secret material
      const statusConnected = await operatorA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(statusConnected.error).toBeNull();
      expect(statusConnected.data![0]).toMatchObject({
        connection_mode: "partner_managed",
        onboarding_state: "connected",
        partner_seller_id: SELLER_ID,
        owner_email: "budi.updated@gerai-uji.id",
        last_error_code: null,
      });
      expect(JSON.stringify(statusConnected.data)).not.toMatch(/PARTNERSECRETKEY|ciphertext/);

      // Cannot re-run begin_partner_seller_onboarding while already connected
      expect(
        (await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs())).error?.message,
      ).toBe("already_partner_connected");
    } finally {
      sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);
      sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null`);
    }
  });
});
