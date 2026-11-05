// T-035 / TEN-1 / SEC-1 / NFR-1 (review DIL-02, DIL-11, DIL-12, DIL-18): the privilege surface is
// proven from the catalog, not from a few hand-picked calls. Any function or table added by a later
// migration fails these tests until its exposure is declared here on purpose.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { DB_CONTAINER, DB_NAME, IDS, client, machine, signIn, sql } from "./helpers";

// Functions the anon role (and therefore PUBLIC) may execute, as full signatures
// `schema.name(argument types)` (the catalog's regprocedure text under an empty search_path), sorted,
// one per line. Every entry needs a reason; an unexplained entry is a finding, not an allowance. A
// signature, not a name, is allowlisted: a second overload of an allowed name stays refused.
const ANON_EXECUTE = [
  // Returns one boolean (is self-registration open). The login page and the public landing flow
  // read it before a session exists; it exposes no tenant or identity data.
  "public.registration_open()",
  // T-085: opaque bearer capability; fixed privacy projection, no table grant or shipment-id lookup.
  "public.track_shipment(text)",
];

// Functions the authenticated role may execute, full signatures `schema.name(argument types)`, ONE
// sorted constant, one entry per line. This list is the user-callable RPC surface (Data API /rpc plus the RLS helper functions).
// It MUST be updated deliberately, in the same change, when a migration adds or removes a
// user-callable RPC: add the new signature in sorted position and say in review why a signed-in browser
// may call it. Machine-only RPCs (service_role) never belong here; they go in MACHINE_ONLY below.
// Every public.* entry authorizes inside its body (private.require_member, require_tenant_admin_locked,
// require_platform, caller identity), so execute alone never grants data access.
const AUTHENTICATED_EXECUTE = [
  // Pure phone normalization used by the shipments expression indexes (T-093); reads no table.
  "private.customer_phone_key(text)",
  "private.is_member(uuid)",
  "private.member_role(uuid)",
  "private.platform_capable(text)",
  "public.accept_invitation(uuid)",
  "public.archive_contact(uuid,uuid,integer)",
  "public.authorize_batch_payment(uuid,text)",
  "public.begin_partner_key_rotation(uuid)",
  "public.begin_partner_seller_key_recovery(uuid)",
  "public.begin_partner_seller_onboarding(uuid,text,text,text,text,text,boolean)",
  "public.billable_weight_rules(uuid)",
  "public.close_ambiguous_pickup_reservation(uuid,text)",
  "public.close_failed_operation(uuid,text)",
  "public.close_unknown_batch_payment(uuid,uuid,text)",
  "public.confirm_shipment(uuid,uuid,integer,text,integer)",
  // Per-record charge/void administrative details (T-082); current tenant administrator only.
  "public.counter_payment_admin_details(uuid)",
  "public.create_invoice_snapshot(uuid)",
  "public.create_label_snapshot(uuid,boolean,text,text,text,text,text)",
  "public.create_shipment_draft(uuid)",
  "public.deactivate_member(uuid,uuid,integer)",
  "public.gerai_cost_for_quote(uuid,uuid)",
  "public.invite_member(uuid,text,text)",
  "public.my_account_state()",
  "public.my_invitations()",
  "public.partner_onboarding_status(uuid)",
  "public.platform_add_declaration_text(text,text[],text,boolean,text)",
  "public.platform_admins()",
  "public.platform_applications(text)",
  "public.platform_audit(text,integer)",
  "public.platform_billable_weight_rules()",
  "public.platform_clear_partner_stop(uuid,text)",
  "public.platform_customer_lookup(text,text)",
  "public.platform_discount_history(uuid)",
  "public.platform_discount_observations(uuid)",
  "public.platform_discount_overview()",
  "public.platform_integrations()",
  "public.platform_overview()",
  "public.platform_partner_config()",
  "public.platform_pending_applications()",
  "public.platform_review_application(uuid,integer,text,text)",
  "public.platform_revoke_grant(uuid,integer,text)",
  "public.platform_set_billable_weight_rule(jsonb,text)",
  "public.platform_set_gerai_discount(uuid,integer,integer,date,text,text,text,text)",
  "public.platform_set_grant(text,text[],text)",
  "public.platform_set_masking_allowed(uuid,boolean,text)",
  "public.platform_set_partner_id(text,text)",
  "public.platform_set_registration(boolean,text)",
  "public.platform_set_tenant_lifecycle(uuid,text,text,text)",
  "public.platform_tenant_customers(uuid,text,integer,integer)",
  "public.platform_tenant_directory(text,text,integer,integer,text)",
  "public.platform_tenant_masking(uuid)",
  "public.platform_tenant_slugs()",
  "public.platform_tenant_summary(uuid)",
  "public.platform_tenants()",
  // T-085: member-only generation reservation and hash publication, locked to one shipment.
  "public.prepare_tracking_link(uuid)",
  "public.publish_tracking_link(uuid,uuid,text)",
  "public.reconcile_shipment(uuid)",
  // Counter payment record (T-082); member, derived outlet/period, one active record per shipment.
  "public.record_counter_payment(uuid,text,bigint,bigint,text)",
  "public.record_export(uuid,text,jsonb,integer,boolean)",
  "public.record_label_print(uuid)",
  // Receipt print request (T-082); member, active payment or COD with preview-checked frozen identity.
  "public.record_receipt_print(uuid,uuid,text,text,text)",
  "public.registration_open()",
  "public.remove_seller_credential(uuid,integer)",
  "public.reopen_shipment(uuid)",
  "public.request_label(uuid)",
  "public.request_quotes(uuid,integer)",
  "public.reset_demo()",
  "public.review_unpaid_batch(uuid,uuid)",
  "public.revoke_invitation(uuid,integer)",
  // T-085: tenant-admin-only revocation of the exact sharing generation, with audit.
  "public.revoke_tracking_link(uuid,uuid)",
  "public.save_application(integer,text,text,text,text,text)",
  // T-100: bounded provider reference search, checked for active membership inside the RPC.
  "public.search_mengantar_areas(text,integer)",
  "public.seller_credential_status(uuid)",
  "public.set_member_role(uuid,uuid,text,integer)",
  "public.set_outlet_mengantar_pickup(uuid,text,text,text,text)",
  "public.set_tenant_contact_whatsapp(uuid,text,integer)",
  "public.set_tenant_logo(uuid,text,text,integer)", // T-096: admin-only, revision-checked logo mutation.
  "public.start_demo()",
  "public.store_seller_credential(uuid,integer,text,text,text,text,text)",
  "public.submit_application(uuid,integer)",
  "public.tenant_gerai_discount(uuid)",
  "public.tenant_invitations_list(uuid)",
  "public.tenant_logo(uuid)", // T-096: member-scoped read; version rows have no direct grants.
  "public.tenant_members(uuid)",
  // Counter payment void (T-082); tenant administrator only, reason required, row kept.
  "public.void_counter_payment(uuid,text)",
  "public.withdraw_application(uuid,integer)",
];

// Machine RPCs (DEC-010): executable by service_role only; neither anon nor authenticated. Sorted.
const MACHINE_ONLY = [
  "public.auth_create_session(uuid,text,text,integer,integer)",
  "public.auth_initialize_password(uuid,text,uuid)",
  "public.auth_issue_otp(text,text,uuid,integer)",
  "public.auth_mfa_enroll(uuid,text,text)",
  "public.auth_mfa_factor(uuid,uuid)",
  "public.auth_mfa_verify(uuid,uuid,uuid,bigint,text)",
  "public.auth_password_credential(text)",
  "public.auth_purge_expired()",
  "public.auth_refresh_session(text,text,integer)",
  "public.auth_revoke_session(uuid)",
  "public.auth_revoke_user_sessions(uuid,uuid)",
  "public.auth_session_live(uuid)",
  "public.auth_set_password(uuid,text,uuid)",
  "public.auth_sign_in_anonymous(text,text,integer,integer)",
  "public.auth_verify_otp(text,text,text,text,integer,integer)",
  "public.cleanup_expired_demos(integer,integer)",
  "public.complete_partner_seller_onboarding(uuid,text,text,text,text,text,integer,text)",
  "public.dispatch_begin_batch_payment(uuid,uuid,text,text)",
  "public.dispatch_begin_payment_check(uuid,text)",
  "public.dispatch_begin_reconcile(uuid,text)",
  "public.dispatch_claim(uuid,text)",
  "public.dispatch_due(integer,text)",
  "public.dispatch_finish_batch_payment(uuid,text,integer)",
  "public.dispatch_mark_batch_payment_sent(uuid,text)",
  "public.dispatch_pickup_begin_create(uuid,integer)",
  "public.dispatch_pickup_begin_reservation(uuid,integer)",
  "public.dispatch_pickup_known_time_ids(uuid)",
  "public.dispatch_pickup_record_reservation(uuid,integer,text)",
  "public.dispatch_pickup_requeue(uuid,integer,text)",
  "public.dispatch_record(uuid,integer,text,text,text,text,text,text,bigint,text,text)",
  "public.dispatch_record_payment(uuid,text,boolean,text,bigint)",
  "public.dispatch_release(uuid,integer)",
  "public.dispatch_release_batch_payment(uuid)",
  "public.dispatch_stuck_counts()",
  "public.fence_partner_key_rotation(uuid,uuid,text,integer,text)",
  "public.machine_seller_key(uuid,text)",
  "public.record_live_quotes(uuid,uuid,integer,jsonb,text,text)",
  "public.record_partner_key_rotation_outcome(uuid,uuid,text,integer,text,text,integer,text)",
  "public.record_partner_preflight_failure(uuid,uuid,text,integer,text,text,integer)",
  "public.record_partner_seller_onboarding_outcome(uuid,text,text,text,integer)",
  "public.rewrap_seller_credential(uuid,integer,text,text,text,text)",
  "public.store_partner_seller_key(uuid,uuid,text,integer,text,text,text,text,text,text)",
  "public.sync_partner_consent_versions(text,text,text)",
];

// Column-scoped writes the authenticated role holds today (no table-level write exists). The
// application drives everything else through the RPCs above. Sorted by table, then column.
const AUTHENTICATED_COLUMN_WRITES: Record<string, { insert: string[]; update: string[] }> = {
  contact_addresses: {
    insert: ["address_line", "area", "area_id", "contact_id", "is_primary", "label", "postal_code", "tenant_id"],
    update: ["address_line", "archived_at", "area", "area_id", "is_primary", "label", "postal_code"],
  },
  contacts: {
    insert: ["is_recipient", "is_sender", "name", "phone", "tenant_id"],
    update: ["is_recipient", "is_sender", "name", "phone"],
  },
  shipments: {
    insert: [],
    update: [
      "goods_value_idr", "handover", "height_cm", "is_cod", "item_description", "length_cm", "pickup_date", "pickup_note",
      "pickup_slot_hour", "pickup_volume", "recipient_address", "recipient_area",
      "recipient_area_id", "recipient_contact_id", "recipient_name", "recipient_phone", "recipient_postal_code",
      // T-094: the optional sender address is draft content, written like the other draft fields.
      "sender_address", "sender_area", "sender_contact_id", "sender_name", "sender_phone", "sender_postal_code",
      "weight_grams", "width_cm",
    ],
  },
};

// A freshly reset stack answers 503 (PGRST002) until PostgREST has rebuilt its schema cache.
beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("PostgREST schema cache did not become ready");
}, 90000);

function rows<T>(statement: string): T[] {
  return JSON.parse(sql(`select coalesce(json_agg(r), '[]'::json) from (${statement}) r`)) as T[];
}

type FnRow = { sig: string; name: string; anon: boolean; authenticated: boolean; service_role: boolean };
// One row per overload. regprocedure prints schema-qualified names only under an empty search_path.
const FUNCTION_ROWS_SQL = `select p.oid::regprocedure::text as sig, n.nspname || '.' || p.proname as name,
    has_function_privilege('anon', p.oid, 'execute') as anon,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
    has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')`;
const bySig = (a: FnRow, b: FnRow) => (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0);

function functions(): FnRow[] {
  const out = sql(`set search_path = ''; select coalesce(jsonb_agg(r), '[]'::jsonb) from (${FUNCTION_ROWS_SQL}) r`);
  return (JSON.parse(out.slice(out.indexOf("\n") + 1)) as FnRow[]).sort(bySig);
}

// Names that have more than one overload (an allowlisted name must never hide a second signature).
function overloadedNames(all: FnRow[]): string[] {
  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([name]) => name).sort();
}

describe("function EXECUTE catalog (DIL-02)", () => {
  it("keeps every allowlist a sorted constant", () => {
    for (const list of [ANON_EXECUTE, AUTHENTICATED_EXECUTE, MACHINE_ONLY]) expect(list).toEqual([...list].sort());
  });

  it("anon can execute nothing in public or private except the declared allowlist", () => {
    expect(functions().filter((f) => f.anon).map((f) => f.sig)).toEqual(ANON_EXECUTE);
  });

  it("authenticated can execute exactly the declared user-callable surface", () => {
    expect(functions().filter((f) => f.authenticated).map((f) => f.sig)).toEqual(AUTHENTICATED_EXECUTE);
  });

  it("no function name has more than one overload in public or private", () => {
    expect(overloadedNames(functions())).toEqual([]);
  });

  it("a second overload of an allowlisted name, granted to authenticated, is caught (rolled-back probe)", () => {
    // Created as the migration role inside a DO block that always raises: nothing is committed.
    const body = `set local search_path = '';
      create function public.accept_invitation(p_zz integer) returns int language sql as 'select 1';
      grant execute on function public.accept_invitation(integer) to authenticated;
      raise exception 'probe:%', (select jsonb_agg(r) from (${FUNCTION_ROWS_SQL}) r);`;
    let probed: FnRow[] = [];
    try {
      sql(`do $probe$ begin ${body} end $probe$`);
    } catch (e) {
      const json = /ERROR:\s+probe:(.*)/.exec(String((e as Error).message))?.[1];
      probed = json ? (JSON.parse(json) as FnRow[]).sort(bySig) : [];
    }
    expect(probed.length).toBeGreaterThan(0);
    // The signature-based comparison sees the new overload; matching by name would not.
    const exposed = probed.filter((f) => f.authenticated).map((f) => f.sig);
    expect(exposed).toContain("public.accept_invitation(integer)");
    expect(exposed).not.toEqual(AUTHENTICATED_EXECUTE);
    expect(overloadedNames(probed)).toEqual(["public.accept_invitation"]);
    expect(sql("select count(*) from pg_proc where proname = 'accept_invitation'")).toBe("1");
  });

  it("machine RPCs run for service_role only", () => {
    const all = functions();
    for (const sig of MACHINE_ONLY) {
      const f = all.find((x) => x.sig === sig);
      expect(f, `${sig} exists`).toBeDefined();
      expect({ sig, anon: f!.anon, authenticated: f!.authenticated, service_role: f!.service_role }).toEqual({
        sig, anon: false, authenticated: false, service_role: true,
      });
    }
    // Everything neither user-callable nor machine-only stays internal: service_role needs no access
    // to private helpers either, they run inside SECURITY DEFINER bodies.
    const declared = new Set([...AUTHENTICATED_EXECUTE, ...MACHINE_ONLY]);
    expect(all.filter((f) => !declared.has(f.sig) && f.service_role).map((f) => f.sig)).toEqual([]);
  });

  it("the Data API refuses anon for user-callable and machine RPCs, and users for machine RPCs", async () => {
    const anon = client();
    for (const [fn, args] of [
      ["confirm_shipment", { p_shipment: IDS.shipmentA, p_quote: IDS.shipmentA, p_expected_revision: 1, p_idempotency_key: "anon-key-1", p_declaration_version: 1 }],
      ["dispatch_claim", { p_operation: IDS.shipmentA, p_env: "sandbox" }],
      ["record_live_quotes", { p_tenant: IDS.tenantA, p_shipment: IDS.shipmentA, p_expected_revision: 1, p_rows: [], p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca" }],
      ["cleanup_expired_demos", {}],
    ] as const) {
      const { error } = await anon.rpc(fn, args as Record<string, unknown>);
      expect(error?.code, fn).toBe("42501");
    }
    const user = await signIn("owner-a@geraiexpress.test");
    for (const [fn, args] of [
      ["dispatch_claim", { p_operation: IDS.shipmentA, p_env: "sandbox" }],
      ["record_live_quotes", { p_tenant: IDS.tenantA, p_shipment: IDS.shipmentA, p_expected_revision: 1, p_rows: [], p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca" }],
      ["cleanup_expired_demos", {}],
    ] as const) {
      const { error } = await user.rpc(fn, args as Record<string, unknown>);
      expect(error?.code, fn).toBe("42501");
    }
  });
});

describe("default privileges (DIL-02)", () => {
  // Creates a scratch function per schema as the migration role and reports who can run it. The DO
  // block always raises, so nothing is ever committed.
  const probe = (prelude: string): string => {
    const body = `${prelude}
      create function public.zz_scratch_probe() returns int language sql as 'select 1';
      create function private.zz_scratch_probe() returns int language sql as 'select 1';
      raise exception 'probe:%', (select string_agg(n.nspname || ':' || r.role || '=' || has_function_privilege(r.role, p.oid, 'execute'), ',' order by n.nspname, r.role)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
        where p.proname = 'zz_scratch_probe');`;
    try {
      sql(`do $probe$ begin ${body} end $probe$`);
    } catch (e) {
      return /ERROR:\s+probe:(\S+)/.exec(String((e as Error).message))?.[1] ?? "";
    }
    throw new Error("probe did not raise");
  };

  it("a function created without an explicit grant is not executable by anon or authenticated", () => {
    const result = probe("");
    expect(result).toContain("private:anon=false,private:authenticated=false");
    expect(result).toContain("public:anon=false,public:authenticated=false");
    expect(sql("select count(*) from pg_proc where proname = 'zz_scratch_probe'")).toBe("0");
  });

  it("the probe does see exposure when PUBLIC default execute is granted back (control)", () => {
    const result = probe("alter default privileges for role postgres grant execute on functions to public;");
    expect(result).toContain("public:anon=true,public:authenticated=true");
    expect(sql("select count(*) from pg_proc where proname = 'zz_scratch_probe'")).toBe("0");
    // The control ran inside a rolled-back transaction: the real default is still revoked.
    expect(sql("select count(*) from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 0 and defaclobjtype = 'f'")).toBe("1");
  });
});

describe("table sweep (DIL-12)", () => {
  // Tables (r, p), views (v), materialized views (m) and foreign tables (f) of the public schema.
  type TableRow = { name: string; kind: string; rls: boolean; anon: boolean; authenticated_write: boolean };
  const tables = (): TableRow[] =>
    rows<TableRow>(`select c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
          or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')) as anon,
        has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger') as authenticated_write
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`);

  it("covers the whole public schema", () => {
    expect(tables().length).toBeGreaterThanOrEqual(14);
    expect(tables().map((table) => table.name)).toEqual(expect.arrayContaining(["cash_periods", "counter_payments"]));
  });

  it("anon holds no privilege on any public table, view, materialized view, foreign table or column", () => {
    expect(tables().filter((t) => t.anon).map((t) => t.name)).toEqual([]);
  });

  it("row level security is enabled on every public table", () => {
    expect(tables().filter((t) => ["r", "p"].includes(t.kind) && !t.rls).map((t) => t.name)).toEqual([]);
  });

  it("a view granted to authenticated runs as its invoker; no materialized or foreign table is granted to it", () => {
    // A view without security_invoker runs with its owner's rights and bypasses the RLS of the tables
    // it reads. Materialized and foreign tables carry no RLS at all.
    const granted = rows<{ name: string; kind: string; options: string[] | null }>(`select c.relname as name, c.relkind as kind, c.reloptions as options
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm', 'f')
        and (has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
          or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')) order by 1`);
    const invoker = (options: string[] | null) => (options ?? []).some((o) => /^security_invoker=(true|on|1|yes)$/i.test(o));
    expect(granted.filter((v) => v.kind !== "v" || !invoker(v.options)).map((v) => v.name)).toEqual([]);
  });

  it("authenticated has no table-level write privilege anywhere", () => {
    expect(tables().filter((t) => t.authenticated_write).map((t) => t.name)).toEqual([]);
  });

  it("counter payment SELECT is column-scoped and excludes the administrative difference payload", () => {
    expect(sql("select has_table_privilege('authenticated', 'public.counter_payments', 'select')")).toBe("f");
    const columns = rows<{ column: string }>(`select a.attname as "column" from pg_attribute a
      where a.attrelid = 'public.counter_payments'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select') order by a.attname`);
    expect(columns.map((column) => column.column)).toEqual([
      "amount_idr", "cash_received_idr", "id", "method", "outlet_id", "period_id", "receipt_gerai_name",
      "receipt_gerai_whatsapp", "recorded_at", "recorded_by", "recorded_by_label", "shipment_id", "tenant_id", "voided_at", "voided_by",
    ]);
  });

  it("authenticated writes only the column-scoped grants recorded above", () => {
    const columns = rows<{ table: string; op: "insert" | "update"; cols: string[] }>(`
      select c.relname as "table", o.op, array_agg(a.attname order by a.attname) as cols
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join (values ('insert'), ('update')) o(op)
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'f')
        and has_column_privilege('authenticated', c.oid, a.attnum, o.op)
      group by c.relname, o.op order by 1, 2`);
    const actual: Record<string, { insert: string[]; update: string[] }> = {};
    for (const r of columns) (actual[r.table] ??= { insert: [], update: [] })[r.op] = r.cols;
    expect(actual).toEqual(AUTHENTICATED_COLUMN_WRITES);
  });

  it("no API role holds anything on private tables", () => {
    expect(rows<{ name: string }>(`select c.relname as name from pg_class c
      where c.relnamespace = 'private'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
        and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
          or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')) order by 1`)).toEqual([]);
  });
});

describe("SQLSTATE 40001 (DIL-11)", () => {
  // PostgREST retries SQLSTATE 40001 forever; deterministic stale checks must raise 55000. The
  // runtime rewrite in 20261027220000 only fixed functions that existed then, so this guards every
  // function, including those defined by later migrations. The condition name serialization_failure
  // is the same SQLSTATE and is matched case-insensitively (errcode = 'serialization_failure').
  const SERIALIZATION = `'40001'|serialization_failure`;
  const offenders = (): string[] =>
    rows<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosrc ~* $re$(${SERIALIZATION})$re$ order by 1`).map((r) => r.sig);

  it("no public or private function body names 40001 or serialization_failure", () => {
    expect(offenders()).toEqual([]);
  });

  it("the sweep sees each spelling (rolled-back probe)", () => {
    const probe = (body: string): string[] => {
      try {
        sql(`do $probe$ begin
          create function public.zz_serialization_probe() returns int language plpgsql as $f$ begin ${body} end $f$;
          raise exception 'probe:%', (select count(*) from pg_proc p where p.proname = 'zz_serialization_probe' and p.prosrc ~* $re$(${SERIALIZATION})$re$);
        end $probe$`);
      } catch (e) {
        return [/ERROR:\s+probe:(\S+)/.exec(String((e as Error).message))?.[1] ?? ""];
      }
      return [];
    };
    expect(probe(`raise exception 'x' using errcode = '40001';`)).toEqual(["1"]);
    expect(probe(`raise exception 'x' using errcode = 'serialization_failure';`)).toEqual(["1"]);
    expect(probe(`raise exception 'x' using errcode = 'SERIALIZATION_FAILURE';`)).toEqual(["1"]);
    expect(probe(`raise exception 'x' using errcode = '55000';`)).toEqual(["0"]);
  });
});

describe("seed.sql local-only guard (DIL-18)", () => {
  const seed = readFileSync("db/seed.sql", "utf8");
  const guard = /do \$guard\$[\s\S]*?end \$guard\$;/.exec(seed)![0];

  it("is the first statement, before any insert", () => {
    expect(seed.indexOf(guard)).toBeGreaterThan(-1);
    expect(seed.indexOf(guard)).toBeLessThan(seed.search(/insert into/i));
    expect(seed.slice(0, seed.indexOf(guard)).split("\n").every((l) => l.trim() === "" || l.startsWith("--"))).toBe(true);
  });

  it("passes on this local stack", () => {
    expect(() => sql(guard)).not.toThrow();
  });

  it("aborts when the local marker is absent or different", () => {
    // A session-level setting overrides the server one: what a database outside the compose stack looks like.
    expect(() => sql(`set app.gx_local = ''; ${guard}`)).toThrow(/seed\.sql refused/);
    expect(() => sql(`set app.gx_local = 'off'; ${guard}`)).toThrow(/seed\.sql refused/);
    expect(() => sql(`reset app.gx_local; ${guard}`)).not.toThrow();
  });

  it("aborts in a database whose name does not start with gx, even with the marker on", () => {
    // The cluster's maintenance database `postgres` carries the same server-wide marker.
    const probe = () => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", guard], { encoding: "utf8", stdio: "pipe" });
    expect(probe).toThrow(/seed\.sql refused/);
  });
});

describe("foundation roles and auth objects (T-064)", () => {
  it("API roles are NOLOGIN without elevated attributes; only service_role bypasses RLS", () => {
    expect(rows(`select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin') order by 1`)).toEqual([
      { rolname: "anon", rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
      { rolname: "authenticated", rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
      { rolname: "service_role", rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: true },
      { rolname: "supabase_auth_admin", rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
    ]);
  });

  it("authenticator logs in without inheriting and may switch only to the three API roles", () => {
    expect(rows(`select rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolpassword is not null as has_password
      from pg_authid where rolname = 'authenticator'`)).toEqual([{ rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false, has_password: true }]);
    expect(sql(`select string_agg(g.rolname, ',' order by g.rolname) from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'authenticator'`)).toBe("anon,authenticated,service_role");
  });

  // Connects from inside the container over its non-loopback address: the image trusts only loopback.
  const asAuthenticator = (password: string, statement: string): string =>
    execFileSync("docker", ["exec", "-e", "PGPASSWORD", DB_CONTAINER, "sh", "-c",
      `psql -w -h "$(hostname -i)" -U authenticator -d ${DB_NAME} -tA -v ON_ERROR_STOP=1 -c "$1"`, "psql", statement],
    { encoding: "utf8", stdio: "pipe", env: { ...process.env, PGPASSWORD: password } }).trim();

  it("authenticator cannot connect with an empty password, and does connect with its own", () => {
    expect(() => asAuthenticator("", "select 1")).toThrow(/password|authentication failed/i);
    expect(asAuthenticator(process.env.AUTHENTICATOR_PASSWORD!, "select current_user")).toBe("authenticator");
  });

  it("authenticator can SET ROLE to the API roles and to nothing else", () => {
    const password = process.env.AUTHENTICATOR_PASSWORD!;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(asAuthenticator(password, `set role ${role}; select current_user`)).toContain(role);
    }
    expect(() => asAuthenticator(password, "set role postgres")).toThrow(/permission denied to set role/);
    expect(() => asAuthenticator(password, "set role supabase_auth_admin")).toThrow(/permission denied to set role/);
  });

  it("auth.uid() and auth.jwt() read request.jwt.claims and are NULL when it is unset", () => {
    expect(sql("select auth.uid() is null and auth.jwt() is null")).toBe("t");
    const user = "00000000-0000-4000-a000-0000000000a1";
    const claims = JSON.stringify({ sub: user, role: "authenticated", aal: "aal2", is_anonymous: false });
    expect(sql(`select set_config('request.jwt.claims', '${claims}', true); select auth.uid()::text || '|' || (auth.jwt() ->> 'aal');`).split("\n").pop()).toBe(`${user}|aal2`);
    expect(sql(`select provolatile::text || ':' || prosecdef::text from pg_proc where oid = 'auth.uid()'::regprocedure`)).toBe("s:false");
    expect(sql(`select provolatile::text || ':' || prosecdef::text from pg_proc where oid = 'auth.jwt()'::regprocedure`)).toBe("s:false");
  });

  it("auth tables carry the columns the SQL and the T-065 core need, and no API role can touch them", () => {
    const columns = (table: string) => sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = '${table}'`).split(",");
    expect(columns("users")).toEqual(expect.arrayContaining([
      "aud", "banned_until", "created_at", "deleted_at", "email", "email_change", "email_confirmed_at", "encrypted_password",
      "id", "instance_id", "is_anonymous", "last_sign_in_at", "phone", "phone_change", "raw_app_meta_data", "raw_user_meta_data", "role", "updated_at",
    ]));
    expect(columns("mfa_factors")).toEqual(expect.arrayContaining(["factor_type", "friendly_name", "id", "last_used_step", "secret_sealed", "status", "user_id", "verified_at"]));
    expect(sql(`select count(*) from pg_class c where c.relnamespace = 'auth'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_table_privilege('service_role', c.oid, 'select,insert,update,delete,truncate,references,trigger'))`)).toBe("0");
  });
});

describe("confirm_shipment COD charge through a user session (DIL-12 d)", () => {
  const AREA = "5fc63169f8f44b34aa4c2ee1";
  let outletBefore = "";
  const created: string[] = [];

  // Tenant A as a connected gerai: an active (fake) sealed key and a Mengantar pickup.
  beforeAll(() => {
    outletBefore = sql(`select coalesce(pickup_address,'') || '|' || coalesce(pickup_area,'') from public.outlets where id = '${IDS.outletA}'`);
    const v = Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${IDS.tenantA}'`));
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null;
      insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
        values ('${IDS.tenantA}', 'byok', 'aXNzdWFuY2UtdGVzdC1jaXBoZXI=', 'aXYtMTIzNDU2Nzg=', 'v1', 'TST', ${v + 1});
      update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca', mengantar_area_id = '5fc62f60f8f44b34aa4c0dcd' where id = '${IDS.outletA}'`);
  });
  afterAll(() => {
    if (created.length) {
      const ids = created.map((id) => `'${id}'`).join(",");
      sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
    }
    const [address, area] = outletBefore.split("|");
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null;
      update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null,
        pickup_address = nullif('${address}', ''), pickup_area = nullif('${area}', '') where id = '${IDS.outletA}'`);
  });

  async function quotedDraft(isCod: boolean, row: Record<string, unknown>) {
    const owner = await signIn("owner-a@geraiexpress.test");
    const { data: id, error: draftError } = await owner.rpc("create_shipment_draft", { p_outlet: IDS.outletA });
    expect(draftError).toBeNull();
    created.push(id as string);
    const { error } = await owner.from("shipments").update({
      sender_name: "Pengirim Uji", sender_phone: "081200001111", recipient_name: "Penerima Uji", recipient_phone: "081200002222",
      recipient_address: "Jl. Kapitan 1 RT 01/04", recipient_area: "SUKATANI, TAPOS, DEPOK", recipient_area_id: AREA,
      item_description: "Dokumen", weight_grams: 1000, goods_value_idr: 52006, is_cod: isCod,
    }).eq("id", id);
    expect(error).toBeNull();
    const revision = Number(sql(`select revision from public.shipments where id = '${id}'`));
    const { error: quoteError } = await machine().rpc("record_live_quotes", {
      p_tenant: IDS.tenantA, p_shipment: id, p_expected_revision: revision, p_rows: [row],
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
    });
    expect(quoteError).toBeNull();
    const quote = sql(`select id from public.shipment_quotes where shipment_id = '${id}' and expires_at > now()`);
    return { owner, id: id as string, revision, quote };
  }

  const confirm = (c: TestClient, d: { id: string; quote: string; revision: number }, key = randomUUID()) =>
    c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: d.quote, p_expected_revision: d.revision, p_idempotency_key: key, p_declaration_version: 1 });

  it("freezes customer_charge = tariff + COD fee and cod_amount = goods + charge, applied once", async () => {
    const d = await quotedDraft(true, { courier: "JT", tariff: 93000, cod_fee: 4994, cod_supported: true, net: 65100, eta: "2 - 4 days" });
    const quoteRow = await d.owner.from("shipment_quotes").select("normal_tariff_idr,cod_fee_idr,customer_charge_idr").eq("id", d.quote).single();
    expect(quoteRow.data).toEqual({ normal_tariff_idr: 93000, cod_fee_idr: 4994, customer_charge_idr: 97994 });

    const key = randomUUID();
    const first = await confirm(d.owner, d, key);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ state: "queued", replayed: false, simulated: false });
    const frozen = { customer_charge_idr: 93000 + 4994, cod_amount_idr: 52006 + 93000 + 4994 };
    const read = async () =>
      (await d.owner.from("shipments").select("customer_charge_idr,cod_amount_idr,submission_state,selected_quote_id").eq("id", d.id).single()).data;
    expect(await read()).toEqual({ ...frozen, submission_state: "queued", selected_quote_id: d.quote });
    expect(frozen.cod_amount_idr).toBe(150000);

    // Replays (same key, new key) return the existing operation and never charge again.
    expect((await confirm(d.owner, d, key)).data).toMatchObject({ replayed: true });
    expect((await confirm(d.owner, d)).data).toMatchObject({ replayed: true });
    expect(await read()).toEqual({ ...frozen, submission_state: "queued", selected_quote_id: d.quote });
    expect(sql(`select count(*) from public.provider_operations where shipment_id = '${d.id}'`)).toBe("1");
    expect(sql(`select count(*) from public.shipment_events where shipment_id = '${d.id}' and kind = 'submitted'`)).toBe("1");
  });

  it("a non-COD shipment carries the tariff only and no COD amount", async () => {
    const d = await quotedDraft(false, { courier: "JT", tariff: 93000, net: 65100, eta: "2 - 4 days" });
    expect((await confirm(d.owner, d)).error).toBeNull();
    const row = await d.owner.from("shipments").select("customer_charge_idr,cod_amount_idr").eq("id", d.id).single();
    expect(row.data).toEqual({ customer_charge_idr: 93000, cod_amount_idr: null });
  });
});
