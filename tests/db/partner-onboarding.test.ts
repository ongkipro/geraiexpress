// T-027 / PR-17 / PR-20 / DEC-006: database tests for Partner seller onboarding RPCs,
// consent enforcement, role/demo/cross-tenant refusal, immutable external_user_id,
// 503 partial-provisioning seller_id preservation, 409 existing_account_required, and completion.
// T-032 (SEC-01 / DIL-01): record/complete are service_role-only, the seller id is unique and
// write-once, and only tenant admins read it.

import { beforeEach, describe, expect, it } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { IDS, client, demoVisitor, machine, signIn, sql } from "./helpers";

const SEAL_KEY = Buffer.alloc(32, 5).toString("base64");
const PLAIN_KEY = "API-PARTNERSECRETKEY9876";
const SELLER_ID = "66ab1234567890abcdef1234";

async function sealedFor(tenant: string, version: number) {
  const s = await sealCredential(PLAIN_KEY, credentialAad(tenant, version), SEAL_KEY);
  return {
    p_ciphertext: s.ciphertext,
    p_expected_version: version - 1,
    p_iv: s.iv,
    p_key_version: s.keyVersion,
    p_hint: "9876",
    p_env: "sandbox",
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

// T-057: the server synchronizes the configured consent versions before every begin.
const syncConsent = (terms = "2026-10", privacy = "2026-10", env = "sandbox") =>
  machine().rpc("sync_partner_consent_versions", { p_env: env, p_terms_version: terms, p_privacy_version: privacy });
beforeEach(async () => {
  expect((await syncConsent()).error).toBeNull();
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
    const worker = machine();

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
      const outcome409 = await worker.rpc("record_partner_seller_onboarding_outcome", {
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
      const outcome503 = await worker.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA,
        p_state: "registered_key_pending",
        p_seller_id: SELLER_ID,
        p_error_code: "KEY_PROVISIONING_FAILED",
        p_retry_after_seconds: 15,
      });
      expect(outcome503.error).toBeNull();

      const consentBefore = sql(`select row(owner_name, owner_email, owner_phone, terms_version, privacy_version,
        consent_actor_id, consent_recorded_at)::text from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);
      expect((await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs())).error?.message).toBe("partner_retry_after");
      sql(`update private.tenant_mengantar_onboarding set retry_after_at = now() - interval '1 second' where tenant_id = '${IDS.tenantA}'`);
      const changed = {
        ...validBeginArgs(),
        p_owner_email: "budi.updated@gerai-uji.id",
        p_owner_name: "Pemilik Berbeda",
        p_owner_phone: "081299998888",
      };
      // T-057: versions other than the server's are refused outright.
      expect((await ownerA.rpc("begin_partner_seller_onboarding", {
        ...changed, p_terms_version: "posted-other", p_privacy_version: "posted-other",
      })).error?.message).toBe("consent_version_mismatch");
      const beginRetry = await ownerA.rpc("begin_partner_seller_onboarding", changed);
      expect(beginRetry.error).toBeNull();
      expect(beginRetry.data).toMatchObject({
        external_user_id: expectedExtId,
        partner_seller_id: SELLER_ID,
      });
      expect(sql(`select row(owner_name, owner_email, owner_phone, terms_version, privacy_version,
        consent_actor_id, consent_recorded_at)::text from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`)).toBe(consentBefore);

      // 4. Complete onboarding and verify key sealing + pickup clearing + already_partner_connected guard
      const latestVer = Number((beginRetry.data as { latest_credential_version: number }).latest_credential_version);
      sql(`update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca', mengantar_area_id = '5fc62f60f8f44b34aa4c0dcd' where id = '${IDS.outletA}'`);

      const completed = await worker.rpc("complete_partner_seller_onboarding", {
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
        // T-032: the operator sees state only, never the seller id or the owner's details.
        partner_seller_id: null,
        owner_name: null,
        owner_email: null,
        owner_phone: null,
        last_error_code: null,
      });
      expect(JSON.stringify(statusConnected.data)).not.toMatch(/PARTNERSECRETKEY|ciphertext/);
      const adminStatus = await ownerA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(adminStatus.data![0]).toMatchObject({
        partner_seller_id: SELLER_ID,
        owner_email: "budi.santoso@gerai-uji.id",
      });

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

describe("Partner seller binding is machine-attested (T-032 / SEC-01 / DIL-01)", () => {
  const OTHER_SELLER = "77cd1234567890abcdef5678";
  const rowOf = (tenant: string) =>
    sql(`select coalesce(onboarding_state, '') || '|' || coalesce(partner_seller_id, '') || '|' || coalesce(last_error_code, '') from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`);
  const reset = () => {
    for (const t of [IDS.tenantA, IDS.tenantB]) {
      sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${t}'`);
      sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${t}' and superseded_at is null`);
    }
  };

  it("grants the two writers to service_role only", () => {
    for (const fn of [
      "public.record_partner_seller_onboarding_outcome(uuid, text, text, text, integer)",
      "public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer, text)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        expect(sql(`select has_function_privilege('${role}', '${fn}', 'execute')`)).toBe("f");
      }
      // No PUBLIC grant either (an empty grantee in the ACL).
      expect(sql(`select coalesce(proacl::text, '') ~ '(^\\{|,)=X' from pg_proc where oid = '${fn}'::regprocedure`)).toBe("f");
      expect(sql(`select has_function_privilege('service_role', '${fn}', 'execute')`)).toBe("t");
    }
    // begin stays callable by tenant admins and takes no seller id.
    expect(
      sql("select has_function_privilege('authenticated', 'public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean)', 'execute')"),
    ).toBe("t");
    expect(
      sql("select pg_get_function_arguments('public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean)'::regprocedure)"),
    ).not.toMatch(/seller/);
  });

  it("refuses tenant B's admin (42501) when it passes tenant A's seller id to either RPC, with no row change", async () => {
    reset();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const ownerB = await signIn("owner-b@geraiexpress.test");
    const worker = machine();
    try {
      expect((await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error).toBeNull();
      expect(
        (await worker.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
          p_error_code: "KEY_PROVISIONING_FAILED", p_retry_after_seconds: null,
        })).error,
      ).toBeNull();
      expect((await ownerB.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantB))).error).toBeNull();
      const beforeA = rowOf(IDS.tenantA);
      const beforeB = rowOf(IDS.tenantB);
      const credsBefore = sql("select count(*) from private.seller_credentials");

      for (const tenant of [IDS.tenantA, IDS.tenantB]) {
        const rec = await ownerB.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: tenant, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
          p_error_code: null, p_retry_after_seconds: null,
        });
        expect(rec.error?.code).toBe("42501");
        const done = await ownerB.rpc("complete_partner_seller_onboarding", {
          p_tenant: tenant, p_seller_id: SELLER_ID, ...(await sealedFor(tenant, 1)),
        });
        expect(done.error?.code).toBe("42501");
      }
      // Tenant A's own admin has no direct path either (machine-only, not just cross-tenant).
      expect(
        (await ownerA.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: OTHER_SELLER,
        })).error?.code,
      ).toBe("42501");

      expect(rowOf(IDS.tenantA)).toBe(beforeA);
      expect(rowOf(IDS.tenantB)).toBe(beforeB);
      expect(sql("select count(*) from private.seller_credentials")).toBe(credsBefore);
      expect(beforeA).toContain(SELLER_ID);
      expect(beforeB).not.toContain(SELLER_ID);
    } finally {
      reset();
    }
  });

  it("lets operators read state only, never the seller id or owner details", async () => {
    reset();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const operatorA = await signIn("operator-a@geraiexpress.test");
    const worker = machine();
    try {
      expect((await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error).toBeNull();
      await worker.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
        p_error_code: "KEY_PROVISIONING_FAILED", p_retry_after_seconds: 15,
      });
      const op = await operatorA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(op.error).toBeNull();
      expect(op.data![0]).toMatchObject({
        onboarding_state: "registered_key_pending",
        last_error_code: "KEY_PROVISIONING_FAILED",
        partner_seller_id: null,
        owner_name: null,
        owner_email: null,
        owner_phone: null,
      });
      expect(JSON.stringify(op.data)).not.toContain(SELLER_ID);
      const admin = await ownerA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(admin.data![0]).toMatchObject({ partner_seller_id: SELLER_ID, owner_name: "Budi Santoso" });
    } finally {
      reset();
    }
  });

  it("enforces a unique and write-once partner_seller_id", async () => {
    reset();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const ownerB = await signIn("owner-b@geraiexpress.test");
    const worker = machine();
    try {
      expect((await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantA))).error).toBeNull();
      expect((await ownerB.rpc("begin_partner_seller_onboarding", validBeginArgs(IDS.tenantB))).error).toBeNull();
      expect(
        (await worker.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
        })).error,
      ).toBeNull();

      // Unique: the same id cannot be bound to a second tenant, by SQL or by the machine RPC.
      expect(() =>
        sql(`update private.tenant_mengantar_onboarding set partner_seller_id = '${SELLER_ID}' where tenant_id = '${IDS.tenantB}'`),
      ).toThrow(/tenant_mengantar_onboarding_partner_seller_uniq/);
      const dupe = await worker.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantB, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
      });
      expect(dupe.error?.message).toBe("seller_binding_conflict");
      const dupeComplete = await worker.rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantB, p_seller_id: SELLER_ID,
        ...(await sealedFor(IDS.tenantB, Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${IDS.tenantB}'`)) + 1)),
      });
      expect(dupeComplete.error?.message).toBe("seller_binding_conflict");
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantB}' and superseded_at is null`)).toBe("0");
      expect(rowOf(IDS.tenantB)).not.toContain(SELLER_ID);

      // Write-once: a bound id cannot change, even for the machine or superuser SQL.
      expect(() =>
        sql(`update private.tenant_mengantar_onboarding set partner_seller_id = '${OTHER_SELLER}' where tenant_id = '${IDS.tenantA}'`),
      ).toThrow(/immutable_partner_seller_id/);
      expect(() =>
        sql(`update private.tenant_mengantar_onboarding set partner_seller_id = null where tenant_id = '${IDS.tenantA}'`),
      ).toThrow(/immutable_partner_seller_id/);
      const swap = await worker.rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: OTHER_SELLER,
      });
      expect(swap.error?.message).toBe("seller_binding_mismatch");
      const swapComplete = await worker.rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantA, p_seller_id: OTHER_SELLER, ...(await sealedFor(IDS.tenantA, 1)),
      });
      expect(swapComplete.error?.message).toBe("seller_binding_mismatch");
      expect(rowOf(IDS.tenantA)).toContain(SELLER_ID);
      // An unchanged id and an omitted id are fine (recovery path).
      expect(
        (await worker.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: IDS.tenantA, p_state: "quota_wait", p_seller_id: SELLER_ID, p_error_code: "RATE_LIMITED",
        })).error,
      ).toBeNull();
      expect(
        (await worker.rpc("record_partner_seller_onboarding_outcome", {
          p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: null,
        })).error,
      ).toBeNull();
      expect(rowOf(IDS.tenantA)).toContain(SELLER_ID);
    } finally {
      reset();
    }
  });

  it("refuses machine writes for demo tenants and for tenants that never began onboarding", async () => {
    reset();
    const demo = await demoVisitor();
    const worker = machine();
    expect(
      (await worker.rpc("record_partner_seller_onboarding_outcome", { p_tenant: demo.tenant, p_state: "quota_wait" })).error?.message,
    ).toBe("demo_restricted");
    expect(
      (await worker.rpc("record_partner_seller_onboarding_outcome", { p_tenant: IDS.tenantA, p_state: "quota_wait" })).error?.message,
    ).toBe("consent_required");
    expect(
      (await worker.rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantA, p_seller_id: SELLER_ID, ...(await sealedFor(IDS.tenantA, 1)),
      })).error?.message,
    ).toBe("consent_required");
  });
});

describe("credential completion version fence and consent-preserving recovery (T-034)", () => {
  const reset = () => {
    sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}';
      update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null
      where tenant_id = '${IDS.tenantA}' and superseded_at is null`);
  };
  const activeKey = async () => {
    const row = (await machine().rpc("machine_seller_key", { p_tenant: IDS.tenantA, p_env: "sandbox" })).data;
    expect(row).not.toBeNull();
    return { row, plain: await openCredential(row, credentialAad(IDS.tenantA, row.version), SEAL_KEY) };
  };

  it("refuses a stale or NULL expected version before clearing a concurrent BYOK key", async () => {
    reset();
    const owner = await signIn("owner-a@geraiexpress.test");
    try {
      const begun = await owner.rpc("begin_partner_seller_onboarding", validBeginArgs());
      expect(begun.error).toBeNull();
      const version = begun.data.latest_credential_version as number;
      expect((await owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, ...await sealedFor(IDS.tenantA, version + 1) })).error).toBeNull();
      const before = await activeKey();
      for (const expected of [version, null]) {
        const completed = await machine().rpc("complete_partner_seller_onboarding", {
          p_tenant: IDS.tenantA, p_seller_id: SELLER_ID,
          ...await sealedFor(IDS.tenantA, version + 1), p_expected_version: expected,
        });
        expect(completed.error).toMatchObject({ code: "55000", message: "stale_state" });
        expect(await activeKey()).toEqual(before);
      }
      expect(before.plain).toBe(PLAIN_KEY);
      expect(sql(`select mode from private.seller_credentials where tenant_id = '${IDS.tenantA}' and superseded_at is null`)).toBe("byok");
      expect(sql(`select coalesce(partner_seller_id, '') from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`)).toBe("");
    } finally { reset(); }
  });

  it("allows only one of two overlapping completions sealed at the same begin version", async () => {
    reset();
    const owner = await signIn("owner-a@geraiexpress.test");
    try {
      // Both requests finish begin and sealing before either completion can start.
      const begins = await Promise.all([
        owner.rpc("begin_partner_seller_onboarding", validBeginArgs()),
        owner.rpc("begin_partner_seller_onboarding", validBeginArgs()),
      ]);
      expect(begins.map((r) => r.error)).toEqual([null, null]);
      const version = begins[0].data.latest_credential_version as number;
      expect(begins[1].data.latest_credential_version).toBe(version);
      const sealed = await Promise.all([sealedFor(IDS.tenantA, version + 1), sealedFor(IDS.tenantA, version + 1)]);
      const results = await Promise.all(sealed.map((key) => machine().rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantA, p_seller_id: SELLER_ID, ...key,
      })));
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(results.find((r) => r.error)?.error).toMatchObject({ code: "55000", message: "stale_state" });
      const active = await activeKey();
      expect(active.row.version).toBe(version + 1);
      expect(active.plain).toBe(PLAIN_KEY);
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and version > ${version}`)).toBe("1");
    } finally { reset(); }
  });

  it("requires persisted consent, a bound pending seller and admin scope; recovery never rewrites provenance", async () => {
    reset();
    const owner = await signIn("owner-a@geraiexpress.test");
    const recover = (c = owner) => c.rpc("begin_partner_seller_key_recovery", { p_tenant: IDS.tenantA });
    try {
      expect((await recover()).error?.message).toBe("consent_required");
      expect((await recover(await signIn("operator-a@geraiexpress.test"))).error?.message).toBe("admin_required");
      expect((await recover(await signIn("owner-b@geraiexpress.test"))).error?.message).toBe("admin_required");
      expect((await owner.rpc("begin_partner_seller_onboarding", validBeginArgs())).error).toBeNull();
      expect((await recover()).error?.message).toBe("not_recoverable");
      expect((await machine().rpc("record_partner_seller_onboarding_outcome", {
        p_tenant: IDS.tenantA, p_state: "registered_key_pending", p_seller_id: SELLER_ID,
      })).error).toBeNull();
      const before = sql(`select to_jsonb(o)::text from private.tenant_mengantar_onboarding o where tenant_id = '${IDS.tenantA}'`);
      const result = await recover();
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        owner_email: "budi.santoso@gerai-uji.id", terms_version: "2026-10", privacy_version: "2026-10",
        consent_actor_id: (await owner.auth.getUser()).data.user!.id,
      });
      expect(sql(`select to_jsonb(o)::text from private.tenant_mengantar_onboarding o where tenant_id = '${IDS.tenantA}'`)).toBe(before);
      expect(() => sql(`update private.tenant_mengantar_onboarding set owner_email = 'changed@gerai-uji.id' where tenant_id = '${IDS.tenantA}'`))
        .toThrow(/immutable_partner_owner_consent/);
      expect((await machine().rpc("complete_partner_seller_onboarding", {
        p_tenant: IDS.tenantA, p_seller_id: SELLER_ID,
        ...await sealedFor(IDS.tenantA, result.data.latest_credential_version + 1),
      })).error).toBeNull();
      const original = JSON.parse(before);
      const after = JSON.parse(sql(`select to_jsonb(o)::text from private.tenant_mengantar_onboarding o where tenant_id = '${IDS.tenantA}'`));
      for (const key of ["owner_name", "owner_email", "owner_phone", "consent_actor_id", "consent_recorded_at", "terms_version", "privacy_version"]) {
        expect(after[key], key).toBe(original[key]);
      }
      expect((await recover()).error?.message).toBe("not_recoverable");
    } finally { reset(); }
  });
});

describe("server-synchronized consent versions and outcome fence (T-057)", () => {
  const settings = () => sql(`select coalesce(string_agg(key || '=' || value::text, ',' order by key), '') from private.settings where key like 'partner_consent_versions:%'`);

  it("lets only the machine identity synchronize versions, per environment, and validates them", async () => {
    const ownerA = await signIn("owner-a@geraiexpress.test");
    expect((await ownerA.rpc("sync_partner_consent_versions", { p_env: "sandbox", p_terms_version: "x", p_privacy_version: "x" })).error).not.toBeNull();
    expect((await client().rpc("sync_partner_consent_versions", { p_env: "sandbox", p_terms_version: "x", p_privacy_version: "x" })).error).not.toBeNull();
    expect((await syncConsent("t", "p", "staging")).error?.message).toBe("invalid_environment");
    expect((await syncConsent(" ", "p")).error?.message).toBe("invalid_input");
    expect((await syncConsent("t".repeat(65), "p")).error?.message).toBe("invalid_input");
    expect((await syncConsent("2026-11", "2026-11", "production")).error).toBeNull();
    expect(settings()).toContain('partner_consent_versions:production={"terms": "2026-11", "privacy": "2026-11"}');
    expect(settings()).toContain('partner_consent_versions:sandbox={"terms": "2026-10", "privacy": "2026-10"}');
  });

  it("refuses a begin with unconfigured or mismatched versions before any row is written", async () => {
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const row = () => sql(`select count(*) from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);
    const before = row();
    expect((await ownerA.rpc("begin_partner_seller_onboarding", { ...validBeginArgs(), p_privacy_version: "2026-09" })).error?.message)
      .toBe("consent_version_mismatch");
    sql(`delete from private.settings where key = 'partner_consent_versions:sandbox'`);
    const unconfigured = await ownerA.rpc("begin_partner_seller_onboarding", validBeginArgs());
    expect([unconfigured.error?.message, unconfigured.error?.code]).toEqual(["consent_versions_unconfigured", "55000"]);
    expect(row()).toBe(before);
  });

  it("refuses an onboarding outcome while a key rotation is unknown and leaves the state unchanged; a normal outcome still works", async () => {
    const tenant = IDS.tenantB;
    const owner = sql(`select id from auth.users where email = 'owner-b@geraiexpress.test'`);
    const existed = sql(`select count(*) from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`) === "1";
    sql(`insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
        owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, consent_recorded_at)
      values ('${tenant}', 'geraiexpress:tenant:${tenant}', 'none', 'registration_pending', 'Budi', 'budi@gerai-uji.id',
        '081234567890', '2026-10', '2026-10', '${owner}', now())
      on conflict (tenant_id) do nothing`);
    const state = () => sql(`select onboarding_state || '|' || coalesce(last_error_code, '') from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`);
    const original = sql(`select onboarding_state from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`);
    try {
      expect((await machine().rpc("record_partner_seller_onboarding_outcome", { p_tenant: tenant, p_state: "quota_wait",
        p_seller_id: null, p_error_code: "RATE_LIMITED", p_retry_after_seconds: null })).error).toBeNull();
      expect(state()).toBe("quota_wait|RATE_LIMITED");
      sql(`update private.tenant_mengantar_onboarding set onboarding_state = 'rotation_unknown', last_error_code = 'ROTATION_STARTED' where tenant_id = '${tenant}'`);
      const refused = await machine().rpc("record_partner_seller_onboarding_outcome", { p_tenant: tenant, p_state: "quota_wait",
        p_seller_id: null, p_error_code: "RATE_LIMITED", p_retry_after_seconds: null });
      expect([refused.error?.message, refused.error?.code]).toEqual(["rotation_unknown", "55000"]);
      expect(state()).toBe("rotation_unknown|ROTATION_STARTED");
    } finally {
      if (existed) sql(`update private.tenant_mengantar_onboarding set onboarding_state = '${original}', last_error_code = null, retry_after_at = null where tenant_id = '${tenant}'`);
      else sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`);
    }
  });
});
