import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDS, client, demoVisitor, machine, signIn, sql } from "./helpers";

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

describe("contact archive guard (T-028 / DEC-008)", () => {
  it("refuses operator and cross-tenant archiving via RPC or direct column update", async () => {
    const { data: created, error: createErr } = await ownerA
      .from("contacts")
      .insert({
        tenant_id: IDS.tenantA,
        name: "Kontak Uji Arsip",
        phone: "081288889999",
        is_recipient: true,
      })
      .select("id, revision, archived_at")
      .single();
    expect(createErr).toBeNull();
    expect(created).not.toBeNull();

    // Operator cannot archive via archive_contact RPC.
    const opRpc = await operatorA.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(opRpc.error?.message).toBe("admin_required");

    // Operator and tenant_admin cannot update archived_at directly through the Data API.
    const directOp = await operatorA
      .from("contacts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", created!.id);
    expect(directOp.error).not.toBeNull();

    const directAdmin = await ownerA
      .from("contacts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", created!.id);
    expect(directAdmin.error).not.toBeNull();

    // Cross-tenant admin and outsider receive not_found.
    const foreignTenant = await ownerB.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(foreignTenant.error?.message).toBe("not_found");

    const foreignContact = await ownerB.rpc("archive_contact", {
      p_tenant: IDS.tenantB,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(foreignContact.error?.message).toBe("not_found");

    const outsiderCall = await outsider.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(outsiderCall.error?.message).toBe("not_found");

    const { data: unchanged } = await ownerA
      .from("contacts")
      .select("archived_at, revision")
      .eq("id", created!.id)
      .single();
    expect(unchanged).toEqual({ archived_at: null, revision: created!.revision });
  });

  it("archives a contact for same-tenant admin, enforces expected revision, and refuses archiving twice", async () => {
    const { data: created, error: createErr } = await ownerA
      .from("contacts")
      .insert({
        tenant_id: IDS.tenantA,
        name: "Kontak Admin Arsip",
        phone: "081299990000",
        is_sender: true,
      })
      .select("id, revision")
      .single();
    expect(createErr).toBeNull();

    // Stale revision fails before archiving.
    const stale = await ownerA.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision + 3,
    });
    expect(stale.error?.message).toBe("stale_revision");

    // Valid archive sets archived_at and increments revision.
    const archived = await ownerA.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(archived.error).toBeNull();
    const row = archived.data as { id: string; archived_at: string | null; revision: number };
    expect(row.id).toBe(created!.id);
    expect(row.archived_at).not.toBeNull();
    expect(row.revision).toBe(created!.revision + 1);

    // Archiving a second time fails with contact_already_archived.
    const againCurrent = await ownerA.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: row.revision,
    });
    expect(againCurrent.error?.message).toBe("contact_already_archived");

    const againOld = await ownerA.rpc("archive_contact", {
      p_tenant: IDS.tenantA,
      p_contact: created!.id,
      p_expected_version: created!.revision,
    });
    expect(againOld.error?.message).toBe("contact_already_archived");
  });
});

describe("expired anonymous demo cleanup RPC (T-030)", () => {
  it("refuses anon and authenticated callers and validates max_age_hours", async () => {
    expect((await client().rpc("cleanup_expired_demos")).error).not.toBeNull();
    expect((await ownerA.rpc("cleanup_expired_demos")).error).not.toBeNull();
    expect((await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 0 })).error?.message).toBe("invalid_input");
    expect((await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 8761 })).error?.message).toBe("invalid_input");
  });

  it("deletes expired demo tenants and expired anonymous users while keeping recent demos and real tenants", async () => {
    const expired = await demoVisitor();
    const expiredUserId = (await expired.c.auth.getUser()).data.user!.id;
    const recent = await demoVisitor();
    const recentUserId = (await recent.c.auth.getUser()).data.user!.id;
    const orphanClient = client();
    const orphanUserId = (await orphanClient.auth.signInAnonymously()).data.user!.id;

    sql(`
      update public.tenants set created_at = now() - interval '30 hours' where id = '${expired.tenant}';
      update auth.users set created_at = now() - interval '30 hours' where id in ('${expiredUserId}', '${orphanUserId}');
    `);

    const res = await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 24 });
    expect(res.error).toBeNull();
    const summary = res.data as { deleted_tenants: number; deleted_users: number };
    expect(summary.deleted_tenants).toBeGreaterThanOrEqual(1);
    expect(summary.deleted_users).toBeGreaterThanOrEqual(2);

    // Expired demo tenant and both expired anonymous users are gone.
    expect(sql(`select count(*) from public.tenants where id = '${expired.tenant}'`)).toBe("0");
    expect(sql(`select count(*) from public.contacts where tenant_id = '${expired.tenant}'`)).toBe("0");
    expect(sql(`select count(*) from public.shipments where tenant_id = '${expired.tenant}'`)).toBe("0");
    expect(sql(`select count(*) from auth.users where id in ('${expiredUserId}', '${orphanUserId}')`)).toBe("0");

    // Recent demo tenant/user and real tenant/user remain untouched.
    expect(sql(`select count(*) from public.tenants where id = '${recent.tenant}'`)).toBe("1");
    expect(sql(`select count(*) from auth.users where id = '${recentUserId}'`)).toBe("1");
    expect(sql(`select count(*) from public.tenants where id = '${IDS.tenantA}'`)).toBe("1");
    expect(sql(`select count(*) from auth.users where email = 'owner-a@geraiexpress.test'`)).toBe("1");
  });
});
