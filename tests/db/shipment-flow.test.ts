// PR-4 / PR-5 / PR-7 / PR-22 / NFR-2 / DATA-2: simulated quote → explicit confirmation → one
// operation, stale revision/quote rejection, frozen snapshots, label reuse and unknown recovery.
import { beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { demoVisitor, sql } from "./helpers";

let c: TestClient;
let tenant: string;
let outlet: string;

async function newCompleteDraft(): Promise<{ id: string; revision: number }> {
  const { data: id, error } = await c.rpc("create_shipment_draft", { p_outlet: outlet });
  if (error) throw error;
  const { data, error: e2 } = await c.from("shipments").update({
    sender_name: "Pengirim Uji", sender_phone: "081255550001",
    recipient_name: "Penerima Uji", recipient_phone: "081255550002",
    recipient_address: "Jl. Penerima No. 5", recipient_area: "Kec. Uji, Kota Uji", recipient_postal_code: "40111",
    item_description: "Buku", weight_grams: 1500, length_cm: 20, width_cm: 15, height_cm: 10,
  }).eq("id", id).select("id,revision").single();
  if (e2) throw e2;
  return data!;
}

beforeAll(async () => {
  ({ c, tenant, outlet } = await demoVisitor());
});

describe("simulated shipping flow", () => {
  it("quotes expose only the customer (normal) tariff", async () => {
    const d = await newCompleteDraft();
    const { data: quotes, error } = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    expect(error).toBeNull();
    expect(quotes).toHaveLength(3);
    for (const q of quotes!) {
      expect(q.is_simulated).toBe(true);
      expect(Number.isInteger(q.normal_tariff_idr)).toBe(true);
      expect(Object.keys(q).some((k) => /net|cost|discount/i.test(k))).toBe(false);
    }
  });

  it("confirmation issues once; replays with the same or a new key return the original operation", async () => {
    const d = await newCompleteDraft();
    const { data: quotes } = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    const reguler = quotes!.find((q: { service: string }) => q.service === "Reguler");
    const args = { p_shipment: d.id, p_quote: reguler.id, p_expected_revision: d.revision, p_idempotency_key: `key-${d.id}` };

    const first = await c.rpc("confirm_shipment", args);
    expect(first.error).toBeNull();
    expect(first.data.replayed).toBe(false);
    expect(first.data.awb).toMatch(/^SIM\d+/);

    const replay = await c.rpc("confirm_shipment", args);
    expect(replay.data).toMatchObject({ operation_id: first.data.operation_id, replayed: true, awb: first.data.awb });
    const otherKey = await c.rpc("confirm_shipment", { ...args, p_idempotency_key: `other-${d.id}` });
    expect(otherKey.data).toMatchObject({ operation_id: first.data.operation_id, replayed: true });

    const { data: ops } = await c.from("provider_operations").select("id").eq("shipment_id", d.id);
    expect(ops).toHaveLength(1);

    const { data: s } = await c.from("shipments").select("submission_state,customer_charge_idr,pickup_snapshot").eq("id", d.id).single();
    expect(s!.submission_state).toBe("issued");
    expect(s!.customer_charge_idr).toBe(reguler.normal_tariff_idr);
    expect(s!.pickup_snapshot.outlet).toBe("Outlet Contoh Dago");
  });

  it("the same key with a different quote is a conflict, not a silent replay", async () => {
    const d = await newCompleteDraft();
    const { data: quotes } = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    const key = `diff-${d.id}`;
    await c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: quotes![0].id, p_expected_revision: d.revision, p_idempotency_key: key });
    const { error } = await c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: quotes![1].id, p_expected_revision: d.revision, p_idempotency_key: key });
    expect(error?.message).toBe("idempotency_conflict");
  });

  it("concurrent confirmations with different keys create exactly one operation", async () => {
    const d = await newCompleteDraft();
    const { data: quotes } = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: quotes![0].id, p_expected_revision: d.revision, p_idempotency_key: `race-${i}-${d.id}` })));
    expect(results.filter((r) => r.data && r.data.replayed === false)).toHaveLength(1);
    const { data: ops } = await c.from("provider_operations").select("id").eq("shipment_id", d.id);
    expect(ops).toHaveLength(1);
  });

  it("an idempotency key reused for another shipment is a conflict, not a silent reuse", async () => {
    const a = await newCompleteDraft();
    const { data: qa } = await c.rpc("request_quotes", { p_shipment: a.id, p_expected_revision: a.revision });
    await c.rpc("confirm_shipment", { p_shipment: a.id, p_quote: qa![0].id, p_expected_revision: a.revision, p_idempotency_key: `shared-${a.id}` });
    const b = await newCompleteDraft();
    const { data: qb } = await c.rpc("request_quotes", { p_shipment: b.id, p_expected_revision: b.revision });
    const { error } = await c.rpc("confirm_shipment", { p_shipment: b.id, p_quote: qb![0].id, p_expected_revision: b.revision, p_idempotency_key: `shared-${a.id}` });
    expect(error?.message).toBe("idempotency_conflict");
  });

  it("editing after a quote invalidates it: stale revision and stale quote are rejected", async () => {
    const d = await newCompleteDraft();
    const { data: quotes } = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    const { data: edited } = await c.from("shipments").update({ weight_grams: 3000 }).eq("id", d.id)
      .select("revision,submission_state").single();
    expect(edited!.revision).toBe(d.revision + 1);
    expect(edited!.submission_state).toBe("draft");

    const notEstimated = await c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: quotes![0].id, p_expected_revision: edited!.revision, p_idempotency_key: `stale-${d.id}` });
    expect(notEstimated.error?.message).toBe("not_estimated");

    await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: edited!.revision });
    const oldQuote = await c.rpc("confirm_shipment", { p_shipment: d.id, p_quote: quotes![0].id, p_expected_revision: edited!.revision, p_idempotency_key: `stale2-${d.id}` });
    expect(oldQuote.error?.message).toBe("stale_quote");
    const oldRevision = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    expect(oldRevision.error?.message).toBe("stale_revision");
  });

  it("submitted content is frozen and contact edits do not rewrite it", async () => {
    const { data: issued } = await c.from("shipments").select("id,sender_name,sender_contact_id")
      .eq("tenant_id", tenant).eq("submission_state", "issued").not("sender_contact_id", "is", null).limit(1).single();
    const { data: upd } = await c.from("shipments").update({ recipient_name: "Ganti Diam-diam" }).eq("id", issued!.id).select();
    expect(upd ?? []).toHaveLength(0);
    await c.from("contacts").update({ name: "Nama Kontak Baru" }).eq("id", issued!.sender_contact_id);
    const { data: after } = await c.from("shipments").select("sender_name").eq("id", issued!.id).single();
    expect(after!.sender_name).toBe(issued!.sender_name);
  });

  it("label request reuses the completed job", async () => {
    const { data: s } = await c.from("shipments").select("id").eq("tenant_id", tenant).eq("submission_state", "issued").limit(1).single();
    const one = await c.rpc("request_label", { p_shipment: s!.id });
    const two = await c.rpc("request_label", { p_shipment: s!.id });
    expect(one.error).toBeNull();
    expect(two.data.id).toBe(one.data.id);
  });

  it("label is refused before an AWB exists", async () => {
    const d = await newCompleteDraft();
    expect((await c.rpc("request_label", { p_shipment: d.id })).error?.message).toBe("no_awb");
  });

  it("an operator cannot resolve an unknown outcome; it stays unknown for the admin (DEC-008)", async () => {
    const op = await demoVisitor();
    const { data: s } = await op.c.from("shipments").select("id").eq("tenant_id", op.tenant).eq("submission_state", "unknown").single();
    sql(`update public.memberships set role = 'operator' where tenant_id = '${op.tenant}'`);
    const denied = await op.c.rpc("reconcile_shipment", { p_shipment: s!.id });
    expect(denied.error?.message).toBe("admin_required");
    const { data: after } = await op.c.from("shipments").select("submission_state").eq("id", s!.id).single();
    expect(after!.submission_state).toBe("unknown");
    const { data: ops } = await op.c.from("provider_operations").select("state").eq("shipment_id", s!.id);
    expect(ops).toEqual([{ state: "unknown" }]);
  });

  it("a demo visitor is the admin of their own sample gerai", async () => {
    const { data } = await c.from("memberships").select("role").eq("tenant_id", tenant);
    expect(data).toEqual([{ role: "tenant_admin" }]);
  });

  it("unknown outcome reconciles the original operation once", async () => {
    const { data: s } = await c.from("shipments").select("id").eq("tenant_id", tenant).eq("submission_state", "unknown").single();
    const first = await c.rpc("reconcile_shipment", { p_shipment: s!.id });
    expect(first.error).toBeNull();
    const { data: ops } = await c.from("provider_operations").select("id,state").eq("shipment_id", s!.id);
    expect(ops).toEqual([{ id: first.data.operation_id, state: "succeeded" }]);
    expect((await c.rpc("reconcile_shipment", { p_shipment: s!.id })).error?.message).toBe("nothing_to_reconcile");
  });

  it("requesting quotes again for the same revision reuses the same set", async () => {
    const d = await newCompleteDraft();
    const first = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    const again = await c.rpc("request_quotes", { p_shipment: d.id, p_expected_revision: d.revision });
    expect(again.error).toBeNull();
    expect(again.data!.map((q: { id: string }) => q.id)).toEqual(first.data!.map((q: { id: string }) => q.id));
    const { data: all } = await c.from("shipment_quotes").select("id").eq("shipment_id", d.id);
    expect(all).toHaveLength(3);
  });

  it("seeded submitted examples reference the quote they were confirmed with", async () => {
    await c.rpc("reset_demo");
    const { data: ships } = await c.from("shipments")
      .select("customer_charge_idr, selected_quote_id, shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(service, normal_tariff_idr)")
      .eq("tenant_id", tenant).neq("submission_state", "draft");
    expect(ships).toHaveLength(2);
    for (const s of ships!) {
      const q = s.shipment_quotes as unknown as { service: string; normal_tariff_idr: number };
      expect(q.service).toBe("Reguler");
      expect(q.normal_tariff_idr).toBe(s.customer_charge_idr);
    }
  });

  it("reset restores the seeded examples", async () => {
    const { error } = await c.rpc("reset_demo");
    expect(error).toBeNull();
    const { data: contacts } = await c.from("contacts").select("id").eq("tenant_id", tenant);
    const { data: ships } = await c.from("shipments").select("submission_state").eq("tenant_id", tenant);
    expect(contacts).toHaveLength(4);
    expect(ships!.map((s) => s.submission_state).sort()).toEqual(["draft", "issued", "unknown"]);
  });
});
