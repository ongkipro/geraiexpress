// T-050 (review P1-12 to P1-14: SEC-07, SEC-08, DIL-05, DIL-23): provider-environment scope of the
// seller binding and sealed credentials, and the machine-only key re-wrap. A sandbox credential is
// never returned for production, the binding is unique per (environment, seller), and re-wrapping
// changes only ciphertext, iv and key_version of an ACTIVE row.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { listTenantIds, reencryptCredentials } from "../../src/lib/credential-keyring";
import { IDS, client, demoVisitor, machine, realOperation, signIn, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const K1 = Buffer.alloc(32, 7).toString("base64"); // the realOperation fixture's sealing key
const K2 = Buffer.alloc(32, 13).toString("base64");
const RING = { current: "v2", keys: { v1: K1, v2: K2 } };
const SELLER = "77ab1234567890abcdef1234";

const activeEnvs = (tenant: string) =>
  sql(`select coalesce(string_agg(provider_env || ':' || version, ',' order by version), '') from private.seller_credentials where tenant_id = '${tenant}' and superseded_at is null`);

async function insertCredential(tenant: string, version: number, env: "sandbox" | "production", plain = "API-ENVSCOPEKEY000001") {
  const s = await sealCredential(plain, credentialAad(tenant, version), K1);
  sql(`insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, provider_env)
    values ('${tenant}', 'byok', '${s.ciphertext}', '${s.iv}', '${s.keyVersion}', '01', ${version}, '${env}')`);
}

function onboardingRow(tenant: string, env: "sandbox" | "production", seller: string | null) {
  sql(`insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
      partner_seller_id, owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, provider_env)
    values ('${tenant}', 'geraiexpress:tenant:${tenant}', 'none', 'registration_pending', ${seller ? `'${seller}'` : "null"},
      'Budi Santoso', 'budi.santoso@gerai-uji.id', '081234567890', 'terms-1', 'privacy-1', '${OWNER_A}', '${env}')`);
}

describe("schema (DATA-4)", () => {
  it("both tables carry provider_env, defaulting to sandbox and limited to the two environments", async () => {
    for (const table of ["seller_credentials", "tenant_mengantar_onboarding"]) {
      expect(sql(`select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns
        where table_schema = 'private' and table_name = '${table}' and column_name = 'provider_env'`)).toBe("text|NO|'sandbox'::text");
    }
    const f = await realOperation(); // inserted without an environment: the default is sandbox
    expect(sql(`select provider_env from private.seller_credentials where tenant_id = '${f.tenant}'`)).toBe("sandbox");
    expect(() => sql(`update private.seller_credentials set provider_env = 'staging' where tenant_id = '${f.tenant}'`)).toThrow(/provider_env_check/);
  });

  it("allows one active credential per (tenant, environment), not two in the same environment", async () => {
    const f = await realOperation(); // sandbox v1 active
    await insertCredential(f.tenant, 2, "production");
    expect(activeEnvs(f.tenant)).toBe("sandbox:1,production:2");
    await expect(insertCredential(f.tenant, 3, "production")).rejects.toThrow(/seller_credentials_one_active/);
    await expect(insertCredential(f.tenant, 3, "sandbox")).rejects.toThrow(/seller_credentials_one_active/);
  });

  it("binds a Partner seller id once per environment and never changes a row's environment", () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const t of [a, b, c]) sql(`insert into public.tenants (id, name, lifecycle) values ('${t}', 'Gerai Env', 'active')`);
    onboardingRow(a, "sandbox", SELLER);
    onboardingRow(b, "production", SELLER); // the same id in another environment is another seller account
    expect(() => onboardingRow(c, "sandbox", SELLER)).toThrow(/tenant_mengantar_onboarding_partner_seller_uniq/);
    expect(() => onboardingRow(c, "production", SELLER)).toThrow(/tenant_mengantar_onboarding_partner_seller_uniq/);
    expect(() => sql(`update private.tenant_mengantar_onboarding set provider_env = 'production' where tenant_id = '${a}'`)).toThrow(/immutable_provider_env/);
    expect(sql(`select provider_env from private.tenant_mengantar_onboarding where tenant_id = '${a}'`)).toBe("sandbox");
  });
});

describe("machine reads return only the caller's environment (SEC-07)", () => {
  it("machine_seller_key never returns a sandbox credential for production, nor the reverse", async () => {
    const f = await realOperation(); // sandbox v1
    const worker = machine();
    const sandbox = await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" });
    expect(sandbox.data).toMatchObject({ version: 1, key_version: "v1" });
    expect((await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "production" })).data).toBeNull();

    await insertCredential(f.tenant, 2, "production");
    expect((await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "production" })).data).toMatchObject({ version: 2 });
    expect((await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" })).data).toMatchObject({ version: 1 });

    for (const env of [null, "", "staging", "PRODUCTION"]) {
      expect((await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: env })).error?.message).toBe("invalid_environment");
    }
    // Callers other than the machine identity still cannot read it.
    for (const c of [client(), await signIn("owner-a@geraiexpress.test"), (await demoVisitor()).c]) {
      expect((await c.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" })).error).not.toBeNull();
    }
  });

  it("a production claim with only a sandbox credential fails closed and leaves the operation queued", async () => {
    const f = await realOperation(); // sandbox credential only
    const worker = machine();
    const refused = await worker.rpc("dispatch_claim", { p_operation: f.op, p_env: "production" });
    expect(refused.error?.message).toBe("credential_missing");
    expect(sql(`select state || '|' || attempts || '|' || coalesce(provider_env, '-') from public.provider_operations where id = '${f.op}'`)).toBe("queued|0|-");

    const sandbox = await worker.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    expect(sandbox.error).toBeNull();
    expect(sandbox.data).toMatchObject({ provider_env: "sandbox", credential: { version: 1 } });
  });

  it("a production claim and its later reads open the production credential, not the active sandbox one", async () => {
    const f = await realOperation(); // sandbox v1 active
    await insertCredential(f.tenant, 2, "production");
    const worker = machine();
    const claimed = await worker.rpc("dispatch_claim", { p_operation: f.op, p_env: "production" });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toMatchObject({ provider_env: "production", credential: { version: 2 } });
    expect(sql(`select provider_env || '|' || credential_version from public.provider_operations where id = '${f.op}'`)).toBe("production|2");

    expect((await worker.rpc("dispatch_record", { p_operation: f.op, p_attempt: 1, p_outcome: "unknown" })).error).toBeNull();
    // T-057: a sandbox runtime is refused before any credential leaves the database; nothing changes.
    const crossed = await worker.rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "sandbox" });
    expect([crossed.data, crossed.error?.message, crossed.error?.code]).toEqual([null, "provider_env_mismatch", "42501"]);
    expect((await worker.rpc("dispatch_begin_reconcile", { p_operation: f.op })).error).not.toBeNull();
    expect((await worker.rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "staging" })).error?.message).toBe("invalid_environment");
    const reconcile = await worker.rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "production" });
    expect(reconcile.data).toMatchObject({ provider_env: "production", credential: { version: 2 } });

    // The operation's credential vanishing from ITS environment yields no key, even though the
    // tenant's sandbox credential is still active.
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${f.tenant}' and provider_env = 'production'`);
    expect(((await worker.rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "production" })).data as { credential: unknown }).credential).toBeNull();
    expect(activeEnvs(f.tenant)).toBe("sandbox:1");
  });
});

describe("writers store the Worker's environment (DIL-05)", () => {
  it("BYOK store supersedes only the same environment's credential and remove names the row by version", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null`);
    const latest = () => Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${IDS.tenantA}'`));
    const store = async (env: string, plain: string) => {
      const v = latest();
      const s = await sealCredential(plain, credentialAad(IDS.tenantA, v + 1), K1);
      return owner.rpc("store_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: v, p_ciphertext: s.ciphertext, p_iv: s.iv, p_key_version: s.keyVersion, p_hint: "01", p_env: env });
    };
    try {
      const base = latest();
      expect((await store("sandbox", "API-SANDBOXKEY0000001")).data).toBe(base + 1);
      expect((await store("production", "API-PRODKEY00000000001")).data).toBe(base + 2);
      expect(activeEnvs(IDS.tenantA)).toBe(`sandbox:${base + 1},production:${base + 2}`);
      expect((await store("production", "API-PRODKEY00000000002")).data).toBe(base + 3);
      expect(activeEnvs(IDS.tenantA)).toBe(`sandbox:${base + 1},production:${base + 3}`);
      expect((await store("staging", "API-STAGINGKEY00000001")).error?.message).toBe("invalid_environment");
      expect(latest()).toBe(base + 3);
      expect(sql(`select detail->>'provider_env' from public.audit_events where target_tenant = '${IDS.tenantA}' and action = 'credential.store' order by id desc limit 1`)).toBe("production");

      // Removing the production row leaves the sandbox row active (and a superseded version is refused).
      expect((await owner.rpc("remove_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: base + 2 })).error?.message).toBe("stale_state");
      expect((await owner.rpc("remove_seller_credential", { p_tenant: IDS.tenantA, p_expected_version: base + 3 })).error).toBeNull();
      expect(activeEnvs(IDS.tenantA)).toBe(`sandbox:${base + 1}`);
    } finally {
      sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null`);
    }
  });

  it("Partner completion refuses an environment other than the binding's and writes the binding's", async () => {
    const f = await realOperation({ noCredential: true });
    onboardingRow(f.tenant, "sandbox", null);
    const s = await sealCredential("API-PARTNERENVKEY0001", credentialAad(f.tenant, 1), K1);
    const args = { p_tenant: f.tenant, p_seller_id: SELLER.replace("77", "78"), p_ciphertext: s.ciphertext, p_iv: s.iv, p_key_version: s.keyVersion, p_hint: "01", p_expected_version: 0 };
    const worker = machine();
    expect((await worker.rpc("complete_partner_seller_onboarding", { ...args, p_env: "production" })).error).toMatchObject({ code: "42501", message: "provider_env_mismatch" });
    expect((await worker.rpc("complete_partner_seller_onboarding", { ...args, p_env: "other" })).error?.message).toBe("invalid_environment");
    expect(activeEnvs(f.tenant)).toBe("");
    expect((await worker.rpc("complete_partner_seller_onboarding", { ...args, p_env: "sandbox" })).data).toBe(1);
    expect(activeEnvs(f.tenant)).toBe("sandbox:1");
  });
});

describe("rewrap_seller_credential (SEC-7 key ring)", () => {
  const FN = "public.rewrap_seller_credential(uuid, integer, text, text, text, text)";

  it("is service_role only, security definer with an empty search_path", () => {
    for (const role of ["anon", "authenticated"]) expect(sql(`select has_function_privilege('${role}', '${FN}', 'execute')`)).toBe("f");
    expect(sql(`select coalesce(proacl::text, '') ~ '(^\\{|,)=X' from pg_proc where oid = '${FN}'::regprocedure`)).toBe("f");
    expect(sql(`select has_function_privilege('service_role', '${FN}', 'execute')`)).toBe("t");
    expect(sql(`select (prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))::text from pg_proc where oid = '${FN}'::regprocedure`)).toBe("true");
  });

  it("no user, visitor or anonymous caller can call it", async () => {
    const f = await realOperation();
    const args = { p_tenant: f.tenant, p_version: 1, p_expected_key_version: "v1", p_ciphertext: "x".repeat(24), p_iv: "y".repeat(16), p_new_key_version: "v2" };
    for (const c of [client(), await signIn("owner-a@geraiexpress.test"), (await demoVisitor()).c]) {
      expect((await c.rpc("rewrap_seller_credential", args)).error).not.toBeNull();
    }
    expect(sql(`select key_version from private.seller_credentials where tenant_id = '${f.tenant}'`)).toBe("v1");
  });

  it("re-seals an active row under the same version and AAD, audits it and keeps state", async () => {
    const f = await realOperation({ sellerKey: "API-REWRAPSELLER00001" });
    const worker = machine();
    const row = (await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" })).data as { ciphertext: string; iv: string; key_version: string; version: number };
    const plain = await openCredential(row, credentialAad(f.tenant, row.version), RING);
    const resealed = await sealCredential(plain, credentialAad(f.tenant, row.version), RING);
    expect(resealed.keyVersion).toBe("v2");
    const floor = Number(sql("select coalesce(max(id), 0) from public.audit_events"));
    const stateOf = () => sql(`select created_at::text || '|' || mode || '|' || provider_env || '|' || version from private.seller_credentials where tenant_id = '${f.tenant}'`);
    const before = stateOf();

    const args = { p_tenant: f.tenant, p_version: row.version, p_expected_key_version: "v1", p_ciphertext: resealed.ciphertext, p_iv: resealed.iv, p_new_key_version: "v2" };
    expect((await worker.rpc("rewrap_seller_credential", args)).error).toBeNull();

    const after = (await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" })).data as { ciphertext: string; iv: string; key_version: string; version: number };
    expect(after).toMatchObject({ key_version: "v2", version: row.version, ciphertext: resealed.ciphertext, iv: resealed.iv });
    expect(await openCredential(after, credentialAad(f.tenant, after.version), RING)).toBe("API-REWRAPSELLER00001");
    expect(stateOf()).toBe(before);
    expect(activeEnvs(f.tenant)).toBe("sandbox:1");
    const audit = JSON.parse(sql(`select to_jsonb(a)::text from public.audit_events a where id > ${floor} and target_tenant = '${f.tenant}'`));
    expect(audit).toMatchObject({ action: "credential.rewrapped", outcome: "rewrapped", actor: null,
      detail: { version: 1, provider_env: "sandbox", mode: "byok", from_key_version: "v1", to_key_version: "v2", via: "machine" } });
    expect(JSON.stringify(audit)).not.toContain(resealed.ciphertext);

    // The fence: a second run with the old expected key version changes nothing.
    const again = await worker.rpc("rewrap_seller_credential", args);
    expect(again.error).toMatchObject({ code: "55000", message: "stale_state" });
    expect((await worker.rpc("machine_seller_key", { p_tenant: f.tenant, p_env: "sandbox" })).data).toEqual(after);
  });

  it("refuses a wrong expected key version, a wrong version, another tenant's row and a no-op", async () => {
    const [a, b] = [await realOperation(), await realOperation()];
    const worker = machine();
    const base = { p_ciphertext: "x".repeat(24), p_iv: "y".repeat(16), p_new_key_version: "v2" };
    const snapshot = (t: string) => sql(`select ciphertext || iv || key_version from private.seller_credentials where tenant_id = '${t}'`);
    const [beforeA, beforeB] = [snapshot(a.tenant), snapshot(b.tenant)];
    const attempts: [Record<string, unknown>, string][] = [
      [{ p_tenant: a.tenant, p_version: 1, p_expected_key_version: "v9", ...base }, "stale_state"],
      [{ p_tenant: a.tenant, p_version: 2, p_expected_key_version: "v1", ...base }, "stale_state"],
      [{ p_tenant: randomUUID(), p_version: 1, p_expected_key_version: "v1", ...base }, "stale_state"],
      [{ p_tenant: a.tenant, p_version: 1, p_expected_key_version: "v1", ...base, p_new_key_version: "v1" }, "invalid_input"],
      [{ p_tenant: a.tenant, p_version: 1, p_expected_key_version: "v1", ...base, p_new_key_version: "2" }, "invalid_input"],
      [{ p_tenant: a.tenant, p_version: 0, p_expected_key_version: "v1", ...base }, "invalid_input"],
    ];
    for (const [args, message] of attempts) expect((await worker.rpc("rewrap_seller_credential", args)).error?.message, JSON.stringify(args)).toBe(message);
    expect(snapshot(a.tenant)).toBe(beforeA);
    // Tenant isolation: re-wrapping tenant B writes tenant B's row only.
    expect((await worker.rpc("rewrap_seller_credential", { p_tenant: b.tenant, p_version: 1, p_expected_key_version: "v1", ...base, p_ciphertext: "z".repeat(24) })).error).toBeNull();
    expect(snapshot(a.tenant)).toBe(beforeA);
    expect(snapshot(b.tenant)).not.toBe(beforeB);
  });

  it("never touches superseded rows (their ciphertext is gone)", async () => {
    const f = await realOperation();
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${f.tenant}'`);
    const res = await machine().rpc("rewrap_seller_credential", { p_tenant: f.tenant, p_version: 1, p_expected_key_version: "v1", p_ciphertext: "x".repeat(24), p_iv: "y".repeat(16), p_new_key_version: "v2" });
    expect(res.error?.message).toBe("stale_state");
    expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${f.tenant}' and ciphertext is not null`)).toBe("0");
    expect(sql(`select count(*) from public.audit_events where target_tenant = '${f.tenant}' and action = 'credential.rewrapped'`)).toBe("0");
  });

  it("the Worker job moves old rows end to end, is idempotent, and only for its own environment", async () => {
    const [a, b] = [await realOperation({ sellerKey: "API-JOBSELLERKEY00001" }), await realOperation({ sellerKey: "API-JOBSELLERKEY00002", credentialEnv: "production" })];
    const worker = machine();
    const rpc = (fn: string, args: Record<string, unknown>) => worker.rpc(fn, args);
    const run = () => reencryptCredentials({ rpc, key: RING, environment: "sandbox", tenantIds: [a.tenant, b.tenant] });

    expect(await run()).toEqual({ scanned: 2, rewrapped: 1, alreadyCurrent: 0, noCredential: 1, conflicts: 0, failed: [] });
    const open = async (tenant: string, env: string) => {
      const row = (await worker.rpc("machine_seller_key", { p_tenant: tenant, p_env: env })).data as { ciphertext: string; iv: string; key_version: string; version: number };
      return { row, plain: await openCredential(row, credentialAad(tenant, row.version), RING) };
    };
    const rewrapped = await open(a.tenant, "sandbox");
    expect(rewrapped.row.key_version).toBe("v2");
    expect(rewrapped.plain).toBe("API-JOBSELLERKEY00001");
    // The production row of another tenant was not read as sandbox and is still sealed under v1.
    expect((await open(b.tenant, "production")).row.key_version).toBe("v1");

    expect(await run()).toEqual({ scanned: 2, rewrapped: 0, alreadyCurrent: 1, noCredential: 1, conflicts: 0, failed: [] });
    const prod = await reencryptCredentials({ rpc, key: RING, environment: "production", tenantIds: [b.tenant] });
    expect(prod).toMatchObject({ rewrapped: 1, failed: [] });
    expect((await open(b.tenant, "production")).row.key_version).toBe("v2");

    // The tenant listing skips demo tenants.
    const demo = await demoVisitor();
    const ids = await listTenantIds(worker);
    expect(ids).toContain(a.tenant);
    expect(ids).not.toContain(demo.tenant);
  });
});

describe("the sweep and the credential reads stay in this runtime's environment (T-057 second review)", () => {
  const unknownOp = async (env: "sandbox" | "production", age: string) => {
    const f = await realOperation({ credentialEnv: env });
    sql(`update public.provider_operations set state = 'unknown', attempts = 1, provider_env = '${env}', credential_version = 1,
      dispatched_at = now() - interval '${age}', last_checked_at = null where id = '${f.op}'`);
    return f;
  };

  it("dispatch_due returns only this environment's work, so another environment's backlog never starves it", async () => {
    const local = await unknownOp("sandbox", "6 days 23 hours");
    const foreign: string[] = [];
    for (let i = 0; i < 21; i++) foreign.push((await unknownOp("production", "6 days 23 hours 30 minutes")).op);
    const due = async (env: string) => ((await machine().rpc("dispatch_due", { p_limit: 20, p_env: env })).data as { operation_id: string }[]).map((r) => r.operation_id);
    const sandbox = await due("sandbox");
    expect(sandbox).toContain(local.op);
    expect(sandbox.filter((id) => foreign.includes(id))).toEqual([]);
    expect((await due("production")).filter((id) => foreign.includes(id)).length).toBeGreaterThan(0);
    expect((await machine().rpc("dispatch_due", { p_limit: 20 })).error?.message).toBe("invalid_environment");
    expect((await machine().rpc("dispatch_due", { p_limit: 20, p_env: "staging" })).error?.message).toBe("invalid_environment");
  });

  it("a payment check from the other environment is refused with no credential and no check time recorded", async () => {
    const f = await realOperation({ credentialEnv: "production" });
    sql(`update public.provider_operations set state = 'succeeded', attempts = 1, provider_env = 'production', credential_version = 1,
        dispatched_at = now() - interval '1 hour', provider_order_id = 'ENV0RDER1', provider_batch = 'ENVBATCH01', last_checked_at = null where id = '${f.op}';
      update public.shipments set submission_state = 'awaiting_payment', payment_state = 'unpaid' where id = '${f.shipment}'`);
    const crossed = await machine().rpc("dispatch_begin_payment_check", { p_operation: f.op, p_env: "sandbox" });
    expect([crossed.data, crossed.error?.message]).toEqual([null, "provider_env_mismatch"]);
    expect(sql(`select coalesce(last_checked_at::text, '-') from public.provider_operations where id = '${f.op}'`)).toBe("-");
    const own = await machine().rpc("dispatch_begin_payment_check", { p_operation: f.op, p_env: "production" });
    expect(own.data).toMatchObject({ provider_env: "production", credential: { version: 1 } });
  });
});
