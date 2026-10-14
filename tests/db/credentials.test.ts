// PR-18 / PR-26 / IAM-3 / SEC-3 / DATA-4 / DEC-006: only a tenant admin of a real gerai stores
// its seller key; storage is ciphertext-only, versioned, never readable back through any API.
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { IDS, client, demoVisitor, signIn, signInAal2, sql } from "./helpers";

const SEAL_KEY = Buffer.alloc(32, 3).toString("base64");
const PLAIN = "mk_test_PLAINTEXTSECRETVALUE9876";

async function sealedFor(tenant: string, version: number) {
  const s = await sealCredential(PLAIN, credentialAad(tenant, version), SEAL_KEY);
  return { p_ciphertext: s.ciphertext, p_iv: s.iv, p_key_version: s.keyVersion, p_hint: "9876" };
}

function latest(tenant: string) {
  return Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${tenant}'`));
}

describe("who may store a seller key (IAM-3)", () => {
  it("operators, foreign admins, demo admins and outsiders cannot", async () => {
    const v = latest(IDS.tenantA);
    const args = { p_tenant: IDS.tenantA, p_expected_version: v, ...(await sealedFor(IDS.tenantA, v + 1)) };
    for (const c of [await signIn("operator-a@geraiexpress.test"), await signIn("owner-b@geraiexpress.test"), client()]) {
      expect((await c.rpc("store_seller_credential", args)).error).not.toBeNull();
    }
    const demo = await demoVisitor();
    expect((await demo.c.rpc("store_seller_credential", { ...args, p_tenant: demo.tenant, p_expected_version: 0 })).error?.message).toBe("demo_restricted");
    expect(latest(IDS.tenantA)).toBe(v);
  });
});

describe("storage (SEC-3 / DATA-4)", () => {
  it("is ciphertext-only, versioned, one active key, and never readable back", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const operator = await signIn("operator-a@geraiexpress.test");
    const v = latest(IDS.tenantA);
    expect((await owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 3, ...(await sealedFor(IDS.tenantA, v + 4)) })).error?.message).toBe("stale_state");
    const stored = await owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, ...(await sealedFor(IDS.tenantA, v + 1)) });
    expect(stored.error).toBeNull();
    expect(stored.data).toBe(v + 1);
    const replaced = await owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 1, ...(await sealedFor(IDS.tenantA, v + 2)) });
    expect(replaced.data).toBe(v + 2);
    expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and superseded_at is null`)).toBe("1");
    // A replaced key keeps no ciphertext, only its version metadata.
    expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and superseded_at is not null and (ciphertext is not null or iv is not null)`)).toBe("0");
    expect((await operator.rpc("remove_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 2 })).error?.message).toBe("admin_required");
    // Nothing at rest or in any projection contains the key.
    expect(sql(`select count(*) from private.seller_credentials where ciphertext like '%PLAINTEXT%'`)).toBe("0");
    expect(sql(`select count(*) from public.audit_events where detail::text like '%PLAINTEXT%' or detail::text like '%ciphertext%'`)).toBe("0");
    const status = await operator.rpc("seller_credential_status", { p_tenant: IDS.tenantA });
    expect(status.data![0]).toMatchObject({ configured: true, hint: "9876", version: v + 2 });
    expect(JSON.stringify(status.data)).not.toMatch(/PLAINTEXT|ciphertext|"iv"/);
    expect((await owner.schema("private").from("seller_credentials").select("*")).error).not.toBeNull();
    // Foreign members learn nothing.
    expect((await (await signIn("owner-b@geraiexpress.test")).rpc("seller_credential_status", { p_tenant: IDS.tenantA })).error?.message).toBe("not_found");
    // Removal keeps versions monotonic, so an old ciphertext can never match a new version's binding.
    expect((await owner.rpc("remove_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 2 })).error).toBeNull();
    expect((await operator.rpc("seller_credential_status", { p_tenant: IDS.tenantA })).data![0]).toMatchObject({ configured: false, latest_version: v + 2 });
    expect((await owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 2, ...(await sealedFor(IDS.tenantA, v + 3)) })).data).toBe(v + 3);
    expect((await owner.rpc("remove_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v + 3 })).error).toBeNull();
  });
});

describe("suspended gerai", () => {
  it("its admin cannot store a key", async () => {
    const TENANT_C = "00000000-0000-4000-b000-00000000000c";
    const ownerC = await signIn("owner-c@geraiexpress.test");
    sql(`update public.tenants set lifecycle = 'suspended' where id = '${TENANT_C}'`);
    try {
      expect((await ownerC.rpc("store_seller_credential", { p_tenant: TENANT_C, p_expected_version: 0, ...(await sealedFor(TENANT_C, 1)) })).error?.message).toBe("admin_required");
    } finally {
      sql(`update public.tenants set lifecycle = 'active' where id = '${TENANT_C}'`);
    }
  });
});

describe("platform integration readiness (PR-26)", () => {
  it("needs integration_operations at aal2 and shows state, never values", async () => {
    expect((await (await signIn("admin@geraiexpress.test")).rpc("platform_integrations")).error?.message).toBe("platform_access_required");
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_partner_config")).error?.message).toBe("platform_access_required");
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_integrations");
    expect(error).toBeNull();
    expect(Object.keys((data as object[])[0]).sort()).toEqual(["configured", "hint", "lifecycle", "mode", "stored_at", "tenant_id", "tenant_name", "version"]);
    expect((await admin.rpc("platform_set_partner_id", { p_partner_id: "bad id with spaces", p_reason: "Uji partner" })).error?.message).toBe("invalid_partner_id");
    expect((await admin.rpc("platform_set_partner_id", { p_partner_id: "gx-partner-01", p_reason: "Uji partner" })).error).toBeNull();
    expect((await admin.rpc("platform_partner_config")).data).toEqual([{ partner_id: "gx-partner-01" }]);
    expect((await admin.rpc("platform_set_partner_id", { p_partner_id: "", p_reason: "Kosongkan lagi" })).error).toBeNull();
  });
});
