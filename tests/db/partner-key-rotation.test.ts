// T-039 / PR-19 / DEC-013: database contract of Partner key regeneration and recovery. The Worker
// proves the actor with the user's session and the seller with Mengantar before calling the
// machine-only writers; here the writers are called directly as the machine identity.

import { describe, expect, it } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { IDS, demoVisitor, machine, signIn, signInAal2, sql } from "./helpers";

const SEAL_KEY = Buffer.alloc(32, 5).toString("base64");
const SELLER_ID = "66ab1234567890abcdef1234";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
const OWNER_B = "00000000-0000-4000-a000-0000000000b1";
const PICKUP = { address: "6acf44a4771fe2b474c055ca", area: "5fc62f60f8f44b34aa4c0dcd" };
const FENCE = "public.fence_partner_key_rotation(uuid, uuid, text, integer, text)";
const OUTCOME = "public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer, text)";
const STORE = "public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text, text)";

const latestVersion = (tenant: string) =>
  Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${tenant}'`));
const onboarding = (tenant: string) =>
  sql(`select onboarding_state || '|' || coalesce(last_error_code, '') || '|' || connection_mode from private.tenant_mengantar_onboarding where tenant_id = '${tenant}'`);
const activeRow = (tenant: string) =>
  sql(`select mode || '|' || version || '|' || (ciphertext is not null) from private.seller_credentials where tenant_id = '${tenant}' and superseded_at is null`);
const pickup = () => sql(`select coalesce(mengantar_pickup_address_id, '') from public.outlets where id = '${IDS.outletA}'`);
const auditFloor = () => Number(sql("select coalesce(max(id), 0) from public.audit_events"));
const auditSince = (floor: number, tenant = IDS.tenantA) =>
  sql(`select string_agg(action || '|' || outcome || '|' || coalesce(actor::text, 'null'), E'\\n' order by id) from public.audit_events where id > ${floor} and target_tenant = '${tenant}' and action like 'credential.partner_%'`)
    .split("\n").filter(Boolean);

async function sealed(tenant: string, version: number, plain = "API-ROTATEDKEY0000AB") {
  const s = await sealCredential(plain, credentialAad(tenant, version), SEAL_KEY);
  return { p_ciphertext: s.ciphertext, p_iv: s.iv, p_key_version: s.keyVersion, p_hint: plain.slice(-2), p_env: "sandbox" };
}

function reset() {
  for (const t of [IDS.tenantA, IDS.tenantB]) {
    sql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${t}'`);
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${t}' and superseded_at is null`);
  }
  sql(`update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null where id = '${IDS.outletA}'`);
}

// A connected Partner-managed tenant: onboarding row, one active Partner credential, a chosen pickup.
async function seedPartner(tenant = IDS.tenantA): Promise<number> {
  reset();
  sql(`insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
      partner_seller_id, owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id)
    values ('${tenant}', 'geraiexpress:tenant:${tenant}', 'partner_managed', 'connected', '${SELLER_ID}',
      'Budi Santoso', 'budi.santoso@gerai-uji.id', '081234567890', 'terms-1', 'privacy-1', '${OWNER_A}')`);
  const version = latestVersion(tenant) + 1;
  const s = await sealed(tenant, version, "API-SEEDKEYPARTNER001");
  sql(`insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
    values ('${tenant}', 'partner', '${s.p_ciphertext}', '${s.p_iv}', '${s.p_key_version}', '01', ${version})`);
  sql(`update public.outlets set mengantar_pickup_address_id = '${PICKUP.address}', mengantar_area_id = '${PICKUP.area}' where id = '${IDS.outletA}'`);
  return version;
}

const args = (version: number, extra: Record<string, unknown> = {}, actor = OWNER_A, tenant = IDS.tenantA, seller = SELLER_ID) =>
  ({ p_tenant: tenant, p_actor: actor, p_seller_id: seller, p_expected_version: version, p_env: "sandbox", ...extra });

describe("key rotation functions are machine-only (T-039)", () => {
  it("grants the three writers to service_role only and begin to authenticated only", async () => {
    for (const fn of [FENCE, OUTCOME, STORE]) {
      for (const role of ["anon", "authenticated"]) expect(sql(`select has_function_privilege('${role}', '${fn}', 'execute')`)).toBe("f");
      expect(sql(`select coalesce(proacl::text, '') ~ '(^\\{|,)=X' from pg_proc where oid = '${fn}'::regprocedure`)).toBe("f");
      expect(sql(`select has_function_privilege('service_role', '${fn}', 'execute')`)).toBe("t");
      expect(sql(`select (prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))::text from pg_proc where oid = '${fn}'::regprocedure`)).toBe("true");
    }
    expect(sql("select has_function_privilege('authenticated', 'public.begin_partner_key_rotation(uuid)', 'execute')")).toBe("t");
    expect(sql("select has_function_privilege('anon', 'public.begin_partner_key_rotation(uuid)', 'execute')")).toBe("f");
    expect(sql("select has_function_privilege('authenticated', 'private.lock_partner_rotation(uuid, uuid, text)', 'execute')")).toBe("f");

    const v = await seedPartner();
    try {
      const ownerA = await signIn("owner-a@geraiexpress.test");
      for (const [fn, a] of [
        ["fence_partner_key_rotation", args(v)],
        ["record_partner_key_rotation_outcome", args(v, { p_state: "rotation_unknown", p_error_code: null, p_retry_after_seconds: null })],
        ["store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "recovered" })],
      ] as const) {
        expect((await ownerA.rpc(fn, a)).error?.code, `${fn} as the tenant admin`).toBe("42501");
      }
      expect(activeRow(IDS.tenantA)).toBe(`partner|${v}|true`);
    } finally {
      reset();
    }
  });
});

describe("begin_partner_key_rotation (T-039)", () => {
  it("returns facts to the tenant admin only, never key material", async () => {
    const v = await seedPartner();
    try {
      const ownerA = await signIn("owner-a@geraiexpress.test");
      const res = await ownerA.rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA });
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({
        connection_mode: "partner_managed", onboarding_state: "connected", partner_seller_id: SELLER_ID,
        external_user_id: `geraiexpress:tenant:${IDS.tenantA}`, active_credential_mode: "partner",
        active_credential_version: v, latest_credential_version: v,
      });
      expect(JSON.stringify(res.data)).not.toMatch(/ciphertext|"iv"|api_key|callback/i);

      expect((await (await signIn("operator-a@geraiexpress.test")).rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error?.message).toBe("admin_required");
      expect((await (await signIn("owner-b@geraiexpress.test")).rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error?.message).toBe("admin_required");
      const demo = await demoVisitor();
      expect((await demo.c.rpc("begin_partner_key_rotation", { p_tenant: demo.tenant })).error?.message).toBe("demo_restricted");
    } finally {
      reset();
    }
  });
});

describe("regeneration and recovery cycle (T-039)", () => {
  it("fences, stores the regenerated key with the version fence, keeps pickup and audits actor and outcome", async () => {
    const v = await seedPartner();
    const floor = auditFloor();
    const worker = machine();
    try {
      const fenced = await worker.rpc("fence_partner_key_rotation", args(v));
      expect(fenced.error).toBeNull();
      expect(fenced.data).toBe(v);
      // No reader can open a key while the marker says unknown: the active credential is gone.
      expect(onboarding(IDS.tenantA)).toBe("rotation_unknown|ROTATION_STARTED|partner_managed");
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and superseded_at is null`)).toBe("0");
      expect(sql(`select (ciphertext is null and iv is null and superseded_at is not null)::text from private.seller_credentials where tenant_id = '${IDS.tenantA}' and version = ${v}`)).toBe("true");
      expect((await worker.rpc("machine_seller_key", { p_tenant: IDS.tenantA, p_env: "sandbox" })).data).toBeNull();
      const operatorA = await signIn("operator-a@geraiexpress.test");
      const ownerA = await signIn("owner-a@geraiexpress.test");
      expect((await ownerA.rpc("seller_credential_status", { p_tenant: IDS.tenantA })).data![0]).toMatchObject({ configured: false, latest_version: v });
      // The marker is visible through the existing status read, including to operators (state only).
      const status = await operatorA.rpc("partner_onboarding_status", { p_tenant: IDS.tenantA });
      expect(status.data![0]).toMatchObject({ connection_mode: "partner_managed", onboarding_state: "rotation_unknown", last_error_code: "ROTATION_STARTED", partner_seller_id: null });
      // Same Partner seller: its pickup address stays valid.
      expect(pickup()).toBe(PICKUP.address);

      // A second fence (second admin, double click) is refused: nothing is active any more.
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error?.message).toBe("stale_state");

      const stored = await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "regenerated" }));
      expect(stored.error).toBeNull();
      expect(stored.data).toBe(v + 1);
      expect(activeRow(IDS.tenantA)).toBe(`partner|${v + 1}|true`);
      expect(onboarding(IDS.tenantA)).toBe("connected||partner_managed");
      expect(pickup()).toBe(PICKUP.address);
      const key = (await worker.rpc("machine_seller_key", { p_tenant: IDS.tenantA, p_env: "sandbox" })).data as { ciphertext: string; iv: string; version: number };
      expect(key.version).toBe(v + 1);
      expect(await openCredential(key, credentialAad(IDS.tenantA, v + 1), SEAL_KEY)).toBe("API-ROTATEDKEY0000AB");

      expect(auditSince(floor)).toEqual([
        `credential.partner_rotation_unknown|fenced|${OWNER_A}`,
        `credential.partner_regenerated|stored|${OWNER_A}`,
      ]);
      const detail = sql(`select string_agg(detail::text, ' ') from public.audit_events where id > ${floor} and target_tenant = '${IDS.tenantA}'`);
      expect(detail).not.toMatch(/ciphertext|API-ROTATED|callback/i);
    } finally {
      reset();
    }
  });

  it("a lost response keeps the marker with Retry-After recorded; recovery stores the current key and is audited as recovered", async () => {
    const v = await seedPartner();
    const floor = auditFloor();
    const worker = machine();
    try {
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error).toBeNull();
      const lost = await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "rotation_unknown", p_error_code: "UNAVAILABLE", p_retry_after_seconds: 23 }));
      expect(lost.error).toBeNull();
      expect(onboarding(IDS.tenantA)).toBe("rotation_unknown|UNAVAILABLE|partner_managed");
      expect(Number(sql(`select extract(epoch from retry_after_at - now()) from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`))).toBeGreaterThan(10);
      expect((await worker.rpc("machine_seller_key", { p_tenant: IDS.tenantA, p_env: "sandbox" })).data).toBeNull();

      const recovered = await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1, "API-CURRENTKEY0000CD")), p_source: "recovered" }));
      expect(recovered.error).toBeNull();
      expect(onboarding(IDS.tenantA)).toBe("connected||partner_managed");
      expect(sql(`select retry_after_at is null from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`)).toBe("t");
      expect(auditSince(floor)).toEqual([
        `credential.partner_rotation_unknown|fenced|${OWNER_A}`,
        `credential.partner_rotation_unknown|rotation_unknown|${OWNER_A}`,
        `credential.partner_recovered|stored|${OWNER_A}`,
      ]);
    } finally {
      reset();
    }
  });

  it("a stop state ends the flow: no further fence, outcome or store is accepted", async () => {
    const v = await seedPartner();
    const floor = auditFloor();
    const worker = machine();
    try {
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error).toBeNull();
      expect((await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "provider_restricted", p_error_code: "API_KEY_DISABLED", p_retry_after_seconds: null }))).error).toBeNull();
      expect(onboarding(IDS.tenantA)).toBe("provider_restricted|API_KEY_DISABLED|partner_managed");
      const operator = (await (await signIn("operator-a@geraiexpress.test")).rpc("partner_onboarding_status", { p_tenant: IDS.tenantA })).data![0];
      expect(operator).toMatchObject({ onboarding_state: "provider_restricted", last_error_code: "API_KEY_DISABLED" });

      const again = [
        await worker.rpc("fence_partner_key_rotation", args(v)),
        await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "rotation_unknown", p_error_code: null, p_retry_after_seconds: null })),
        await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "recovered" })),
      ];
      expect(again.map((r) => r.error?.message)).toEqual(["provider_restricted", "rotation_not_available", "rotation_not_available"]);
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and superseded_at is null`)).toBe("0");
      expect(auditSince(floor)).toEqual([
        `credential.partner_rotation_unknown|fenced|${OWNER_A}`,
        `credential.partner_rotation_refused|provider_restricted|${OWNER_A}`,
      ]);
    } finally {
      reset();
    }
  });

  it("records a binding failure as configuration_blocked and refuses invalid states and sources", async () => {
    const v = await seedPartner();
    const worker = machine();
    try {
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error).toBeNull();
      expect((await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "connected", p_error_code: null, p_retry_after_seconds: null }))).error?.message).toBe("invalid_input");
      expect((await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "rotation_unknown", p_error_code: "X".repeat(65), p_retry_after_seconds: null }))).error?.message).toBe("invalid_input");
      expect((await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "other" }))).error?.message).toBe("invalid_input");
      expect((await worker.rpc("record_partner_key_rotation_outcome", args(v, { p_state: "configuration_blocked", p_error_code: "SELLER_BINDING_MISMATCH", p_retry_after_seconds: null }))).error).toBeNull();
      expect(onboarding(IDS.tenantA)).toBe("configuration_blocked|SELLER_BINDING_MISMATCH|partner_managed");
    } finally {
      reset();
    }
  });
});

describe("version fence and BYOK protection (T-039)", () => {
  it("a stale expected version is refused with SQLSTATE 55000 by all three writers", async () => {
    const v = await seedPartner();
    const worker = machine();
    try {
      const stale = [
        await worker.rpc("fence_partner_key_rotation", args(v - 1)),
        await worker.rpc("fence_partner_key_rotation", args(v + 1)),
      ];
      for (const r of stale) expect([r.error?.message, r.error?.code]).toEqual(["stale_state", "55000"]);
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error).toBeNull();
      const more = [
        await worker.rpc("record_partner_key_rotation_outcome", args(v + 1, { p_state: "rotation_unknown", p_error_code: null, p_retry_after_seconds: null })),
        await worker.rpc("store_partner_seller_key", args(v - 1, { ...(await sealed(IDS.tenantA, v)), p_source: "recovered" })),
      ];
      for (const r of more) expect([r.error?.message, r.error?.code]).toEqual(["stale_state", "55000"]);
      expect(activeRow(IDS.tenantA)).toBe("");
    } finally {
      reset();
    }
  });

  it("never supersedes a BYOK credential, whatever version the caller sends", async () => {
    reset();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const worker = machine();
    // Partner-managed history, then the admin connected their own key: the BYOK key is the active one.
    const v = await seedPartner();
    try {
      const byok = await sealed(IDS.tenantA, v + 1, "API-BYOKKEY00000000XY");
      expect((await ownerA.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, ...byok })).error).toBeNull();
      const before = activeRow(IDS.tenantA);
      expect(before).toBe(`byok|${v + 1}|true`);
      const row = sql(`select ciphertext from private.seller_credentials where tenant_id = '${IDS.tenantA}' and version = ${v + 1}`);

      const results = [
        await worker.rpc("fence_partner_key_rotation", args(v + 1)),
        await worker.rpc("fence_partner_key_rotation", args(v)),
        await worker.rpc("record_partner_key_rotation_outcome", args(v + 1, { p_state: "rotation_unknown", p_error_code: null, p_retry_after_seconds: null })),
        await worker.rpc("store_partner_seller_key", args(v + 1, { ...(await sealed(IDS.tenantA, v + 2)), p_source: "regenerated" })),
        await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "recovered" })),
      ];
      expect(results.map((r) => r.error?.message)).toEqual(["byok_active", "stale_state", "byok_active", "byok_active", "stale_state"]);
      expect(activeRow(IDS.tenantA)).toBe(before);
      expect(sql(`select ciphertext from private.seller_credentials where tenant_id = '${IDS.tenantA}' and version = ${v + 1}`)).toBe(row);
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${IDS.tenantA}' and version > ${v + 1}`)).toBe("0");
      expect(onboarding(IDS.tenantA).startsWith("connected|")).toBe(true);
    } finally {
      reset();
    }
  });

  it("a BYOK key stored between the Worker's begin and the fence makes the fence stale and stays untouched", async () => {
    const v = await seedPartner();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const worker = machine();
    try {
      const begin = await ownerA.rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA });
      expect(begin.data).toMatchObject({ latest_credential_version: v });
      expect((await ownerA.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, ...(await sealed(IDS.tenantA, v + 1, "API-BYOKKEY00000000XY")) })).error).toBeNull();
      const fenced = await worker.rpc("fence_partner_key_rotation", args(v));
      expect([fenced.error?.message, fenced.error?.code]).toEqual(["stale_state", "55000"]);
      expect(activeRow(IDS.tenantA)).toBe(`byok|${v + 1}|true`);
    } finally {
      reset();
    }
  });

  it("a BYOK key stored while the marker is set is not replaced by the regenerated or recovered key", async () => {
    const v = await seedPartner();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    const worker = machine();
    try {
      expect((await worker.rpc("fence_partner_key_rotation", args(v))).error).toBeNull();
      expect((await ownerA.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, ...(await sealed(IDS.tenantA, v + 1, "API-BYOKKEY00000000XY")) })).error).toBeNull();
      const stored = await worker.rpc("store_partner_seller_key", args(v, { ...(await sealed(IDS.tenantA, v + 1)), p_source: "regenerated" }));
      expect([stored.error?.message, stored.error?.code]).toEqual(["stale_state", "55000"]);
      expect(activeRow(IDS.tenantA)).toBe(`byok|${v + 1}|true`);
    } finally {
      reset();
    }
  });
});

describe("tenant isolation, actor and demo refusal (T-039)", () => {
  it("refuses a non-admin actor, a foreign actor, a foreign or unbound seller and an unbound tenant", async () => {
    const v = await seedPartner();
    const worker = machine();
    try {
      const sealedArgs = { ...(await sealed(IDS.tenantA, v + 1)), p_source: "recovered" };
      for (const actor of [OPERATOR_A, OWNER_B, "00000000-0000-4000-a000-0000000000c1"]) {
        expect((await worker.rpc("fence_partner_key_rotation", args(v, {}, actor))).error?.message, `actor ${actor}`).toBe("admin_required");
      }
      expect((await worker.rpc("fence_partner_key_rotation", { ...args(v), p_actor: null })).error?.message).toBe("admin_required");
      expect((await worker.rpc("fence_partner_key_rotation", args(v, {}, OWNER_A, IDS.tenantA, "77cd1234567890abcdef5678"))).error?.message).toBe("seller_binding_mismatch");
      expect((await worker.rpc("fence_partner_key_rotation", args(v, {}, OWNER_A, IDS.tenantA, "../x"))).error?.message).toBe("invalid_input");
      // Tenant B has no Partner binding at all.
      expect((await worker.rpc("fence_partner_key_rotation", args(0, {}, OWNER_B, IDS.tenantB))).error?.message).toBe("not_partner_managed");
      expect((await worker.rpc("store_partner_seller_key", args(0, { ...(await sealed(IDS.tenantB, 1)), p_source: "recovered" }, OWNER_B, IDS.tenantB))).error?.message).toBe("not_partner_managed");
      // Tenant A's admin cannot act on tenant B.
      expect((await worker.rpc("fence_partner_key_rotation", args(0, {}, OWNER_A, IDS.tenantB))).error?.message).toBe("admin_required");
      expect((await worker.rpc("store_partner_seller_key", args(v, { ...sealedArgs }, OWNER_A, "00000000-0000-4000-b000-0000000000ff"))).error?.code).toBe("P0002");
      expect(activeRow(IDS.tenantA)).toBe(`partner|${v}|true`);
      expect(onboarding(IDS.tenantA)).toBe("connected||partner_managed");
    } finally {
      reset();
    }
  });

  it("refuses demo tenants for all machine writers and for begin", async () => {
    const demo = await demoVisitor();
    const worker = machine();
    const owner = sql(`select user_id from public.memberships where tenant_id = '${demo.tenant}' and role = 'tenant_admin' limit 1`);
    const demoArgs = args(0, {}, owner, demo.tenant);
    expect((await worker.rpc("fence_partner_key_rotation", demoArgs)).error?.message).toBe("demo_restricted");
    expect((await worker.rpc("record_partner_key_rotation_outcome", { ...demoArgs, p_state: "rotation_unknown", p_error_code: null, p_retry_after_seconds: null })).error?.message).toBe("demo_restricted");
    expect((await worker.rpc("store_partner_seller_key", { ...demoArgs, ...(await sealed(demo.tenant, 1)), p_source: "recovered" })).error?.message).toBe("demo_restricted");
    expect((await demo.c.rpc("begin_partner_key_rotation", { p_tenant: demo.tenant })).error?.message).toBe("demo_restricted");
    expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${demo.tenant}'`)).toBe("0");
  });

  it("a credential change that is not a Partner rotation still clears outlet pickup addresses", async () => {
    const v = await seedPartner();
    const ownerA = await signIn("owner-a@geraiexpress.test");
    try {
      expect(pickup()).toBe(PICKUP.address);
      expect((await ownerA.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, ...(await sealed(IDS.tenantA, v + 1, "API-BYOKKEY00000000XY")) })).error).toBeNull();
      expect(pickup()).toBe("");
    } finally {
      reset();
    }
  });
});


describe("T-054 durable provider stops", () => {
  it("stores pre-fence retry and refuses begin, onboarding and fence without clearing it", async () => {
    const v = await seedPartner();
    const owner = await signIn("owner-a@geraiexpress.test");
    const args = { p_tenant: IDS.tenantA, p_actor: OWNER_A, p_seller_id: SELLER_ID,
      p_expected_version: v, p_env: "sandbox", p_error_code: "RATE_LIMITED", p_retry_after_seconds: 60 };
    expect((await owner.rpc("record_partner_preflight_failure", args)).error).not.toBeNull();
    expect((await machine().rpc("record_partner_preflight_failure", args)).error).toBeNull();
    expect((await owner.rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error?.message).toBe("partner_retry_after");
    expect((await owner.rpc("begin_partner_seller_onboarding", { p_tenant: IDS.tenantA, p_owner_name: "Budi",
      p_owner_email: "budi@gerai-uji.id", p_owner_phone: "081234567890", p_terms_version: "terms-1",
      p_privacy_version: "privacy-1", p_agreed: true })).error?.message).toBe("partner_retry_after");
    expect((await machine().rpc("fence_partner_key_rotation", { p_tenant: IDS.tenantA, p_actor: OWNER_A,
      p_seller_id: SELLER_ID, p_expected_version: v, p_env: "sandbox" })).error?.message).toBe("partner_retry_after");
    expect(sql(`select retry_after_at > now() from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`)).toBe("t");
    expect(activeRow(IDS.tenantA)).toContain("partner|");
    expect((await machine().rpc("record_partner_seller_onboarding_outcome", { p_tenant: IDS.tenantA,
      p_state: "registered_key_pending", p_seller_id: SELLER_ID, p_error_code: "UNAVAILABLE", p_retry_after_seconds: null })).error?.message).toBe("partner_retry_after");

    sql(`update private.tenant_mengantar_onboarding set retry_after_at = now() - interval '1 second' where tenant_id = '${IDS.tenantA}'`);
    expect((await owner.rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error).toBeNull();
    expect((await machine().rpc("record_partner_preflight_failure", { ...args, p_error_code: "SELLER_DEACTIVATED", p_retry_after_seconds: null })).error).toBeNull();
    expect((await owner.rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error?.message).toBe("provider_restricted");
    expect((await machine().rpc("fence_partner_key_rotation", { p_tenant: IDS.tenantA, p_actor: OWNER_A,
      p_seller_id: SELLER_ID, p_expected_version: v, p_env: "sandbox" })).error?.message).toBe("provider_restricted");
    expect((await machine().rpc("record_partner_seller_onboarding_outcome", { p_tenant: IDS.tenantA,
      p_state: "not_connected", p_seller_id: SELLER_ID, p_error_code: "UNAVAILABLE", p_retry_after_seconds: null })).error?.message).toBe("provider_restricted");
    reset();
  });
});

describe("T-054 review fixes: Partner-wide codes, reviewed stop clearing, monotonic windows", () => {
  const state = () => sql(`select onboarding_state || '|' || coalesce(last_error_code, '') || '|' || (retry_after_at > now())::text
    from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);

  it("stores no tenant stop for a Partner-wide pre-fence refusal", async () => {
    const v = await seedPartner();
    try {
      for (const code of ["IP_NOT_ALLOWED", "PARTNER_DEACTIVATED"]) {
        expect((await machine().rpc("record_partner_preflight_failure", { p_tenant: IDS.tenantA, p_actor: OWNER_A, p_seller_id: SELLER_ID,
          p_expected_version: v, p_env: "sandbox", p_error_code: code, p_retry_after_seconds: null })).error?.message).toBe("invalid_input");
      }
      expect(onboarding(IDS.tenantA)).toContain("connected");
    } finally {
      reset();
    }
  });

  it("lets only an integration operator clear a stop with a reason, to the safe next state, keeping the window; a replay is a no-op", async () => {
    const v = await seedPartner();
    const floor = auditFloor();
    try {
      expect((await machine().rpc("record_partner_preflight_failure", { p_tenant: IDS.tenantA, p_actor: OWNER_A, p_seller_id: SELLER_ID,
        p_expected_version: v, p_env: "sandbox", p_error_code: "RATE_LIMITED", p_retry_after_seconds: 600 })).error).toBeNull();
      sql(`update private.tenant_mengantar_onboarding set onboarding_state = 'provider_restricted', last_error_code = 'SELLER_DEACTIVATED' where tenant_id = '${IDS.tenantA}'`);
      const clear = (reason = "Mengantar mengaktifkan kembali akun penjual") => ({ p_tenant: IDS.tenantA, p_reason: reason });
      expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_clear_partner_stop", clear())).error?.message).toBe("platform_access_required");
      const admin = await signInAal2("admin@geraiexpress.test");
      expect((await admin.rpc("platform_clear_partner_stop", clear(" "))).error?.message).toBe("reason_required");
      expect(state()).toBe("provider_restricted|SELLER_DEACTIVATED|true");

      const cleared = await admin.rpc("platform_clear_partner_stop", clear());
      expect([cleared.error, cleared.data]).toEqual([null, "connected"]);
      // The 429 window survives the clear; the next provider step still waits for it.
      expect(state()).toBe("connected||true");
      expect((await (await signIn("owner-a@geraiexpress.test")).rpc("begin_partner_key_rotation", { p_tenant: IDS.tenantA })).error?.message).toBe("partner_retry_after");
      expect((await admin.rpc("platform_clear_partner_stop", clear())).data).toBe("connected");
      expect(sql(`select string_agg(action || '|' || outcome || '|' || (detail->>'from') || '|' || (detail->>'error_code'), ',' order by id)
        from public.audit_events where id > ${floor} and target_tenant = '${IDS.tenantA}' and action = 'partner.stop_cleared'`))
        .toBe("partner.stop_cleared|connected|provider_restricted|SELLER_DEACTIVATED");

      // A fenced Partner key (no active credential) is cleared to rotation_unknown: recovery fetches the current key.
      sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null;
        update private.tenant_mengantar_onboarding set onboarding_state = 'provider_restricted' where tenant_id = '${IDS.tenantA}'`);
      expect((await admin.rpc("platform_clear_partner_stop", clear())).data).toBe("rotation_unknown");
    } finally {
      reset();
    }
  });

  it("never shortens or clears a stored window through a later rotation outcome", async () => {
    const v = await seedPartner();
    try {
      expect((await machine().rpc("fence_partner_key_rotation", { p_tenant: IDS.tenantA, p_actor: OWNER_A, p_seller_id: SELLER_ID,
        p_expected_version: v, p_env: "sandbox" })).error).toBeNull();
      const outcome = (code: string, retry: number | null) => machine().rpc("record_partner_key_rotation_outcome", { p_tenant: IDS.tenantA,
        p_actor: OWNER_A, p_seller_id: SELLER_ID, p_expected_version: v, p_state: "rotation_unknown", p_error_code: code, p_retry_after_seconds: retry, p_env: "sandbox" });
      expect((await outcome("RATE_LIMITED", 3600)).error).toBeNull();
      const window = () => sql(`select extract(epoch from retry_after_at - now())::int / 60 from private.tenant_mengantar_onboarding where tenant_id = '${IDS.tenantA}'`);
      expect(Number(window())).toBeGreaterThanOrEqual(59);
      expect((await outcome("UNAVAILABLE", null)).error).toBeNull();
      expect((await outcome("RATE_LIMITED", 5)).error).toBeNull();
      expect(Number(window())).toBeGreaterThanOrEqual(59);
    } finally {
      reset();
    }
  });
});
