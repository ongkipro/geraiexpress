// T-081 / PR-41 / DATA-13: the content declaration is accepted only inside confirm_shipment against
// the current text version, frozen with member and time, and the text is append-only.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { demoVisitor, machine, realOperation, signIn, signInAal2, sql } from "./helpers";

let c: TestClient;
let outlet: string;

async function quotedDraft(itemDescription: string | null = "Buku") {
  const { data: id, error } = await c.rpc("create_shipment_draft", { p_outlet: outlet });
  if (error) throw error;
  const { data: d, error: e2 } = await c.from("shipments").update({
    sender_name: "Pengirim Uji", sender_phone: "081255550001", recipient_name: "Penerima Uji", recipient_phone: "081255550002",
    recipient_address: "Jl. Penerima No. 5", recipient_area: "Kec. Uji, Kota Uji", item_description: "Buku", weight_grams: 1500,
  }).eq("id", id).select("id,revision").single();
  if (e2) throw e2;
  const { data: quotes } = await c.rpc("request_quotes", { p_shipment: d!.id, p_expected_revision: d!.revision });
  if (itemDescription === null) {
    // Simulates a draft whose description was emptied after quoting (bypassing the app form).
    sql(`alter table public.shipments disable trigger user; update public.shipments set item_description = '  ' where id = '${d!.id}';
      alter table public.shipments enable trigger user;`);
  }
  return { id: d!.id as string, revision: d!.revision as number, quote: quotes![0].id as string };
}
const confirm = (d: { id: string; revision: number; quote: string }, version: number | null) =>
  c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: d.quote, p_expected_revision: d.revision, p_idempotency_key: randomUUID(), p_declaration_version: version });

beforeAll(async () => {
  ({ c, outlet } = await demoVisitor());
});

describe("content declaration (T-081)", () => {
  it("seeds one provisional Bahasa text listing the six Pasal 22(3) categories, readable by members", async () => {
    const { data, error } = await c.from("declaration_texts").select("version, body, prohibited_categories, provisional, source_url");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ version: 1, provisional: true });
    expect(data![0].prohibited_categories).toHaveLength(6);
    expect(data![0].prohibited_categories[0]).toContain("narkotika");
    expect(data![0].source_url).toContain("jdih.komdigi.go.id");
  });

  it("refuses confirmation without the declaration or with a non-current version, changing nothing", async () => {
    const d = await quotedDraft();
    expect((await confirm(d, null)).error?.message).toBe("content_declaration_required");
    expect((await confirm(d, 2)).error?.message).toBe("content_declaration_required");
    expect(sql(`select submission_state || '|' || coalesce(content_declaration_version::text, 'null') from public.shipments where id = '${d.id}'`)).toBe("estimated|null");
    expect(sql(`select count(*) from public.provider_operations where shipment_id = '${d.id}'`)).toBe("0");
  });

  it("refuses confirmation of a blank content description, naming it", async () => {
    const d = await quotedDraft(null);
    expect((await confirm(d, 1)).error?.message).toBe("content_description_required");
  });

  it("freezes version, confirming member and time; members cannot write those columns directly", async () => {
    const d = await quotedDraft();
    const before = Date.now();
    const { error } = await confirm(d, 1);
    expect(error).toBeNull();
    const row = JSON.parse(sql(`select jsonb_build_object('v', content_declaration_version, 'by', content_declared_by, 'at', content_declared_at)
      from public.shipments where id = '${d.id}'`));
    const uid = sql(`select user_id from public.memberships m join public.outlets o on o.tenant_id = m.tenant_id where o.id = '${outlet}' limit 1`);
    expect(row.v).toBe(1);
    expect(row.by).toBe(uid);
    expect(Date.parse(row.at)).toBeGreaterThanOrEqual(before - 5000);
    for (const patch of [{ content_declaration_version: 1 }, { content_declared_by: uid }, { content_declared_at: new Date().toISOString() }]) {
      expect((await c.from("shipments").update(patch).eq("id", d.id)).error).not.toBeNull();
    }
  });

  it("members cannot add or alter declaration texts; only the tenant_governance platform capability appends", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.from("declaration_texts").insert({ version: 9, body: "x".repeat(30), prohibited_categories: ["a"],
      source_url: "https://example.com", provisional: true, effective_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await owner.rpc("platform_add_declaration_text", { p_body: "x".repeat(30), p_categories: ["a"],
      p_source_url: "https://example.com", p_provisional: true, p_reason: "test" })).error).not.toBeNull();
    expect(() => sql("update public.declaration_texts set body = body || '!' where version = 1")).toThrow(/declaration_text_immutable/);
    const admin = await signInAal2("admin@geraiexpress.test");
    const added = await admin.rpc("platform_add_declaration_text", { p_body: "Pernyataan uji versi kedua untuk regresi.", p_categories: ["kategori uji"],
      p_source_url: "https://jdih.komdigi.go.id/", p_provisional: true, p_reason: "Offline regression" });
    try {
      expect(added.error).toBeNull();
      expect(added.data).toBe(2);
      // A newer current version: confirming with the old one is refused.
      const d = await quotedDraft();
      expect((await confirm(d, 1)).error?.message).toBe("content_declaration_required");
      expect((await confirm(d, 2)).error).toBeNull();
    } finally {
      sql(`alter table public.declaration_texts disable trigger declaration_texts_append_only;
        update public.shipments set content_declaration_version = null, content_declared_by = null, content_declared_at = null where content_declaration_version = 2;
        delete from public.declaration_texts where version = 2;
        alter table public.declaration_texts enable trigger declaration_texts_append_only;`);
    }
  });

  it("another member of the gerai can identify which staff member recorded the declaration (PR-41)", async () => {
    // A real (non-demo) gerai with two members: operator-a confirms, owner-a reads the frozen snapshot.
    const f = await realOperation();
    const OPERATOR = "00000000-0000-4000-a000-0000000000a2", OWNER = "00000000-0000-4000-a000-0000000000a1";
    sql(`delete from public.provider_operations where id = '${f.op}';
      insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '${OWNER}', 'tenant_admin'), ('${f.tenant}', '${OPERATOR}', 'operator');
      update public.shipments set submission_state = 'draft' where id = '${f.shipment}';
      update public.shipments set sender_name = 'Pengirim Uji', sender_phone = '081234567890', recipient_area = 'Wilayah Uji' where id = '${f.shipment}';`);
    try {
      const revision = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
      const rule = sql(`select id from private.billable_weight_rules where courier = 'JT' and service_class = 'regular' order by effective_at desc limit 1`);
      const quoted = await machine().rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: revision,
        p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
        p_rows: [{ courier: "JT", tariff: 9000, net: 7000, billable_weight_grams: 1000, weight_rule_id: rule }] });
      expect(quoted.error).toBeNull();
      const quote = sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`);
      const operator = await signIn("operator-a@geraiexpress.test");
      const confirmed = await operator.rpc("confirm_shipment", { p_shipment: f.shipment, p_quote: quote, p_expected_revision: revision,
        p_idempotency_key: randomUUID(), p_declaration_version: 1 });
      expect(confirmed.error).toBeNull();
      const owner = await signIn("owner-a@geraiexpress.test");
      const { data, error } = await owner.from("shipments").select("content_declared_by, content_declared_by_email").eq("id", f.shipment).single();
      expect(error).toBeNull();
      expect(data).toEqual({ content_declared_by: OPERATOR, content_declared_by_email: "operator-a@geraiexpress.test" });
      expect((await owner.from("shipments").update({ content_declared_by_email: "x@y.z" }).eq("id", f.shipment)).error).not.toBeNull();
    } finally {
      sql(`delete from public.memberships where tenant_id = '${f.tenant}' and user_id in ('${OWNER}', '${OPERATOR}')`);
    }
  });

  it("the old four-argument confirmation no longer exists", async () => {
    const d = await quotedDraft();
    const { error } = await c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: d.quote, p_expected_revision: d.revision, p_idempotency_key: randomUUID() });
    expect(error).not.toBeNull();
  });
});
