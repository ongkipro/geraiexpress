// T-086 / PR-44 / DATA-15 / UX-20: return and claim cases. One non-closed case per shipment,
// operator open/update, admin-only close with outcome rules, deadline computed in SQL from the sourced
// rule and the staff-entered anchor (parity with src/modules/cases/deadline.ts), cross-tenant denial,
// append-only events, audit and stable 55000/22023 codes.
import { afterAll, describe, expect, it } from "vitest";
import { claimDeadline } from "../../src/modules/cases/deadline";
import { IDS, client, machine, realOperation, signIn, sql } from "./helpers";

const SOURCE = "https://help.mengantar.com/id/articles/8140017-ketentuan-batas-waktu-pengajuan-klaim";
const outlets: string[] = [];
async function issued(courier = "SiCepat", state = "issued") {
  const f = await realOperation({ tenant: IDS.tenantA, noCredential: true });
  outlets.push(sql(`select outlet_id from public.shipments where id = '${f.shipment}'`));
  sql(`update public.shipment_quotes set courier = '${courier}' where shipment_id = '${f.shipment}';
    update public.shipments set submission_state = '${state}', awb = 'AWB${f.shipment.slice(0, 8)}' where id = '${f.shipment}'`);
  return f.shipment;
}
const openArgs = (shipment: string, over: Record<string, unknown> = {}) => ({
  p_shipment: shipment, p_case_type: "damaged", p_claim_type: "full_value", p_description: "Kardus penyok, isi pecah",
  p_evidence_refs: ["foto-1.jpg"], p_provider_ticket: null, p_region: null, p_anchor_at: null, ...over,
});
const updateArgs = (id: string, revision: number, over: Record<string, unknown> = {}) => ({
  p_case: id, p_expected_revision: revision, p_state: "open", p_claim_type: "full_value", p_description: "Kardus penyok, isi pecah",
  p_evidence_refs: ["foto-1.jpg"], p_provider_ticket: null, p_region: null, p_anchor_at: null, ...over,
});
const row = (id: string, cols: string) => sql(`select ${cols} from public.shipment_cases where id = '${id}'`);
afterAll(() => {
  if (!outlets.length) return;
  const ids = outlets.map((id) => `'${id}'`).join(",");
  sql(`update public.shipments set selected_quote_id = null where outlet_id in (${ids});
    delete from public.shipments where outlet_id in (${ids}); delete from public.outlets where id in (${ids})`);
});

describe("claim-window rules (help 8140017)", () => {
  it("are seeded with unit, anchor, optional region, source URL and date; no API role can read or write the table", () => {
    expect(sql(`select string_agg(courier || ':' || coalesce(case_type, '*') || ':' || coalesce(region, '*') || ':' || window_value || ':'
        || window_unit || ':' || coalesce(anchor, '-'), ',' order by courier collate "C", case_type nulls first, region)
      from private.claim_window_rules where source_url = '${SOURCE}' and source_updated_at = date '2026-09-18'`)).toBe([
      "JNE:*:java_sumatra_bali_ntb:45:working_days:-", "JNE:*:other:60:working_days:-",
      "JT:*:*:30:days:-", "JT:lost:*:72:hours:-", "Sap:*:*:60:days:-", "SiCepat:*:*:14:days:last_status",
      "anteraja:*:*:14:days:last_status", "iDexpress:*:*:14:days:last_status", "iDexpress:lost:*:72:hours:-",
      "lion:*:*:30:days:-", "pos:*:*:14:days:last_status", "spx:*:*:14:days:rts",
    ].join(","));
    expect(sql(`select count(*) from private.claim_window_rules where source_url <> '${SOURCE}'`)).toBe("0");
    expect(sql("select has_table_privilege('authenticated', 'private.claim_window_rules', 'select,insert,update,delete')")).toBe("f");
  });

  it("the member RPC lists them without actor ids; outsiders are refused", async () => {
    const member = await signIn("operator-a@geraiexpress.test");
    const { data, error } = await member.rpc("claim_window_rules", { p_tenant: IDS.tenantA });
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(12);
    expect(Object.keys((data as Record<string, unknown>[])[0])).not.toContain("created_by");
    expect((await (await signIn("owner-b@geraiexpress.test")).rpc("claim_window_rules", { p_tenant: IDS.tenantA })).error?.code).toBe("P0002");
    expect((await client().rpc("claim_window_rules", { p_tenant: IDS.tenantA })).error?.code).toBe("42501");
  });

  it("SQL deadline matches the TypeScript mirror per unit, and is NULL without an anchor", () => {
    for (const [anchor, value, unit] of [
      ["2026-11-05T03:15:00.000Z", 72, "hours"], ["2026-11-06T10:00:00.000Z", 14, "days"],
      ["2026-11-06T03:00:00.000Z", 1, "working_days"], ["2026-11-07T03:00:00.000Z", 1, "working_days"],
      ["2026-11-06T23:30:00.000Z", 1, "working_days"], ["2026-11-02T03:00:00.000Z", 45, "working_days"],
      ["2026-11-02T03:00:00.000Z", 60, "working_days"],
    ] as const) {
      const db = sql(`select to_char(private.claim_deadline('${anchor}', ${value}, '${unit}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
      expect(db, `${anchor} ${value} ${unit}`).toBe(claimDeadline(anchor, value, unit));
    }
    expect(sql("select private.claim_deadline(null, 14, 'days') is null")).toBe("t");
  });
});

describe("shipment cases", () => {
  it("an operator opens one case on an issued shipment; a second open case is refused (55000)", async () => {
    const shipment = await issued(), operator = await signIn("operator-a@geraiexpress.test");
    const opened = await operator.rpc("open_shipment_case", openArgs(shipment, { p_evidence_refs: [" foto-1.jpg ", "", "chat.txt"] }));
    expect(opened.error).toBeNull();
    const id = opened.data as string;
    expect(row(id, "state || '|' || array_to_string(evidence_refs, ',') || '|' || (deadline_at is null)::text || '|' || (rule_id is not null)::text"))
      .toBe("open|foto-1.jpg,chat.txt|true|true");
    for (const caseType of ["damaged", "return"]) {
      expect((await operator.rpc("open_shipment_case", openArgs(shipment, { p_case_type: caseType }))).error).toMatchObject({ message: "case_open_exists", code: "55000" });
    }
    expect(sql(`select count(*) from public.shipment_case_events where case_id = '${id}' and kind = 'opened'`)).toBe("1");
    expect(sql(`select count(*) from public.audit_events where action = 'shipment_case.open' and detail->>'case' = '${id}'`)).toBe("1");
    expect(sql(`select count(*) from public.shipment_events where shipment_id = '${shipment}' and kind = 'case_opened'`)).toBe("1");
    const unissued = await issued("SiCepat", "queued");
    expect((await operator.rpc("open_shipment_case", openArgs(unissued))).error).toMatchObject({ message: "case_not_allowed", code: "55000" });
  });

  it("validates inputs with 22023 and stores no client deadline", async () => {
    const shipment = await issued(), operator = await signIn("operator-a@geraiexpress.test");
    for (const [over, message] of [
      [{ p_case_type: "stolen" }, "case_type_invalid"], [{ p_claim_type: "cash" }, "claim_type_invalid"],
      [{ p_description: "abc" }, "description_required"], [{ p_evidence_refs: Array(11).fill("x.jpg") }, "evidence_invalid"],
      [{ p_provider_ticket: "x".repeat(81) }, "ticket_invalid"], [{ p_region: "mars" }, "region_invalid"],
      [{ p_anchor_at: "2999-01-01T00:00:00Z" }, "anchor_invalid"],
    ] as const) {
      expect((await operator.rpc("open_shipment_case", openArgs(shipment, over))).error, message).toMatchObject({ message, code: "22023" });
    }
    expect((await operator.rpc("open_shipment_case", { ...openArgs(shipment), p_deadline_at: "2030-01-01T00:00:00Z" })).error).not.toBeNull();
    expect(sql(`select count(*) from public.shipment_cases where shipment_id = '${shipment}'`)).toBe("0");
  });

  it("computes the stored deadline from rule and staff-entered anchor, recomputing on every update", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const operatorId = sql("select id from auth.users where email = 'operator-a@geraiexpress.test'");
    // SiCepat 14 days from the last status.
    const sicepat = await issued("SiCepat");
    const a = (await operator.rpc("open_shipment_case", openArgs(sicepat, { p_anchor_at: "2026-11-01T03:00:00Z" }))).data as string;
    expect(row(a, "to_char(deadline_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '|' || (anchor_entered_by = '" + operatorId + "')::text"))
      .toBe("2026-11-15 03:00|true");
    // Changing the anchor recomputes; clearing it returns NULL (unknown, never a default).
    expect((await operator.rpc("update_shipment_case", updateArgs(a, 1, { p_anchor_at: "2026-11-02T03:00:00Z", p_state: "submitted" }))).error).toBeNull();
    expect(row(a, "to_char(deadline_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '|' || state || '|' || revision")).toBe("2026-11-16 03:00|submitted|2");
    expect((await operator.rpc("update_shipment_case", updateArgs(a, 2))).error).toBeNull();
    expect(row(a, "(deadline_at is null and anchor_at is null and anchor_entered_by is null)::text")).toBe("true");
    expect(sql(`select array_to_string(changed, ',') from public.shipment_case_events where case_id = '${a}' and kind = 'updated' order by at, id limit 1`)).toBe("state,anchor_at");
    // A stale revision is refused with 55000, never 40001.
    expect((await operator.rpc("update_shipment_case", updateArgs(a, 1))).error).toMatchObject({ message: "case_changed", code: "55000" });
    // JNE: no rule without a region; with a region the rule applies but the source states no anchor event.
    const jne = await issued("JNE");
    const b = (await operator.rpc("open_shipment_case", openArgs(jne, { p_anchor_at: "2026-11-02T03:00:00Z" }))).data as string;
    expect(row(b, "(rule_id is null and deadline_at is null)::text")).toBe("true");
    expect((await operator.rpc("update_shipment_case", updateArgs(b, 1, { p_region: "java_sumatra_bali_ntb", p_anchor_at: "2026-11-02T03:00:00Z" }))).error).toBeNull();
    expect(row(b, "(deadline_at is null)::text || '|' || (select window_value from private.claim_window_rules r where r.id = rule_id)")).toBe("true|45");
    // Lost J&T case picks the 3x24 h rule; an unknown courier has no rule.
    const jt = await issued("JT");
    const c = (await operator.rpc("open_shipment_case", openArgs(jt, { p_case_type: "lost", p_anchor_at: "2026-11-02T03:00:00Z" }))).data as string;
    expect(row(c, "(select window_unit || ':' || window_value from private.claim_window_rules r where r.id = rule_id) || '|' || (deadline_at is null)::text")).toBe("hours:72|true");
    const unknown = await issued("ninja");
    const d = (await operator.rpc("open_shipment_case", openArgs(unknown, { p_anchor_at: "2026-11-02T03:00:00Z" }))).data as string;
    expect(row(d, "(rule_id is null and deadline_at is null)::text")).toBe("true");
  });

  it("only a tenant administrator closes, with the outcome rules; a closed case is final", async () => {
    const shipment = await issued(), operator = await signIn("operator-a@geraiexpress.test"), admin = await signIn("owner-a@geraiexpress.test");
    const id = (await operator.rpc("open_shipment_case", openArgs(shipment))).data as string;
    const close = (c: typeof admin, over: Record<string, unknown>) => c.rpc("close_shipment_case", { p_case: id, p_outcome: "rejected", p_decided_amount_idr: null, p_decided_by_party: null, p_note: null, ...over });
    expect((await close(operator, {})).error).toMatchObject({ message: "admin_required", code: "42501" });
    for (const [over, message] of [
      [{ p_outcome: null }, "outcome_required"], [{ p_outcome: "compensated" }, "decided_amount_required"],
      [{ p_outcome: "compensated", p_decided_amount_idr: 150000 }, "decided_by_required"],
      [{ p_outcome: "compensated", p_decided_amount_idr: 0, p_decided_by_party: "courier" }, "decided_amount_required"],
      [{ p_outcome: "rejected", p_decided_amount_idr: 5000 }, "decided_amount_invalid"],
      [{ p_decided_by_party: "gerai" }, "decided_by_invalid"],
    ] as const) {
      expect((await close(admin, over)).error, message).toMatchObject({ message, code: "22023" });
    }
    expect((await close(admin, { p_outcome: "compensated", p_decided_amount_idr: 150000, p_decided_by_party: "mengantar", p_note: "Disetujui lewat Live Chat" })).error).toBeNull();
    expect(row(id, "state || '|' || outcome || '|' || decided_amount_idr || '|' || decided_by_party || '|' || (closed_by is not null)::text"))
      .toBe("closed|compensated|150000|mengantar|true");
    expect((await close(admin, {})).error).toMatchObject({ message: "case_closed", code: "55000" });
    expect((await operator.rpc("update_shipment_case", updateArgs(id, 2))).error).toMatchObject({ message: "case_closed", code: "55000" });
    expect(sql(`select reason from public.audit_events where action = 'shipment_case.close' and detail->>'case' = '${id}'`)).toBe("Disetujui lewat Live Chat");
    // Closed frees the shipment for a new case.
    expect((await operator.rpc("open_shipment_case", openArgs(shipment, { p_case_type: "return", p_claim_type: "return" }))).error).toBeNull();
  });

  it("two concurrent opens commit exactly one case", async () => {
    const shipment = await issued(), operator = await signIn("operator-a@geraiexpress.test");
    const results = await Promise.all(["lost", "late"].map((t) => operator.rpc("open_shipment_case", openArgs(shipment, { p_case_type: t }))));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error).toMatchObject({ message: "case_open_exists", code: "55000" });
  });

  it("cross-tenant, anonymous and machine callers are denied; tables have no direct writes; events are append-only", async () => {
    const shipment = await issued(), admin = await signIn("owner-a@geraiexpress.test"), other = await signIn("owner-b@geraiexpress.test");
    const id = (await admin.rpc("open_shipment_case", openArgs(shipment))).data as string;
    for (const [name, args] of [
      ["open_shipment_case", openArgs(shipment, { p_case_type: "late" })],
      ["update_shipment_case", updateArgs(id, 1)],
      ["close_shipment_case", { p_case: id, p_outcome: "rejected", p_decided_amount_idr: null, p_decided_by_party: null, p_note: null }],
      ["case_attention", { p_tenant: IDS.tenantA, p_limit: 5 }],
    ] as const) {
      expect((await other.rpc(name, args as Record<string, unknown>)).error?.code, name).toBe("P0002");
      for (const c of [client(), machine()]) expect((await c.rpc(name, args as Record<string, unknown>)).error?.code, name).toBe("42501");
    }
    expect((await other.from("shipment_cases").select("id").eq("id", id)).data).toEqual([]);
    expect((await other.from("shipment_case_events").select("id").eq("case_id", id)).data).toEqual([]);
    expect((await admin.from("shipment_case_events").select("id").eq("case_id", id)).data).toHaveLength(1);
    expect((await admin.from("shipment_cases").insert({ tenant_id: IDS.tenantA, shipment_id: shipment, case_type: "lost" })).error?.code).toBe("42501");
    expect((await admin.from("shipment_cases").update({ deadline_at: "2030-01-01T00:00:00Z" }).eq("id", id)).error?.code).toBe("42501");
    expect((await admin.from("shipment_case_events").delete().eq("case_id", id)).error?.code).toBe("42501");
    expect(() => sql(`update public.shipment_case_events set note = 'Forged' where case_id = '${id}'`)).toThrow(/append_only/);
    expect(() => sql(`delete from public.shipment_case_events where case_id = '${id}'`)).toThrow(/append_only/);
    expect(() => sql(`insert into public.shipment_cases (tenant_id, shipment_id, case_type, claim_type, description, opened_by)
      select '${IDS.tenantB}', '${shipment}', 'lost', 'other', 'Cross tenant case', opened_by from public.shipment_cases where id = '${id}'`)).toThrow(/foreign key/);
  });

  it("case_attention counts non-closed cases and provider returns for the member's tenant", async () => {
    const admin = await signIn("owner-a@geraiexpress.test");
    const before = ((await admin.rpc("case_attention", { p_tenant: IDS.tenantA, p_limit: 1 })).data as { count: number }).count;
    const returned = await issued();
    sql(`update public.shipments set delivery_state = 'returned' where id = '${returned}'`);
    const withCase = await issued();
    await admin.rpc("open_shipment_case", openArgs(withCase, { p_case_type: "return", p_claim_type: "return" }));
    const after = (await admin.rpc("case_attention", { p_tenant: IDS.tenantA, p_limit: 50 })).data as { count: number; rows: { id: string; returned: boolean; case_type: string | null }[] };
    expect(after.count).toBe(before + 2);
    expect(after.rows.find((r) => r.id === returned)).toMatchObject({ returned: true, case_type: null });
    expect(after.rows.find((r) => r.id === withCase)).toMatchObject({ returned: false, case_type: "return" });
    expect((await admin.rpc("case_attention", { p_tenant: IDS.tenantA, p_limit: 0 })).error).toMatchObject({ message: "invalid_input", code: "22023" });
  });
});
