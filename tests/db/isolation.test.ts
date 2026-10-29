// TEN-1 / DATA-1 / IAM-1 / IAM-4 / NFR-1: every case pairs a permitted same-tenant action with a
// denial for anonymous, outsider, other-tenant, escalation and reparenting attempts, through the
// same Data API and RPC surface a browser can call directly.
import { beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../../src/lib/auth/password";
import { IDS, anonymousSession, authService, client, codeSignIn, demoVisitor, sessionClient, signIn, sql } from "./helpers";

// SEC-5: the only way a password can exist on an address before its owner proved the inbox is a row nobody confirmed.
async function plantUnconfirmed(email: string, password: string) {
  sql(`insert into auth.users (id, email, encrypted_password, raw_app_meta_data) values ('${randomUUID()}', '${email}', '${await hashPassword(password)}', '{"provider":"email","providers":["email"]}')`);
}

let ownerA: TestClient;
let operatorA: TestClient;
let ownerB: TestClient;
let outsider: TestClient;

beforeAll(async () => {
  [ownerA, operatorA, ownerB, outsider] = await Promise.all([
    signIn("owner-a@geraiexpress.test"),
    signIn("operator-a@geraiexpress.test"),
    signIn("owner-b@geraiexpress.test"),
    signIn("no-access@geraiexpress.test"),
  ]);
});

describe("unauthenticated (anon key only)", () => {
  it("reads no tenant data", async () => {
    for (const table of ["tenants", "memberships", "outlets", "contacts", "shipments", "provider_operations"]) {
      const { data } = await client().from(table).select("*");
      expect(data ?? [], table).toHaveLength(0);
    }
  });
  it("cannot call commands", async () => {
    const { error } = await client().rpc("create_shipment_draft", { p_outlet: IDS.outletA });
    expect(error).not.toBeNull();
  });
});

describe("tenant scope", () => {
  it("member sees only own tenant, outlet, contacts and shipments", async () => {
    const { data: tenants } = await ownerA.from("tenants").select("id");
    expect(tenants!.map((t) => t.id)).toEqual([IDS.tenantA]);
    const { data: contacts } = await ownerA.from("contacts").select("id,tenant_id");
    expect(contacts!.every((c) => c.tenant_id === IDS.tenantA)).toBe(true);
    expect(contacts!.some((c) => c.id === IDS.contactA)).toBe(true);
    const { data: ships } = await ownerA.from("shipments").select("id");
    expect(ships!.map((s) => s.id)).toContain(IDS.shipmentA);
    expect(ships!.map((s) => s.id)).not.toContain(IDS.shipmentB);
  });

  it("foreign record lookup by id is empty, not an error that reveals it", async () => {
    const { data, error } = await ownerA.from("contacts").select("*").eq("id", IDS.contactB);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user without membership sees nothing", async () => {
    const { data } = await outsider.from("tenants").select("id");
    expect(data).toHaveLength(0);
    const { error } = await outsider.rpc("create_shipment_draft", { p_outlet: IDS.outletA });
    expect(error?.message).toBe("not_found");
  });

  it("member can create a contact in own tenant but not in another tenant", async () => {
    const ok = await operatorA.from("contacts")
      .insert({ tenant_id: IDS.tenantA, name: "Kontak Baru A", phone: "081233334444", is_sender: true })
      .select("id").single();
    expect(ok.error).toBeNull();
    const denied = await operatorA.from("contacts")
      .insert({ tenant_id: IDS.tenantB, name: "Sisipan Asing", phone: "081233335555", is_sender: true });
    expect(denied.error).not.toBeNull();
  });

  it("cannot update another tenant's contact", async () => {
    const { data } = await ownerA.from("contacts").update({ name: "Diubah A" }).eq("id", IDS.contactB).select();
    expect(data ?? []).toHaveLength(0);
    const { data: still } = await ownerB.from("contacts").select("name").eq("id", IDS.contactB).single();
    expect(still!.name).toBe("Kontak Rahasia B");
  });

  it("cannot reparent a contact by changing tenant_id", async () => {
    const { error } = await ownerA.from("contacts").update({ tenant_id: IDS.tenantB }).eq("id", IDS.contactA);
    expect(error).not.toBeNull();
  });

  it("cannot attach an address to another tenant's contact", async () => {
    const { error } = await ownerA.from("contact_addresses").insert({
      tenant_id: IDS.tenantA, contact_id: IDS.contactB, address_line: "Jl. Silang 1", area: "Kota Uji",
    });
    expect(error).not.toBeNull();
  });

  it("cannot point a shipment at another tenant's contact", async () => {
    const { error } = await ownerA.from("shipments")
      .update({ recipient_contact_id: IDS.contactB }).eq("id", IDS.shipmentA);
    expect(error).not.toBeNull();
  });

  it("commands on another tenant's objects are not found", async () => {
    for (const [fn, args] of [
      ["create_shipment_draft", { p_outlet: IDS.outletB }],
      ["request_quotes", { p_shipment: IDS.shipmentB, p_expected_revision: 1 }],
      ["confirm_shipment", { p_shipment: IDS.shipmentB, p_quote: IDS.shipmentB, p_expected_revision: 1, p_idempotency_key: "foreign-key-1" }],
      ["request_label", { p_shipment: IDS.shipmentB }],
      ["reconcile_shipment", { p_shipment: IDS.shipmentB }],
    ] as const) {
      const { error } = await ownerA.rpc(fn, args);
      expect(error?.message, fn).toBe("not_found");
    }
  });
});

describe("authority columns and escalation", () => {
  it("operator cannot change own role or add memberships", async () => {
    const upd = await operatorA.from("memberships").update({ role: "tenant_admin" })
      .eq("tenant_id", IDS.tenantA).eq("user_id", "00000000-0000-4000-a000-0000000000a2");
    expect(upd.error).not.toBeNull();
    const ins = await operatorA.from("memberships").insert({
      tenant_id: IDS.tenantB, user_id: "00000000-0000-4000-a000-0000000000a2", role: "tenant_admin",
    });
    expect(ins.error).not.toBeNull();
  });

  it("cannot write shipment state columns directly", async () => {
    const { error } = await ownerA.from("shipments")
      .update({ submission_state: "issued", awb: "FAKE123" }).eq("id", IDS.shipmentA);
    expect(error).not.toBeNull();
  });

  it("cannot create tenants or provider operations directly", async () => {
    expect((await ownerA.from("tenants").insert({ name: "Tenant Liar", lifecycle: "active" })).error).not.toBeNull();
    expect((await ownerA.from("provider_operations").insert({
      tenant_id: IDS.tenantA, shipment_id: IDS.shipmentA, kind: "create_order", idempotency_key: "direct-insert",
      input_digest: "x", state: "succeeded", is_simulated: false, actor: "00000000-0000-4000-a000-0000000000a1",
    })).error).not.toBeNull();
  });

  it("private cost table grants nothing to API roles", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`select has_table_privilege('${role}', 'private.quote_costs', 'select')`), role).toBe("f");
    }
    expect(sql("select relrowsecurity from pg_class where oid = 'private.quote_costs'::regclass")).toBe("t");
  });

  it("real tenant cannot quote without a connected provider (no invented prices)", async () => {
    await ownerA.from("shipments").update({
      recipient_name: "Penerima A", recipient_phone: "081211112222", recipient_address: "Jl. Tujuan A No. 9",
      recipient_area: "Kec. Tujuan, Kota A",
    }).eq("id", IDS.shipmentA);
    const { data: s } = await ownerA.from("shipments").select("revision").eq("id", IDS.shipmentA).single();
    const { error } = await ownerA.rpc("request_quotes", { p_shipment: IDS.shipmentA, p_expected_revision: s!.revision });
    expect(error?.message).toBe("provider_not_connected");
  });

  it("a real (non-anonymous) identity cannot start or reset a demo workspace", async () => {
    expect((await ownerA.rpc("start_demo")).error?.message).toBe("demo_requires_anonymous_session");
    expect((await ownerA.rpc("reset_demo")).error?.message).toBe("demo_requires_anonymous_session");
  });
});

describe("demo isolation (IAM-4)", () => {
  it("an anonymous identity never acts in a real tenant, even with a membership row", async () => {
    const v = await demoVisitor();
    const { data: me } = await v.c.auth.getUser();
    sql(`insert into public.memberships (tenant_id, user_id, role) values ('${IDS.tenantA}', '${me.user!.id}', 'tenant_admin')`);
    try {
      const { data } = await v.c.from("contacts").select("id").eq("tenant_id", IDS.tenantA);
      expect(data).toHaveLength(0);
      const { error } = await v.c.rpc("request_label", { p_shipment: IDS.shipmentA });
      expect(error?.message).toBe("not_found");
    } finally {
      sql(`delete from public.memberships where tenant_id = '${IDS.tenantA}' and user_id = '${me.user!.id}'`);
    }
  });

  it("each visitor gets a separate demo tenant and cannot see real or other demo data", async () => {
    const v1 = await demoVisitor();
    const v2 = await demoVisitor();
    expect(v1.tenant).not.toBe(v2.tenant);

    const again = await v1.c.rpc("start_demo");
    expect(again.data).toBe(v1.tenant);

    const { data: t1 } = await v1.c.from("tenants").select("id,is_demo");
    expect(t1).toEqual([{ id: v1.tenant, is_demo: true }]);
    const { data: foreign } = await v1.c.from("contacts").select("id").in("tenant_id", [v2.tenant, IDS.tenantA]);
    expect(foreign).toHaveLength(0);
    const { error } = await v1.c.from("contacts")
      .insert({ tenant_id: IDS.tenantA, name: "Demo Menyusup", phone: "081200009999", is_sender: true });
    expect(error).not.toBeNull();
  });
});

describe("registration gate (PR-29)", () => {
  it("the conversion outcome is refused in the database even if a direct update attempted it", async () => {
    const anon = client();
    const { data } = await anon.auth.signInAnonymously();
    const id = data.user!.id;
    expect(() => sql(`update auth.users set email = 'direct-${id}@geraiexpress.test', email_confirmed_at = now() where id = '${id}'`))
      .toThrow(/anonymous_identity_is_demo_only/);
    for (const change of [
      "is_anonymous = false",
      `email_change = 'pending-${id}@geraiexpress.test'`,
      "phone = '6281200000001'",
      "phone_change = '6281200000002'",
      "encrypted_password = 'x'",
    ]) {
      expect(() => sql(`update auth.users set ${change} where id = '${id}'`), change)
        .toThrow(/anonymous_identity_is_demo_only/);
    }
    // Ordinary Auth bookkeeping on the same row still succeeds.
    expect(sql(`update auth.users set last_sign_in_at = now() where id = '${id}' returning is_anonymous`)).toContain("t");
  });

  it("an anonymous demo identity cannot start an email, phone or password conversion at all (PR-31)", async () => {
    const auth = authService();
    const anon = await anonymousSession();
    const email = `convert-${Date.now()}@geraiexpress.test`;
    // IAM-8: an anonymous requester never gets a code, so no mail can go out at all.
    expect(await auth.requestEmailCode({ email, captchaToken: undefined, requesterId: anon.id })).toEqual({ status: "withheld" });
    expect(sql(`select count(*) from auth.otp_codes where email = '${email}'`)).toBe("0");
    // Neither a password nor a second factor can be attached to the identity.
    expect(await auth.setPassword({ userId: anon.id, sessionId: anon.session.sessionId, password: "convert-password-123" })).toEqual({ ok: false, reason: "invalid" });
    expect(await auth.enrollTotp({ userId: anon.id, email })).toEqual({ ok: false, reason: "invalid" });
    // The row itself refuses every conversion attempted through SQL.
    for (const change of [`email = '${email}'`, "phone = '+6281200000000'", "encrypted_password = 'convert-password-123'"]) {
      expect(() => sql(`update auth.users set ${change} where id = '${anon.id}'`), change).toThrow(/anonymous_identity_is_demo_only/);
    }
    // No pending change was stored, so no confirmation exists for an inbox owner to complete.
    expect(sql(`select coalesce(email,'') || '|' || coalesce(email_change,'') || '|' || coalesce(phone_change,'') || '|' || is_anonymous from auth.users where id = '${anon.id}'`)).toBe("|||true");
    expect(await auth.signInWithPassword({ email, password: "convert-password-123", captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
    // The session itself keeps working for the demo, and the refreshed identity is still anonymous.
    const refreshed = await auth.refresh(anon.session.refreshToken!);
    if (!refreshed.ok) throw new Error(`refresh: ${refreshed.reason}`);
    expect(refreshed.session).toMatchObject({ userId: anon.id, isAnonymous: true, email: null, hasPassword: false });
    const verified = await auth.verifyAccessToken(refreshed.session.accessToken);
    expect(verified).toMatchObject({ ok: true, claims: { sub: anon.id, is_anonymous: true, email: "" } });
    expect(await auth.sessionLive(anon.session.sessionId)).toMatchObject({ live: true, isAnonymous: true });
    expect((await sessionClient(refreshed.session).rpc("start_demo")).error).toBeNull();
  });

  it("while registration is closed, new real accounts are refused and demo sign-in still works", async () => {
    const auth = authService();
    const early = `closed-early-${Date.now()}@geraiexpress.test`;
    const sent = await auth.requestEmailCode({ email: early, captchaToken: undefined });
    if (sent.status !== "sent") throw new Error(`code not sent: ${sent.status}`);
    sql(`update private.settings set value = 'false' where key = 'registration_open'`);
    try {
      const email = `closed-${Date.now()}@geraiexpress.test`;
      expect(await auth.requestEmailCode({ email, captchaToken: undefined })).toEqual({ status: "withheld" });
      expect(await auth.signInWithPassword({ email, password: "probe-password-123", captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
      expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe("0");
      expect(sql(`select count(*) from auth.otp_codes where email = '${email}'`)).toBe("0");
      // A code mailed before the gate closed cannot create the account afterwards.
      expect(await auth.verifyEmailCode({ email: early, code: sent.code, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid" });
      expect(sql(`select count(*) from auth.users where email = '${early}'`)).toBe("0");
      expect((await authService().signInAnonymous({ captchaToken: undefined })).ok).toBe(true);
    } finally {
      sql(`update private.settings set value = 'true' where key = 'registration_open'`);
    }
  });

  it("a password pre-planted on someone else's email dies when the owner verifies (SEC-5)", async () => {
    const auth = authService();
    // Self-asserted profile data has no entry point: extra fields are ignored and nothing exists before the code is verified.
    const probe = `preplant-data-${Date.now()}@geraiexpress.test`;
    const withData = { email: probe, captchaToken: undefined, data: { role: "tenant_admin", planted: true } };
    const probeCode = await auth.requestEmailCode(withData);
    if (probeCode.status !== "sent") throw new Error(`code not sent: ${probeCode.status}`);
    expect(sql(`select count(*) from auth.users where email = '${probe}'`)).toBe("0");
    const probeSession = await auth.verifyEmailCode({ email: probe, code: probeCode.code, captchaToken: undefined });
    if (!probeSession.ok) throw new Error("probe not verified");
    expect(sql(`select raw_user_meta_data::text from auth.users where email = '${probe}'`)).toBe("{}");
    expect(JSON.stringify(await auth.verifyAccessToken(probeSession.session.accessToken))).not.toContain("planted");

    // The attacker's only way to hold a password on a stranger's address is a row nobody confirmed.
    const email = `preplant-${Date.now()}@geraiexpress.test`;
    const planted = "attacker-pass-123";
    expect(await auth.signInWithPassword({ email, password: planted, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe("0");
    await plantUnconfirmed(email, planted);
    expect(await auth.signInWithPassword({ email, password: planted, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
    // The owner proves inbox control with a code.
    const owner = await codeSignIn(email);
    // The planted password no longer works; the owner has no password until they set one.
    expect(owner.session.hasPassword).toBe(false);
    expect(sql(`select encrypted_password = '' from auth.users where email = '${email}'`)).toBe("t");
    expect(await auth.signInWithPassword({ email, password: planted, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(((await owner.c.rpc("my_account_state")).data as { has_password: boolean }[])[0].has_password).toBe(false);
    expect(await auth.setPassword({ userId: owner.id, sessionId: owner.session.sessionId, password: "owner-pass-12345" })).toEqual({ ok: true });
    expect(await auth.signInWithPassword({ email, password: "owner-pass-12345", captchaToken: undefined })).toMatchObject({ ok: true, session: { userId: owner.id, hasPassword: true } });
    expect(await auth.signInWithPassword({ email, password: planted, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("the code path discards a password planted after the code was issued too (SEC-5)", async () => {
    const auth = authService();
    const email = `preplant-code-${Date.now()}@geraiexpress.test`;
    const sent = await auth.requestEmailCode({ email, captchaToken: undefined });
    if (sent.status !== "sent") throw new Error(`code not sent: ${sent.status}`);
    // The row appears between the code request and its verification, carrying the attacker's password.
    await plantUnconfirmed(email, "attacker-pass-123");
    const verified = await auth.verifyEmailCode({ email, code: sent.code, captchaToken: undefined });
    expect(verified).toMatchObject({ ok: true, session: { email, hasPassword: false } });
    expect(await auth.signInWithPassword({ email, password: "attacker-pass-123", captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
  });
});
