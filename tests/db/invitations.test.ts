// PR-31 / PR-32 / IAM-2 / TEN-5 / DATA-7 / DEC-007 / DEC-008: invitations bind one email, tenant
// and role; only that verified identity accepts, once, while the issuer is still an admin; role
// changes keep an admin; the admin-only recovery re-checks the role after locking.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, IDS, authService, client, codeSignIn, demoVisitor, signIn, sql, verifiedNewUser } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";

function freshEmail(prefix = "staf") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@geraiexpress.test`;
}

describe("who may invite", () => {
  it("operators, other tenants' admins, demo admins and outsiders cannot invite into tenant A", async () => {
    const email = freshEmail();
    const callers = [await signIn("operator-a@geraiexpress.test"), await signIn("owner-b@geraiexpress.test"), client()];
    for (const c of callers) {
      expect((await c.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: email, p_role: "operator" })).error).not.toBeNull();
    }
    const demo = await demoVisitor();
    expect((await demo.c.rpc("invite_member", { p_tenant: demo.tenant, p_email: email, p_role: "operator" })).error?.message).toBe("demo_restricted");
    expect(sql(`select count(*) from public.tenant_invitations where email = '${email}'`)).toBe("0");
    // Invitations are not readable directly, only through scoped RPCs.
    expect((await (await signIn("owner-a@geraiexpress.test")).from("tenant_invitations").select("id")).error).not.toBeNull();
    expect((await (await signIn("operator-a@geraiexpress.test")).rpc("tenant_members", { p_tenant: IDS.tenantA })).error?.message).toBe("admin_required");
  });
});

describe("invitation cap", () => {
  it("a gerai holds at most 20 pending invitations", async () => {
    const TENANT_C = "00000000-0000-4000-b000-00000000000c";
    const ownerC = await signIn("owner-c@geraiexpress.test");
    try {
      for (let n = 0; n < 20; n++) {
        expect((await ownerC.rpc("invite_member", { p_tenant: TENANT_C, p_email: freshEmail(`cap${n}`), p_role: "operator" })).error).toBeNull();
      }
      expect((await ownerC.rpc("invite_member", { p_tenant: TENANT_C, p_email: freshEmail("cap-over"), p_role: "operator" })).error?.message).toBe("too_many_invitations");
    } finally {
      sql(`update public.tenant_invitations set status = 'revoked', revoked_at = now() where tenant_id = '${TENANT_C}' and status = 'pending'`);
    }
  });
});

describe("accepting (PR-31)", () => {
  it("an invited email can register while registration is closed and accepts exactly once", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const email = freshEmail();
    const inv = await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: email.toUpperCase(), p_role: "operator" });
    expect(inv.error).toBeNull();
    expect((await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: email, p_role: "operator" })).error?.message).toBe("already_invited");
    expect((await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: freshEmail(), p_role: null })).error?.message).toBe("transition_not_allowed");
    sql(`update private.settings set value = 'false' where key = 'registration_open'`);
    try {
      // Not invited: refused while closed, and no code exists to verify. Invited: allowed.
      const uninvited = freshEmail("asing");
      expect(await authService().requestEmailCode({ email: uninvited, captchaToken: undefined })).toEqual({ status: "withheld" });
      expect(sql(`select count(*) from auth.otp_codes where email = '${uninvited}'`)).toBe("0");
      const staff = await codeSignIn(email);
      const mine = await staff.c.rpc("my_invitations");
      expect(mine.data).toEqual([expect.objectContaining({ id: inv.data, tenant_name: "Gerai Uji A", role: "operator", invited_by_email: "owner-a@geraiexpress.test" })]);
      const [first, second] = await Promise.all([
        staff.c.rpc("accept_invitation", { p_id: inv.data }),
        staff.c.rpc("accept_invitation", { p_id: inv.data }),
      ]);
      expect([first.error, second.error].filter((e) => e === null)).toHaveLength(1);
      expect(sql(`select role || ':' || status from public.memberships where tenant_id = '${IDS.tenantA}' and user_id = '${staff.id}'`)).toBe("operator:active");
      expect((await staff.c.from("contacts").select("id").eq("tenant_id", IDS.tenantA)).data!.length).toBeGreaterThan(0);
      expect((await staff.c.from("contacts").select("id").eq("tenant_id", IDS.tenantB)).data).toEqual([]);
      sql(`update public.memberships set status = 'revoked' where tenant_id = '${IDS.tenantA}' and user_id = '${staff.id}'`);
    } finally {
      sql(`update private.settings set value = 'true' where key = 'registration_open'`);
    }
  });

  it("wrong email, expired, revoked and issuer-demoted invitations grant nothing", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const target = freshEmail();
    const inv = (await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: target, p_role: "tenant_admin" })).data as string;
    // A different verified person cannot accept it, and learns nothing about it.
    const stranger = await verifiedNewUser("asing");
    expect((await stranger.c.rpc("accept_invitation", { p_id: inv })).error?.message).toBe("not_found");
    expect((await stranger.c.rpc("my_invitations")).data).toEqual([]);

    const staff = await codeSignIn(target);
    sql(`update public.tenant_invitations set expires_at = now() - interval '1 minute' where id = '${inv}'`);
    expect((await staff.c.rpc("my_invitations")).data).toEqual([]);
    expect(((await owner.rpc("tenant_invitations_list", { p_tenant: IDS.tenantA })).data as { id: string }[]).map((x) => x.id)).not.toContain(inv);
    expect((await staff.c.rpc("accept_invitation", { p_id: inv })).error?.message).toBe("invitation_unavailable");

    // A fresh invitation replaces the expired one; revoking it closes it.
    const again = await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: target, p_role: "operator" });
    expect(again.error).toBeNull();
    expect((await owner.rpc("revoke_invitation", { p_id: again.data, p_expected_revision: 1 })).error).toBeNull();
    expect((await staff.c.rpc("accept_invitation", { p_id: again.data })).error?.message).toBe("invitation_unavailable");

    // Issued by someone who is no longer an admin there: refused.
    const third = (await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: target, p_role: "operator" })).data as string;
    sql(`update public.tenant_invitations set invited_by = '${OPERATOR_A}' where id = '${third}'`);
    // The inviter's email is shown only while they are still an admin there.
    expect((await staff.c.rpc("my_invitations")).data).toEqual([expect.objectContaining({ id: third, invited_by_email: null })]);
    expect((await staff.c.rpc("accept_invitation", { p_id: third })).error?.message).toBe("invitation_unavailable");
    expect(sql(`select count(*) from public.memberships where user_id = '${staff.id}'`)).toBe("0");
    sql(`update public.tenant_invitations set status = 'revoked', revoked_at = now() where id = '${third}'`);
  });
});

describe("member management (DEC-008)", () => {
  it("an admin changes roles and deactivates members, but the last admin always remains", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const members = (await owner.rpc("tenant_members", { p_tenant: IDS.tenantA })).data as { user_id: string; email: string; revision: number }[];
    expect(members.map((m) => m.email)).toEqual(expect.arrayContaining(["owner-a@geraiexpress.test", "operator-a@geraiexpress.test"]));
    const self = members.find((m) => m.user_id === OWNER_A)!;
    expect((await owner.rpc("set_member_role", { p_tenant: IDS.tenantA, p_user: OWNER_A, p_role: "operator", p_expected_revision: self.revision })).error?.message).toBe("last_tenant_admin");
    expect((await owner.rpc("deactivate_member", { p_tenant: IDS.tenantA, p_user: OWNER_A, p_expected_revision: self.revision })).error?.message).toBe("last_tenant_admin");
    const op = members.find((m) => m.user_id === OPERATOR_A)!;
    expect((await owner.rpc("set_member_role", { p_tenant: IDS.tenantA, p_user: OPERATOR_A, p_role: "tenant_admin", p_expected_revision: op.revision + 9 })).error?.message).toBe("stale_state");
    try {
      expect((await owner.rpc("set_member_role", { p_tenant: IDS.tenantA, p_user: OPERATOR_A, p_role: "tenant_admin", p_expected_revision: op.revision })).error).toBeNull();
      // With a second admin, the first may step down.
      expect((await owner.rpc("set_member_role", { p_tenant: IDS.tenantA, p_user: OWNER_A, p_role: "operator", p_expected_revision: self.revision })).error).toBeNull();
      expect((await owner.rpc("tenant_members", { p_tenant: IDS.tenantA })).error?.message).toBe("admin_required");
    } finally {
      sql(`update public.memberships set role = 'tenant_admin', revision = revision + 1 where tenant_id = '${IDS.tenantA}' and user_id = '${OWNER_A}'`);
      sql(`update public.memberships set role = 'operator', revision = revision + 1 where tenant_id = '${IDS.tenantA}' and user_id = '${OPERATOR_A}'`);
    }
  });

  it("a deactivated member loses access immediately", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const email = freshEmail();
    const inv = (await owner.rpc("invite_member", { p_tenant: IDS.tenantA, p_email: email, p_role: "operator" })).data as string;
    const staff = await codeSignIn(email);
    expect((await staff.c.rpc("accept_invitation", { p_id: inv })).error).toBeNull();
    expect((await staff.c.from("outlets").select("id").eq("tenant_id", IDS.tenantA)).data).toHaveLength(1);
    const rev = Number(sql(`select revision from public.memberships where tenant_id = '${IDS.tenantA}' and user_id = '${staff.id}'`));
    expect((await owner.rpc("deactivate_member", { p_tenant: IDS.tenantA, p_user: staff.id, p_expected_revision: rev })).error).toBeNull();
    expect((await staff.c.from("outlets").select("id").eq("tenant_id", IDS.tenantA)).data).toEqual([]);
  });
});

// Concurrency: a demotion committed while the admin's recovery call waits must refuse recovery.
const run = promisify(execFile);
function asUser(user: string, body: string) {
  const claims = JSON.stringify({ sub: user, role: "authenticated", aal: "aal1", is_anonymous: false });
  const script = `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ${body} commit;`;
  return run("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c", script])
    .then(() => "ok", (e: { stderr?: string }) => e.stderr ?? "error");
}

describe("concurrent last-admin removal (IAM-2)", () => {
  it("two admins demoting each other at once leave exactly one admin", async () => {
    sql(`update public.memberships set role = 'tenant_admin', revision = revision + 1 where tenant_id = '${IDS.tenantA}' and user_id = '${OPERATOR_A}'`);
    try {
      const revOwner = Number(sql(`select revision from public.memberships where tenant_id = '${IDS.tenantA}' and user_id = '${OWNER_A}'`));
      const revOp = Number(sql(`select revision from public.memberships where tenant_id = '${IDS.tenantA}' and user_id = '${OPERATOR_A}'`));
      const [a, b] = await Promise.all([
        asUser(OWNER_A, `select public.set_member_role('${IDS.tenantA}', '${OPERATOR_A}', 'operator', ${revOp}); select pg_sleep(0.5);`),
        asUser(OPERATOR_A, `select public.set_member_role('${IDS.tenantA}', '${OWNER_A}', 'operator', ${revOwner}); select pg_sleep(0.5);`),
      ]);
      expect([a, b].filter((r) => r === "ok")).toHaveLength(1);
      expect(sql(`select count(*) from public.memberships where tenant_id = '${IDS.tenantA}' and status = 'active' and role = 'tenant_admin'`)).toBe("1");
    } finally {
      sql(`update public.memberships set role = 'tenant_admin', revision = revision + 1 where tenant_id = '${IDS.tenantA}' and user_id = '${OWNER_A}'`);
      sql(`update public.memberships set role = 'operator', revision = revision + 1 where tenant_id = '${IDS.tenantA}' and user_id = '${OPERATOR_A}'`);
    }
  });
});

describe("role re-check after lock (T-010 follow-up)", () => {
  it("an admin demoted while their recovery call waits cannot reconcile", async () => {
    const demo = await demoVisitor();
    const { data: me } = await demo.c.auth.getUser();
    const { data: s } = await demo.c.from("shipments").select("id").eq("tenant_id", demo.tenant).eq("submission_state", "unknown").single();
    // Hold the member rows locked while demoting, then let the reconcile call queue behind it.
    const demote = run("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c",
      `begin; update public.memberships set role = 'operator' where tenant_id = '${demo.tenant}'; select pg_sleep(1.5); commit;`]);
    await new Promise((r) => setTimeout(r, 400));
    const reconcile = asUser(me.user!.id, `select public.reconcile_shipment('${s!.id}');`);
    await demote;
    expect(await reconcile).toMatch(/admin_required/);
    expect(sql(`select submission_state from public.shipments where id = '${s!.id}'`)).toBe("unknown");
  });
});
