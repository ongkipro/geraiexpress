// PR-24 / PR-15 / PR-28 / IAM-7 / TEN-4 / DEC-008: platform authority needs an active grant, the
// capability and an aal2 session, checked in the database on every call; grants cannot be
// self-assigned; the last access governor cannot be removed; audit is append-only.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mintJwt } from "./mint-jwt";
import { dataClient } from "../../src/lib/db/client";
import { describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, IDS, authService, client, demoVisitor, passwordUser, sessionClient, signIn, signInAal2, sql } from "./helpers";

const TENANT_C = "00000000-0000-4000-b000-00000000000c";
const ADMIN_2 = "00000000-0000-4000-a000-0000000000f2";

describe("platform access boundary", () => {
  it("tenant, demo, signed-out and aal1 sessions are denied every platform read and command", async () => {
    const callers = {
      owner: await signIn("owner-a@geraiexpress.test"),
      demo: (await demoVisitor()).c,
      anon: client(),
      aal1: await signIn("admin@geraiexpress.test"),
      noFactor: await signIn("admin-new@geraiexpress.test"),
    };
    for (const [who, c] of Object.entries(callers)) {
      expect((await c.rpc("platform_tenants")).error, who).not.toBeNull();
      expect((await c.rpc("platform_admins")).error, who).not.toBeNull();
      expect((await c.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "active", p_lifecycle: "suspended", p_reason: "probe probe" })).error, who).not.toBeNull();
      expect((await c.rpc("platform_set_grant", { p_email: "owner-a@geraiexpress.test", p_capabilities: ["access_governance"], p_reason: "probe probe" })).error, who).not.toBeNull();
      const audit = await c.from("audit_events").select("id");
      expect(audit.data ?? [], who).toEqual([]);
    }
    expect(sql(`select lifecycle from public.tenants where id = '${TENANT_C}'`)).toBe("active");
  });

  it("an aal2 platform administrator sees only the safe tenant projection", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_tenants");
    expect(error).toBeNull();
    const names = (data as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Gerai Uji A", "Gerai Uji B", "Gerai Uji C"]));
    expect(names.some((n) => n.startsWith("Gerai Contoh"))).toBe(false);
    expect(Object.keys((data as object[])[0]).sort()).toEqual(["created_at", "id", "lifecycle", "member_count", "name", "shipment_count"]);
    // The platform role is not tenant membership: tenant data stays invisible.
    expect((await admin.from("contacts").select("id")).data).toEqual([]);
    expect((await admin.from("shipments").select("id").eq("tenant_id", IDS.tenantA)).data).toEqual([]);
  });

  it("a grant cannot be self-assigned through the Data API, nor through tampered identity metadata", async () => {
    const auth = authService();
    const user = await passwordUser("selfgrant");
    const login = await auth.signInWithPassword({ email: user.email, password: user.password, captchaToken: undefined });
    if (!login.ok) throw new Error(`sign-in: ${login.reason}`);
    const me = sessionClient(login.session);
    expect((await me.from("platform_grants").insert({ user_id: user.id, capabilities: ["access_governance"] })).error).not.toBeNull();
    // Whatever an attacker could write into the identity's metadata is never read as authority.
    sql(`update auth.users set raw_user_meta_data = '{"role":"super_admin","platform":true,"aal":"aal2"}'::jsonb,
      raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin","platform":true,"aal":"aal2","capabilities":["access_governance"]}'::jsonb where id = '${user.id}'`);
    expect((await me.rpc("platform_tenants")).error?.message).toBe("platform_access_required");
    // A token minted after the tampering (refresh and a fresh sign-in) carries no platform authority either.
    const refreshed = await auth.refresh(login.session.refreshToken!);
    if (!refreshed.ok) throw new Error(`refresh: ${refreshed.reason}`);
    expect(await auth.verifyAccessToken(refreshed.session.accessToken)).toMatchObject({ ok: true, claims: { role: "authenticated", aal: "aal1" } });
    expect((await sessionClient(refreshed.session).rpc("platform_tenants")).error?.message).toBe("platform_access_required");
    const again = await auth.signInWithPassword({ email: user.email, password: user.password, captchaToken: undefined });
    if (!again.ok) throw new Error(`sign-in: ${again.reason}`);
    expect((await sessionClient(again.session).rpc("platform_admins")).error?.message).toBe("platform_access_required");
    expect(sql(`select count(*) from public.platform_grants where user_id = '${user.id}'`)).toBe("0");
  });

  it("a monitoring-only administrator cannot govern tenants or access", async () => {
    // An aal2 session (minted; real TOTP is T-065) without the capability is still refused.
    const c = await signInAal2("admin-new@geraiexpress.test");
    expect((await c.rpc("platform_tenants")).error?.message).toBe("platform_access_required");
    expect((await c.rpc("platform_admins")).error?.message).toBe("platform_access_required");
    expect((await c.from("audit_events").select("id")).error).toBeNull(); // audit_review allowed
  });
});

describe("tenant lifecycle (PR-15)", () => {
  it("suspension needs a reason and the current state, blocks members, and is audited once", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const ownerC = await signIn("owner-c@geraiexpress.test");
    expect((await ownerC.from("outlets").select("id").eq("tenant_id", TENANT_C)).data).toHaveLength(1);

    expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "active", p_lifecycle: "suspended", p_reason: "" })).error?.message).toBe("reason_required");
    expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "suspended", p_lifecycle: "active", p_reason: "stale probe" })).error?.message).toBe("stale_state");
    expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "active", p_lifecycle: "archived", p_reason: "not allowed" })).error?.message).toBe("transition_not_allowed");

    const before = Number(sql(`select count(*) from public.audit_events where target_tenant = '${TENANT_C}'`));
    try {
      expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "active", p_lifecycle: "suspended", p_reason: "Uji pembekuan" })).error).toBeNull();
      expect((await ownerC.from("outlets").select("id").eq("tenant_id", TENANT_C)).data).toEqual([]);
      expect((await ownerC.rpc("create_shipment_draft", { p_outlet: "00000000-0000-4000-c000-00000000000c" })).error?.message).toBe("not_found");
      expect(Number(sql(`select count(*) from public.audit_events where target_tenant = '${TENANT_C}'`))).toBe(before + 1);
      // Demo tenants are not governed through this path.
      const demo = await demoVisitor();
      expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: demo.tenant, p_expected: "active", p_lifecycle: "suspended", p_reason: "demo probe" })).error?.message).toBe("not_found");
    } finally {
      expect((await admin.rpc("platform_set_tenant_lifecycle", { p_tenant: TENANT_C, p_expected: "suspended", p_lifecycle: "active", p_reason: "Uji selesai" })).error).toBeNull();
    }
    expect((await ownerC.from("outlets").select("id").eq("tenant_id", TENANT_C)).data).toHaveLength(1);
  });
});

describe("access governance (DEC-008)", () => {
  it("grants need a verified account; revocation takes effect immediately for a live aal2 session", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_set_grant", { p_email: "nobody@geraiexpress.test", p_capabilities: ["audit_review"], p_reason: "probe probe" })).error?.message).toBe("user_not_found");
    const admin2 = await signInAal2("admin-2@geraiexpress.test");
    expect((await admin2.rpc("platform_tenants")).error).toBeNull();
    const rev = Number(sql(`select revision from public.platform_grants where user_id = '${ADMIN_2}'`));
    try {
      expect((await admin.rpc("platform_revoke_grant", { p_user: ADMIN_2, p_expected_revision: rev + 5, p_reason: "stale probe" })).error?.message).toBe("stale_state");
      expect((await admin.rpc("platform_revoke_grant", { p_user: ADMIN_2, p_expected_revision: rev, p_reason: "Uji pencabutan" })).error).toBeNull();
      // Same token, still aal2: access is gone because authority is read from the table.
      expect((await admin2.rpc("platform_tenants")).error?.message).toBe("platform_access_required");
    } finally {
      expect((await admin.rpc("platform_set_grant", { p_email: "admin-2@geraiexpress.test",
        p_capabilities: ["tenant_governance", "platform_monitoring", "integration_operations", "access_governance", "audit_review"],
        p_reason: "Pulihkan fixture" })).error).toBeNull();
    }
    expect((await admin2.rpc("platform_tenants")).error).toBeNull();
  });

  it("the last access governor with an authenticator cannot be revoked or demoted", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const ADMIN_1 = "00000000-0000-4000-a000-0000000000f1";
    const rev2 = Number(sql(`select revision from public.platform_grants where user_id = '${ADMIN_2}'`));
    expect((await admin.rpc("platform_revoke_grant", { p_user: ADMIN_2, p_expected_revision: rev2, p_reason: "leave one" })).error).toBeNull();
    try {
      const rev1 = Number(sql(`select revision from public.platform_grants where user_id = '${ADMIN_1}'`));
      expect((await admin.rpc("platform_revoke_grant", { p_user: ADMIN_1, p_expected_revision: rev1, p_reason: "remove last" })).error?.message).toBe("last_access_governor");
      expect((await admin.rpc("platform_set_grant", { p_email: "admin@geraiexpress.test", p_capabilities: ["audit_review"], p_reason: "demote last" })).error?.message).toBe("last_access_governor");
      // A governor without a verified authenticator does not count as a usable survivor.
      expect((await admin.rpc("platform_set_grant", { p_email: "admin-new@geraiexpress.test", p_capabilities: ["access_governance", "platform_monitoring", "audit_review"], p_reason: "no factor" })).error).toBeNull();
      expect((await admin.rpc("platform_revoke_grant", { p_user: ADMIN_1, p_expected_revision: rev1, p_reason: "remove last" })).error?.message).toBe("last_access_governor");
    } finally {
      await admin.rpc("platform_set_grant", { p_email: "admin-new@geraiexpress.test", p_capabilities: ["platform_monitoring", "audit_review"], p_reason: "Pulihkan fixture" });
      await admin.rpc("platform_set_grant", { p_email: "admin-2@geraiexpress.test",
        p_capabilities: ["tenant_governance", "platform_monitoring", "integration_operations", "access_governance", "audit_review"], p_reason: "Pulihkan fixture" });
    }
    expect(sql(`select count(*) from public.platform_grants where revoked_at is null and 'access_governance' = any(capabilities)`)).toBe("2");
  });
});

// Runs one transaction as `authenticated` with an aal2 JWT for the given user, via psql.
const run = promisify(execFile);
function asPlatformUser(user: string, body: string) {
  const claims = JSON.stringify({ sub: user, role: "authenticated", aal: "aal2", is_anonymous: false, amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] });
  const script = `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ${body} commit;`;
  return run("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c", script])
    .then(() => "ok", (e: { stderr?: string }) => e.stderr ?? "error");
}

describe("concurrent governance (PR-24)", () => {
  it("a governor revoked while their own call waits cannot restore themselves", async () => {
    const ADMIN_1 = "00000000-0000-4000-a000-0000000000f1";
    const rev = Number(sql(`select revision from public.platform_grants where user_id = '${ADMIN_2}'`));
    const all = "array['tenant_governance','platform_monitoring','integration_operations','access_governance','audit_review']";
    const revoke = asPlatformUser(ADMIN_1, `select public.platform_revoke_grant('${ADMIN_2}', ${rev}, 'race revoke'); select pg_sleep(1.5);`);
    await new Promise((r) => setTimeout(r, 400));
    const restore = asPlatformUser(ADMIN_2, `select public.platform_set_grant('admin-2@geraiexpress.test', ${all}, 'race self restore');`);
    const suspend = asPlatformUser(ADMIN_2, `select public.platform_set_tenant_lifecycle('${TENANT_C}', 'active', 'suspended', 'race suspend');`);
    expect(await revoke).toBe("ok");
    expect(await restore).toMatch(/platform_access_required/);
    expect(await suspend).toMatch(/platform_access_required/);
    try {
      expect(sql(`select revoked_at is not null from public.platform_grants where user_id = '${ADMIN_2}'`)).toBe("t");
      expect(sql(`select lifecycle from public.tenants where id = '${TENANT_C}'`)).toBe("active");
      expect(sql(`select count(*) from public.audit_events where reason in ('race self restore', 'race suspend')`)).toBe("0");
    } finally {
      const admin = await signInAal2("admin@geraiexpress.test");
      expect((await admin.rpc("platform_set_grant", { p_email: "admin-2@geraiexpress.test",
        p_capabilities: ["tenant_governance", "platform_monitoring", "integration_operations", "access_governance", "audit_review"],
        p_reason: "Pulihkan fixture" })).error).toBeNull();
    }
  });
});

describe("audit (PR-28)", () => {
  it("is readable by audit reviewers; update, delete and truncate are refused by trigger as well as by grants", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_set_grant", { p_email: "admin-new@geraiexpress.test", p_capabilities: ["platform_monitoring", "audit_review"], p_reason: "Audit probe" })).error).toBeNull();
    const { data } = await admin.from("audit_events").select("id, action, reason").order("id", { ascending: false }).limit(1);
    expect(data![0]).toMatchObject({ action: "platform.grant", reason: "Audit probe" });
    const { data: projected } = await admin.rpc("platform_audit", { p_action: "platform.grant", p_limit: 1 });
    expect(projected![0]).toMatchObject({ actor_email: "admin@geraiexpress.test", target_user_email: "admin-new@geraiexpress.test", reason: "Audit probe" });
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_audit")).error?.message).toBe("platform_access_required");
    expect((await admin.from("audit_events").update({ reason: "x" }).eq("id", data![0].id)).error).not.toBeNull();
    expect((await admin.from("audit_events").delete().eq("id", data![0].id)).error).not.toBeNull();
    expect(() => sql(`update public.audit_events set reason = 'x' where id = ${data![0].id}`)).toThrow(/audit_is_append_only/);
    expect(() => sql(`delete from public.audit_events where id = ${data![0].id}`)).toThrow(/audit_is_append_only/);
  });
});


it("T-054 rejects a 13-hour-old or missing TOTP proof at the platform RPC boundary", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const amr of [[], [{ method: "totp", timestamp: now - 13 * 3600 }], [{ method: "totp", timestamp: now + 60 }]]) {
    const c = dataClient(process.env.POSTGREST_URL!, mintJwt({ sub: "00000000-0000-4000-a000-0000000000f1", role: "authenticated", aal: "aal2", amr }));
    expect((await c.rpc("platform_tenants")).error?.message).toBe("platform_access_required");
  }
  expect((await (await signInAal2("admin@geraiexpress.test")).rpc("platform_tenants")).error).toBeNull();
});
