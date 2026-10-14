// TEN-1 / DATA-1 / IAM-1 / IAM-4 / NFR-1: every case pairs a permitted same-tenant action with a
// denial for anonymous, outsider, other-tenant, escalation and reparenting attempts, through the
// same Data API and RPC surface a browser can call directly.
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDS, client, demoVisitor, mailCode, signIn, sql } from "./helpers";
import { mailCount } from "../mail";

let ownerA: SupabaseClient;
let operatorA: SupabaseClient;
let ownerB: SupabaseClient;
let outsider: SupabaseClient;

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

describe("registration gate (PR-29 pending)", () => {
  it("an anonymous demo identity cannot start an email or phone conversion at all (PR-31)", async () => {
    const anon = client();
    const { data } = await anon.auth.signInAnonymously();
    const id = data.user!.id;
    const email = `convert-${Date.now()}@geraiexpress.test`;
    expect((await anon.auth.updateUser({ email })).error).not.toBeNull();
    // DEC-009: the Worker's Send Email Hook refuses anonymous identities, so no mail went out at all.
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailCount(email)).toBe(0);
    expect((await anon.auth.updateUser({ phone: "+6281200000000" })).error).not.toBeNull();
    expect((await anon.auth.updateUser({ password: "convert-password-123" })).error).not.toBeNull();
    // No pending change was stored, so no confirmation link exists for an inbox owner to click.
    expect(sql(`select coalesce(email,'') || '|' || coalesce(email_change,'') || '|' || coalesce(phone_change,'') || '|' || is_anonymous from auth.users where id = '${id}'`)).toBe("|||true");
    const login = await client().auth.signInWithPassword({ email, password: "convert-password-123" });
    expect(login.error).not.toBeNull();
    // The session itself keeps working for the demo.
    expect((await anon.auth.refreshSession()).error).toBeNull();
    expect((await anon.rpc("start_demo")).error).toBeNull();
  });

  it("the conversion outcome is refused in the database even if Auth attempted it directly", async () => {
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

  it("while registration is closed, new real accounts are refused and demo sign-in still works", async () => {
    sql(`update private.settings set value = 'false' where key = 'registration_open'`);
    try {
      const email = `closed-${Date.now()}@geraiexpress.test`;
      expect((await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } })).error).not.toBeNull();
      expect((await client().auth.signUp({ email, password: "probe-password-123" })).error).not.toBeNull();
      expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe("0");
      expect((await client().auth.signInAnonymously()).error).toBeNull();
    } finally {
      sql(`update private.settings set value = 'true' where key = 'registration_open'`);
    }
  });

  it("a password pre-planted on someone else's email dies when the owner verifies (SEC-5)", async () => {
    const email = `preplant-${Date.now()}@geraiexpress.test`;
    // Self-asserted profile data is refused outright; the attacker falls back to a bare password.
    expect((await client().auth.signUp({ email, password: "attacker-pass-123", options: { data: { role: "tenant_admin", planted: true } } })).error).not.toBeNull();
    expect((await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { planted: true } } })).error).not.toBeNull();
    expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe("0");
    await new Promise((r) => setTimeout(r, 1200));
    expect((await client().auth.signUp({ email, password: "attacker-pass-123" })).error).toBeNull();
    expect((await client().auth.signInWithPassword({ email, password: "attacker-pass-123" })).error).not.toBeNull();
    // The owner proves inbox control with a code (Auth allows one mail per address per second locally).
    await new Promise((r) => setTimeout(r, 1200));
    const owner = client();
    expect((await owner.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })).error).toBeNull();
    expect((await owner.auth.verifyOtp({ email, token: await mailCode(email), type: "email" })).error).toBeNull();
    // The planted password no longer works; the owner has no password until they set one.
    expect((await client().auth.signInWithPassword({ email, password: "attacker-pass-123" })).error).not.toBeNull();
    expect(((await owner.rpc("my_account_state")).data as { has_password: boolean }[])[0].has_password).toBe(false);
    expect((await owner.auth.getUser()).data.user?.user_metadata).not.toHaveProperty("planted");
    expect((await owner.auth.updateUser({ password: "owner-pass-12345" })).error).toBeNull();
    expect((await client().auth.signInWithPassword({ email, password: "owner-pass-12345" })).error).toBeNull();
  });

  it("the signup confirmation code path discards a planted password too (SEC-5)", async () => {
    const email = `preplant-signup-${Date.now()}@geraiexpress.test`;
    expect((await client().auth.signUp({ email, password: "attacker-pass-123" })).error).toBeNull();
    const owner = client();
    expect((await owner.auth.verifyOtp({ email, token: await mailCode(email), type: "signup" })).error).toBeNull();
    expect((await client().auth.signInWithPassword({ email, password: "attacker-pass-123" })).error).not.toBeNull();
  });
});
