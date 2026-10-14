// PR-29 / PR-30 / PR-15 / TEN-5 / DATA-7 / DEC-007: verified identities keep one open application;
// only a Super Admin (aal2) review turns it into exactly one tenant, outlet and admin membership.
import { describe, expect, it } from "vitest";
import { client, demoVisitor, signIn, signInAal2, sql, verifiedNewUser } from "./helpers";

const FULL = {
  p_business_name: "Toko Uji Daftar", p_outlet_name: "Outlet Uji Daftar",
  p_pickup_address: "Jl. Pendaftaran No. 7", p_pickup_area: "Kec. Uji, Kota Daftar", p_contact_phone: "081277778888",
};

describe("applicant boundary (TEN-5)", () => {
  it("anonymous, demo and signed-out callers cannot create an application", async () => {
    for (const c of [client(), (await demoVisitor()).c]) {
      const { error } = await c.rpc("save_application", { p_expected_revision: 0, ...FULL });
      expect(error).not.toBeNull();
    }
  });

  it("one open application per identity, revision-guarded, complete before submit, locked after", async () => {
    const { c } = await verifiedNewUser();
    const first = await c.rpc("save_application", { p_expected_revision: 0, p_business_name: "Toko Draf",
      p_outlet_name: null, p_pickup_address: null, p_pickup_area: null, p_contact_phone: null });
    expect(first.error).toBeNull();
    const draft = first.data![0] as { id: string; revision: number };
    expect(draft.revision).toBe(1);
    // A second "new" save does not create another application; it conflicts with the open one.
    expect((await c.rpc("save_application", { p_expected_revision: 0, ...FULL })).error?.message).toBe("stale_state");
    expect((await c.rpc("submit_application", { p_id: draft.id, p_expected_revision: 1 })).error?.message).toBe("incomplete_application");
    const full = await c.rpc("save_application", { p_expected_revision: 1, ...FULL });
    expect((full.data![0] as { id: string }).id).toBe(draft.id);
    expect((await c.rpc("submit_application", { p_id: draft.id, p_expected_revision: 2 })).error).toBeNull();
    expect((await c.rpc("save_application", { p_expected_revision: 3, ...FULL })).error?.message).toBe("application_locked");

    // Another verified identity sees nothing and cannot act on it.
    const other = await verifiedNewUser("other");
    expect((await other.c.from("tenant_applications").select("id").eq("id", draft.id)).data).toEqual([]);
    expect((await other.c.rpc("withdraw_application", { p_id: draft.id, p_expected_revision: 3 })).error?.message).toBe("not_found");
    // Bad input is refused by the database too.
    expect((await other.c.rpc("save_application", { p_expected_revision: 0, ...FULL, p_contact_phone: "abc" })).error).not.toBeNull();
  });

  it("while registration is closed no application can be created or submitted", async () => {
    const { c } = await verifiedNewUser();
    sql(`update private.settings set value = 'false' where key = 'registration_open'`);
    try {
      expect((await c.rpc("save_application", { p_expected_revision: 0, ...FULL })).error?.message).toBe("registration_closed");
    } finally {
      sql(`update private.settings set value = 'true' where key = 'registration_open'`);
    }
  });
});

describe("Super Admin review (PR-15 / PR-30)", () => {
  it("applicants cannot see which administrator reviewed them", async () => {
    const { c } = await verifiedNewUser();
    expect((await c.from("tenant_applications").select("reviewed_by")).error).not.toBeNull();
    expect((await c.from("tenant_applications").select("id, status, review_reason")).error).toBeNull();
  });

  async function submitted() {
    const applicant = await verifiedNewUser();
    const saved = await applicant.c.rpc("save_application", { p_expected_revision: 0, ...FULL, p_business_name: `Toko ${Date.now()}` });
    const { id } = saved.data![0] as { id: string };
    await applicant.c.rpc("submit_application", { p_id: id, p_expected_revision: 1 });
    return { ...applicant, appId: id, revision: 2 };
  }

  it("tenant users and aal1 sessions cannot list or decide applications", async () => {
    const a = await submitted();
    for (const c of [await signIn("owner-a@geraiexpress.test"), await signIn("admin@geraiexpress.test"), a.c]) {
      expect((await c.rpc("platform_applications", { p_status: "submitted" })).error?.message).toBe("platform_access_required");
      expect((await c.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: a.revision, p_decision: "approve", p_reason: "self approve" })).error?.message).toBe("platform_access_required");
    }
    expect(sql(`select status from public.tenant_applications where id = '${a.appId}'`)).toBe("submitted");
  });

  it("approval creates exactly one active tenant, outlet and admin membership, once, with audit", async () => {
    const a = await submitted();
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: a.revision, p_decision: "approve", p_reason: "" })).error?.message).toBe("reason_required");
    const ok = await admin.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: a.revision, p_decision: "approve", p_reason: "Data lengkap" });
    expect(ok.error).toBeNull();
    const tenant = ok.data as string;
    // A replayed or concurrent second decision cannot provision again.
    expect((await admin.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: a.revision, p_decision: "approve", p_reason: "Data lengkap" })).error?.message).toBe("stale_state");
    expect(sql(`select count(*) from public.tenants where id = '${tenant}' and lifecycle = 'active' and not is_demo`)).toBe("1");
    expect(sql(`select count(*) from public.outlets where tenant_id = '${tenant}'`)).toBe("1");
    expect(sql(`select role from public.memberships where tenant_id = '${tenant}' and user_id = '${a.id}'`)).toBe("tenant_admin");
    expect(sql(`select count(*) from public.audit_events where action = 'application.review' and target_tenant = '${tenant}'`)).toBe("1");
    expect(sql(`select count(*) from public.memberships where user_id = '${a.id}'`)).toBe("1");
    // The applicant now works in their own gerai and sees nothing of others.
    expect((await a.c.from("outlets").select("tenant_id")).data).toEqual([{ tenant_id: tenant }]);
  });

  it("changes requested reopens editing; rejection closes it and allows a fresh application", async () => {
    const a = await submitted();
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: a.revision, p_decision: "request_changes", p_reason: "Alamat kurang jelas" })).error).toBeNull();
    const edited = await a.c.rpc("save_application", { p_expected_revision: a.revision + 1, ...FULL, p_pickup_address: "Jl. Pendaftaran No. 7, RT 1/RW 2" });
    expect(edited.error).toBeNull();
    const rev = (edited.data![0] as { revision: number }).revision;
    expect((await a.c.rpc("submit_application", { p_id: a.appId, p_expected_revision: rev })).error).toBeNull();
    expect((await admin.rpc("platform_review_application", { p_id: a.appId, p_expected_revision: rev + 1, p_decision: "reject", p_reason: "Bukan usaha pengiriman" })).error).toBeNull();
    expect(sql(`select status || ':' || (tenant_id is null) from public.tenant_applications where id = '${a.appId}'`)).toBe("rejected:true");
    expect((await a.c.rpc("save_application", { p_expected_revision: 0, ...FULL })).error).toBeNull();
  });
});
