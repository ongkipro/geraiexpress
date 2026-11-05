// T-082 (PR-38, DATA-11): counter payment records and outlet cash periods. Payment needs a confirmed
// shipment with a known charge; COD shipping charges are never counter cash; one active record per
// shipment; a difference needs a reason; void is tenant-admin only, keeps the row; reopen_shipment is
// refused while an active record exists; another tenant can neither read nor write.
import { afterAll, describe, expect, it } from "vitest";
import { IDS, machine, realOperation, signIn, sql } from "./helpers";

// Shipments and outlets these tests add to the shared fixture tenant A; removed afterwards.
const createdOutlets: string[] = [];

async function confirmedShipment(opts: { outlet?: string; charge?: number | null; cod?: boolean; state?: string } = {}): Promise<{ shipment: string; outlet: string }> {
  // Ownership is immutable at every state; COD content is locked once queued. Set both at INSERT.
  const f = await realOperation({ tenant: IDS.tenantA, noCredential: true, outlet: opts.outlet, cod: opts.cod ? 62000 : undefined });
  const outlet = sql(`select outlet_id from public.shipments where id = '${f.shipment}'`);
  if (!opts.outlet) createdOutlets.push(outlet);
  const charge = opts.charge === undefined ? 12000 : opts.charge;
  sql(`update public.shipments set submission_state = '${opts.state ?? "issued"}',
    customer_charge_idr = ${charge === null ? "null" : charge} where id = '${f.shipment}'`);
  return { shipment: f.shipment, outlet };
}

const record = (shipment: string, over: Partial<{ p_method: string; p_amount_idr: number; p_received_idr: number | null; p_difference_reason: string | null }> = {}) => ({
  p_shipment: shipment, p_method: "cash", p_amount_idr: 12000, p_received_idr: 20000, p_difference_reason: null, ...over,
});

afterAll(() => {
  if (createdOutlets.length === 0) return;
  const list = createdOutlets.map((o) => `'${o}'`).join(",");
  sql(`update public.shipments set selected_quote_id = null where outlet_id in (${list});
    delete from public.shipments where outlet_id in (${list}); delete from public.outlets where id in (${list})`);
});

describe("record_counter_payment (T-082)", () => {
  it("records a cash payment, derives outlet and period, auto-opens one period and refuses a second record", async () => {
    const { shipment, outlet } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const first = await operator.rpc("record_counter_payment", record(shipment));
    expect(first.error).toBeNull();
    const id = first.data as string;
    expect(sql(`select outlet_id || '|' || method || '|' || amount_idr || '|' || expected_idr || '|' || cash_received_idr
      from public.counter_payments where id = '${id}'`)).toBe(`${outlet}|cash|12000|12000|20000`);
    expect(sql(`select count(*) from public.cash_periods where outlet_id = '${outlet}' and closed_at is null`)).toBe("1");
    expect(sql(`select p.period_id = c.id from public.counter_payments p join public.cash_periods c on c.id = p.period_id where p.id = '${id}'`)).toBe("t");

    // Second record (also a concurrent double-click) is refused; still one active row.
    const [a, b] = await Promise.all([
      operator.rpc("record_counter_payment", record(shipment)),
      operator.rpc("record_counter_payment", record(shipment)),
    ]);
    expect(a.error?.message).toBe("payment_recorded");
    expect(b.error?.message).toBe("payment_recorded");
    expect(sql(`select count(*) from public.counter_payments where shipment_id = '${shipment}'`)).toBe("1");
    // The partial index, not only the RPC precheck, enforces one active record.
    expect(() => sql(`insert into public.counter_payments
      select (jsonb_populate_record(null::public.counter_payments, to_jsonb(p) || jsonb_build_object('id', gen_random_uuid()))).*
      from public.counter_payments p where id = '${id}'`)).toThrow(/counter_payments_one_active_per_shipment/);

    // A second shipment of the same outlet joins the same open period.
    const second = await confirmedShipment({ outlet });
    const r2 = await operator.rpc("record_counter_payment", record(second.shipment, { p_method: "qris", p_received_idr: null }));
    expect(r2.error).toBeNull();
    expect(sql(`select count(distinct period_id) from public.counter_payments where outlet_id = '${outlet}'`)).toBe("1");
    expect(sql(`select count(*) from public.audit_events where action = 'counter_payment.record' and detail->>'shipment' = '${shipment}'`)).toBe("1");
  });

  it("concurrent first payments of two shipments of one outlet open exactly one period", async () => {
    const one = await confirmedShipment();
    const two = await confirmedShipment({ outlet: one.outlet });
    const operator = await signIn("operator-a@geraiexpress.test");
    const results = await Promise.all([
      operator.rpc("record_counter_payment", record(one.shipment)),
      operator.rpc("record_counter_payment", record(two.shipment)),
    ]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect(sql(`select count(*) from public.cash_periods where outlet_id = '${one.outlet}'`)).toBe("1");
  });

  it("refuses an unconfirmed shipment or an unknown charge with charge_unknown", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    for (const state of ["draft", "estimated", "awaiting_payment", "failed"]) {
      const { shipment } = await confirmedShipment({ state });
      expect((await operator.rpc("record_counter_payment", record(shipment))).error?.message).toBe("charge_unknown");
    }
    const unknown = await confirmedShipment({ charge: null, state: "queued" });
    expect((await operator.rpc("record_counter_payment", record(unknown.shipment))).error?.message).toBe("charge_unknown");
  });

  it("never records the courier-collected shipping charge of a COD shipment", async () => {
    const { shipment } = await confirmedShipment({ cod: true });
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("record_counter_payment", record(shipment))).error?.message).toBe("cod_collected_by_courier");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_amount_idr: 5000, p_difference_reason: "Biaya tambahan" }))).error?.message)
      .toBe("cod_collected_by_courier");
    expect(sql(`select count(*) from public.counter_payments where shipment_id = '${shipment}'`)).toBe("0");
    expect(sql(`select count(*) from public.cash_periods where outlet_id = (select outlet_id from public.shipments where id = '${shipment}')`)).toBe("0");
  });

  it("requires a reason for a difference, validates method and cash received", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_amount_idr: 10000 }))).error?.message).toBe("difference_reason_required");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_method: "crypto" }))).error?.message).toBe("payment_invalid");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_amount_idr: 0 }))).error?.message).toBe("payment_invalid");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_received_idr: 5000 }))).error?.message).toBe("cash_received_invalid");
    expect((await operator.rpc("record_counter_payment", record(shipment, { p_method: "transfer", p_received_idr: 12000 }))).error?.message).toBe("cash_received_invalid");
    const ok = await operator.rpc("record_counter_payment", record(shipment, { p_amount_idr: 10000, p_received_idr: 10000, p_difference_reason: "Pelanggan tetap" }));
    expect(ok.error).toBeNull();
    expect(sql(`select amount_idr || '|' || expected_idr || '|' || difference_reason from public.counter_payments where id = '${ok.data}'`))
      .toBe("10000|12000|Pelanggan tetap");
  });

  it("retains the bigint domain without imposing the JavaScript presentation ceiling on stored amounts", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const result = await operator.rpc("record_counter_payment", {
      p_shipment: shipment, p_method: "transfer", p_amount_idr: "9007199254740992", p_received_idr: null,
      p_difference_reason: "Nilai uji besar",
    });
    expect(result.error).toBeNull();
    expect(sql(`select amount_idr from public.counter_payments where id = '${result.data}'`)).toBe("9007199254740992");
  });

  it("keeps rows append-only: no amount change and no delete, even as the table owner", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const r = await operator.rpc("record_counter_payment", record(shipment));
    expect(r.error).toBeNull();
    expect(() => sql(`update public.counter_payments set amount_idr = 1 where id = '${r.data}'`)).toThrow(/payment_append_only/);
    expect(() => sql(`delete from public.counter_payments where id = '${r.data}'`)).toThrow(/payment_append_only/);
    expect(() => sql("truncate public.counter_payments cascade")).toThrow(/payment_append_only|label_history_is_append_only/);
  });
});

describe("payment receipt identity (T-082 implementation proposal)", () => {
  it("freezes payment-time gerai identity and uses an honest neutral staff label", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const id = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    expect(sql(`select p.receipt_gerai_name = t.name and p.receipt_gerai_whatsapp is not distinct from t.contact_whatsapp
      from public.counter_payments p join public.tenants t on t.id = p.tenant_id where p.id = '${id}'`)).toBe("t");
    expect(sql(`select recorded_by_label from public.counter_payments where id = '${id}'`)).toBe("Petugas");
    expect(() => sql(`update public.counter_payments set receipt_gerai_name = 'Nama baru' where id = '${id}'`)).toThrow(/payment_append_only/);
  });
});

describe("void_counter_payment (T-082)", () => {
  it("is tenant-admin only, requires a reason, keeps the row and allows a new record", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = (await operator.rpc("record_counter_payment", record(shipment))).data as string;

    expect((await operator.rpc("void_counter_payment", { p_payment: id, p_reason: "Salah input" })).error?.message).toBe("admin_required");
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "x" })).error?.message).toBe("reason_required");
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "Salah metode bayar" })).error).toBeNull();
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "Salah metode bayar" })).error?.message).toBe("payment_voided");

    const ownerId = sql(`select id from auth.users where email = 'owner-a@geraiexpress.test'`);
    expect(sql(`select (voided_at is not null) || '|' || voided_by || '|' || void_reason from public.counter_payments where id = '${id}'`))
      .toBe(`true|${ownerId}|Salah metode bayar`);
    expect(sql(`select count(*) from public.audit_events where action = 'counter_payment.void' and detail->>'payment' = '${id}'`)).toBe("1");

    // The voided record stays visible; a new active record is allowed.
    const again = await operator.rpc("record_counter_payment", record(shipment, { p_method: "qris", p_received_idr: null }));
    expect(again.error).toBeNull();
    expect(sql(`select count(*) || '|' || count(*) filter (where voided_at is null) from public.counter_payments where shipment_id = '${shipment}'`)).toBe("2|1");
  });

  it("refuses a void in a closed period", async () => {
    const { shipment, outlet } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    sql(`update public.cash_periods set closed_at = now(), counted_cash_idr = 12000, expected_cash_idr = 12000, variance_idr = 0
      where outlet_id = '${outlet}' and closed_at is null`);
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "Salah metode bayar" })).error?.message).toBe("period_closed");
  });

  it("refuses a closed period without its stored variance", async () => {
    const { shipment, outlet } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    await operator.rpc("record_counter_payment", record(shipment));
    // A NULL variance would make the closed-branch comparison NULL, which a CHECK alone accepts.
    expect(() => sql(`update public.cash_periods set closed_at = now(), counted_cash_idr = 12000, expected_cash_idr = 12000, variance_idr = null
      where outlet_id = '${outlet}' and closed_at is null`)).toThrow(/cash_periods_close_complete/);
  });
});

describe("reopen_shipment with an active counter payment (T-082)", () => {
  it("is refused until the record is voided", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    // A definite provider refusal after the payment was taken.
    sql(`update public.provider_operations set state = 'failed', result_code = 'PROVIDER_REJECTED' where shipment_id = '${shipment}';
      update public.shipments set submission_state = 'failed' where id = '${shipment}'`);
    expect((await operator.rpc("reopen_shipment", { p_shipment: shipment })).error?.message).toBe("payment_recorded");
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "Pengiriman ditolak" })).error).toBeNull();
    expect((await operator.rpc("reopen_shipment", { p_shipment: shipment })).error).toBeNull();
  });
});

describe("record_receipt_print (T-082)", () => {
  const currentIdentity = () => JSON.parse(sql(`select jsonb_build_object(
    'p_preview_gerai_name', name, 'p_preview_gerai_whatsapp', contact_whatsapp)
    from public.tenants where id = '${IDS.tenantA}'`)) as { p_preview_gerai_name: string; p_preview_gerai_whatsapp: string | null };
  const literal = (value: string | null) => value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
  const setIdentity = (identity: ReturnType<typeof currentIdentity>) => sql(`update public.tenants
    set name = ${literal(identity.p_preview_gerai_name)}, contact_whatsapp = ${literal(identity.p_preview_gerai_whatsapp)}
    where id = '${IDS.tenantA}'`);

  it("appends requested widths to the existing history without another non-COD receipt snapshot", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const payment = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    for (const width of ["58", "80"]) {
      const result = await operator.rpc("record_receipt_print", { p_shipment: shipment, p_payment: payment, p_width: width });
      expect(result.error).toBeNull();
      expect(sql(`select kind || '|' || size || '|' || receipt_payment_id || '|' || (snapshot_id is null)
        from public.label_print_events where id = ${result.data}`)).toBe(`receipt|${width}|${payment}|true`);
    }
    expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}' and kind = 'receipt'`)).toBe("2");
    const event = sql(`select id from public.label_print_events where shipment_id = '${shipment}' limit 1`);
    expect(() => sql(`update public.label_print_events set size = '58' where id = ${event}`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`delete from public.label_print_events where id = ${event}`)).toThrow(/label_history_is_append_only/);
  });

  it("serializes receipt print and void on the shipment without a payment/FK lock inversion", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const payment = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    const [printed, voided] = await Promise.all([
      operator.rpc("record_receipt_print", { p_shipment: shipment, p_payment: payment, p_width: "58" }),
      owner.rpc("void_counter_payment", { p_payment: payment, p_reason: "Salah catatan" }),
    ]);
    expect(voided.error).toBeNull();
    expect([null, "not_found"]).toContain(printed.error?.message ?? null);
    expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}'`)).toBe(printed.error ? "0" : "1");
  });

  it("requires membership, known confirmed charge and an active same-shipment payment, except for COD", async () => {
    const one = await confirmedShipment();
    const two = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const other = await signIn("owner-b@geraiexpress.test");
    const payment = (await operator.rpc("record_counter_payment", record(one.shipment))).data as string;
    const print = (shipment: string, id: string | null = payment, width = "58") => ({ p_shipment: shipment, p_payment: id, p_width: width });
    expect((await other.rpc("record_receipt_print", print(one.shipment))).error?.message).toBe("not_found");
    expect((await other.from("label_print_events").select("id").eq("shipment_id", one.shipment)).data).toEqual([]);
    expect((await operator.rpc("record_receipt_print", print(two.shipment))).error?.message).toBe("not_found");
    expect((await operator.rpc("record_receipt_print", print(one.shipment, null))).error?.message).toBe("not_found");
    expect((await operator.rpc("record_receipt_print", print(one.shipment, payment, "99"))).error?.message).toBe("receipt_width_invalid");
    for (const state of ["draft", "awaiting_payment", "failed"]) {
      const f = await confirmedShipment({ state });
      expect((await operator.rpc("record_receipt_print", print(f.shipment))).error?.message).toBe("charge_unknown");
    }
    const unknown = await confirmedShipment({ charge: null });
    expect((await operator.rpc("record_receipt_print", print(unknown.shipment))).error?.message).toBe("charge_unknown");
    expect((await owner.rpc("void_counter_payment", { p_payment: payment, p_reason: "Salah catatan" })).error).toBeNull();
    expect((await operator.rpc("record_receipt_print", print(one.shipment))).error?.message).toBe("not_found");
    const cod = await confirmedShipment({ cod: true });
    expect((await operator.rpc("record_receipt_print", { ...print(cod.shipment, null), ...currentIdentity() })).error).toBeNull();
    expect((await operator.rpc("record_receipt_print", print(cod.shipment))).error?.message).toBe("cod_collected_by_courier");
    expect((await operator.from("label_print_events").insert({ tenant_id: IDS.tenantA, shipment_id: cod.shipment, kind: "receipt", size: "58" })).error).not.toBeNull();
  });

  it("refuses stale COD previews, freezes first-print identity, and reprints it instead of live tenant settings", async () => {
    const { shipment } = await confirmedShipment({ cod: true });
    const operator = await signIn("operator-a@geraiexpress.test");
    const other = await signIn("owner-b@geraiexpress.test");
    const original = currentIdentity();
    const preview = { p_preview_gerai_name: "Gerai COD Pertama", p_preview_gerai_whatsapp: "081234561111" };
    const request = { p_shipment: shipment, p_payment: null, p_width: "58" };
    try {
      setIdentity(preview);
      for (const stale of [
        {}, // Old clients without a preview cannot accidentally freeze a different document.
        { ...preview, p_preview_gerai_name: "Nama Lama" },
        { ...preview, p_preview_gerai_whatsapp: "081234569999" },
      ]) {
        expect((await operator.rpc("record_receipt_print", { ...request, ...stale })).error?.message).toBe("receipt_identity_changed");
        expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}'`)).toBe("0");
      }
      expect((await other.rpc("record_receipt_print", { ...request, ...preview })).error?.message).toBe("not_found");
      const first = await operator.rpc("record_receipt_print", { ...request, ...preview });
      expect(first.error).toBeNull();
      const columns = "receipt_gerai_name,receipt_gerai_whatsapp,receipt_payment_id,kind,size";
      const frozen = { receipt_gerai_name: preview.p_preview_gerai_name, receipt_gerai_whatsapp: preview.p_preview_gerai_whatsapp,
        receipt_payment_id: null, kind: "receipt", size: "58" };
      expect((await operator.from("label_print_events").select(columns).eq("id", first.data).single()).data).toEqual(frozen);
      expect((await other.from("label_print_events").select(columns).eq("shipment_id", shipment)).data).toEqual([]);
      expect((await operator.from("label_print_events").update({ receipt_gerai_name: "Palsu" }).eq("id", first.data)).error?.code).toBe("42501");
      expect((await operator.from("label_print_events").delete().eq("id", first.data)).error?.code).toBe("42501");
      expect(() => sql(`update public.label_print_events set receipt_gerai_name = 'Palsu' where id = ${first.data}`)).toThrow(/label_history_is_append_only/);
      const changed = { p_preview_gerai_name: "Gerai COD Setelahnya", p_preview_gerai_whatsapp: "081234562222" };
      setIdentity(changed);
      expect((await operator.rpc("record_receipt_print", { ...request, ...changed })).error?.message).toBe("receipt_identity_changed");
      expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}'`)).toBe("1");
      const reprint = await operator.rpc("record_receipt_print", { ...request, p_width: "80", ...preview });
      expect(reprint.error).toBeNull();
      expect((await operator.from("label_print_events").select(columns).eq("id", reprint.data).single()).data).toEqual({ ...frozen, size: "80" });
      expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}'`)).toBe("2");
    } finally {
      setIdentity(original);
    }
  });

  it("serializes first COD printers and preserves absent WhatsApp as NULL on reprint", async () => {
    const { shipment } = await confirmedShipment({ cod: true });
    const operator = await signIn("operator-a@geraiexpress.test");
    const original = currentIdentity();
    const preview = { ...original, p_preview_gerai_whatsapp: null };
    const request = { p_shipment: shipment, p_payment: null, ...preview };
    try {
      setIdentity(preview);
      const results = await Promise.all(["58", "80"].map((p_width) => operator.rpc("record_receipt_print", { ...request, p_width })));
      for (const result of results) expect(result.error).toBeNull();
      setIdentity({ ...original, p_preview_gerai_whatsapp: "081234563333" });
      expect((await operator.rpc("record_receipt_print", { ...request, p_width: "58" })).error).toBeNull();
      const rows = await operator.from("label_print_events").select("receipt_gerai_name,receipt_gerai_whatsapp")
        .eq("shipment_id", shipment).eq("kind", "receipt");
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual(Array.from({ length: 3 }, () => ({ receipt_gerai_name: original.p_preview_gerai_name, receipt_gerai_whatsapp: null })));
    } finally {
      setIdentity(original);
    }
  });

  it("keeps non-COD payment-time identity after tenant changes, without copying it into print events", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const original = currentIdentity();
    const payment = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    try {
      setIdentity({ p_preview_gerai_name: "Gerai Setelah Bayar", p_preview_gerai_whatsapp: "081234564444" });
      const stored = await operator.from("counter_payments").select("receipt_gerai_name,receipt_gerai_whatsapp").eq("id", payment).single();
      expect(stored.error).toBeNull();
      expect(stored.data).toEqual({ receipt_gerai_name: original.p_preview_gerai_name, receipt_gerai_whatsapp: original.p_preview_gerai_whatsapp });
      const printed = await operator.rpc("record_receipt_print", { p_shipment: shipment, p_payment: payment, p_width: "58" });
      expect(printed.error).toBeNull();
      expect(sql(`select (receipt_gerai_name is null) and (receipt_gerai_whatsapp is null)
        from public.label_print_events where id = ${printed.data}`)).toBe("t");
    } finally {
      setIdentity(original);
    }
  });

  it("preserves original label snapshot and size requirements and defaults existing label prints to kind label", async () => {
    const { shipment } = await confirmedShipment();
    sql(`update public.shipments set awb = 'JP1234567890' where id = '${shipment}'`);
    const operator = await signIn("operator-a@geraiexpress.test");
    const label = await operator.rpc("create_label_snapshot", {
      p_shipment: shipment, p_mask: true, p_size: "10x15", p_sender_name: "Toko Uji", p_sender_phone: "081311112222", p_sender_city: "Bandung",
    });
    expect(label.error).toBeNull();
    expect((await operator.rpc("record_label_print", { p_snapshot: label.data })).error).toBeNull();
    expect(sql(`select kind || '|' || size || '|' || (receipt_payment_id is null)
      from public.label_print_events where shipment_id = '${shipment}'`)).toBe("label|10x15|true");
    const actor = sql(`select id from auth.users where email = 'operator-a@geraiexpress.test'`);
    const insert = (kind: string, snapshot: string, size: string, payment = "null", name = "null", whatsapp = "null") =>
      `insert into public.label_print_events (tenant_id, shipment_id, kind, snapshot_id, size, actor, receipt_payment_id, receipt_gerai_name, receipt_gerai_whatsapp)
       values ('${IDS.tenantA}', '${shipment}', '${kind}', ${snapshot}, '${size}', '${actor}', ${payment}, ${name}, ${whatsapp})`;
    expect(() => sql(insert("label", "null", "10x15"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("label", `'${label.data}'`, "58"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("receipt", `'${label.data}'`, "58"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("receipt", "null", "10x15"))).toThrow(/label_print_events_kind_content/);
    const payment = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    expect(() => sql(insert("label", `'${label.data}'`, "10x15", `'${payment}'`))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("label", `'${label.data}'`, "10x15", "null", "'Gerai Palsu'"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("label", `'${label.data}'`, "10x15", "null", "null", "'081234567890'"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("receipt", "null", "58", `'${payment}'`, "'Gerai Palsu'"))).toThrow(/label_print_events_kind_content/);
    expect(() => sql(insert("receipt", "null", "58"))).toThrow(/label_print_events_kind_content/);
  });
});

describe("counter payment read boundary (T-082 / IAM-1)", () => {
  it("keeps the exact effective machine table and column privilege set empty on RPC-only new tables", () => {
    for (const table of ["counter_payments", "cash_periods", "mengantar_areas"]) {
      expect(sql(`select coalesce(string_agg(p, ',' order by p), '')
        from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
        where has_table_privilege('service_role', 'public.${table}', p)`), table).toBe("");
      expect(sql(`select coalesce(string_agg(p, ',' order by p), '')
        from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
        where has_any_column_privilege('service_role', 'public.${table}', p)`), table).toBe("");
    }
  });

  it("refuses direct machine reads/writes and cannot delete a period to erase its payment or receipt", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const saved = await operator.rpc("record_counter_payment", record(shipment));
    expect(saved.error).toBeNull();
    const payment = saved.data as string;
    expect((await operator.rpc("record_receipt_print", { p_shipment: shipment, p_payment: payment, p_width: "58" })).error).toBeNull();
    const period = sql(`select period_id from public.counter_payments where id = '${payment}'`);
    const m = machine();
    for (const table of ["cash_periods", "counter_payments"]) {
      const id = table === "cash_periods" ? period : payment;
      expect((await m.from(table).select("id").eq("id", id)).error?.code).toBe("42501");
      expect((await m.from(table).insert({ tenant_id: IDS.tenantA })).error?.code).toBe("42501");
      expect((await m.from(table).update({ id }).eq("id", id)).error?.code).toBe("42501");
      expect((await m.from(table).delete().eq("id", id)).error?.code).toBe("42501");
    }
    // The FK also protects history from an owner delete, independently of the machine ACL.
    expect(() => sql(`delete from public.cash_periods where id = '${period}'`)).toThrow(/counter_payments_tenant_id_period_id_fkey/);
    expect(sql(`select count(*) from public.counter_payments where id = '${payment}'`)).toBe("1");
    expect(sql(`select count(*) from public.label_print_events where receipt_payment_id = '${payment}'`)).toBe("1");
  });

  it("keeps receipt facts member-readable but administrative expected charge and reasons RPC-only", async () => {
    const { shipment } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const other = await signIn("owner-b@geraiexpress.test");
    const saved = await operator.rpc("record_counter_payment", record(shipment, {
      p_method: "qris", p_amount_idr: 10000, p_received_idr: null, p_difference_reason: "Pelanggan langganan",
    }));
    expect(saved.error).toBeNull();
    const id = saved.data as string;
    const safeColumns = "id,method,amount_idr,cash_received_idr,recorded_by_label,recorded_at,receipt_gerai_name,receipt_gerai_whatsapp";
    const receipt = await operator.from("counter_payments").select(safeColumns).eq("id", id).is("voided_at", null).maybeSingle();
    expect(receipt.error).toBeNull();
    expect(receipt.data).toMatchObject({ id, method: "qris", amount_idr: 10000, cash_received_idr: null, recorded_by_label: "Petugas" });
    expect(receipt.data).not.toHaveProperty("expected_idr");
    expect(receipt.data).not.toHaveProperty("difference_reason");
    for (const column of ["expected_idr", "difference_reason", "void_reason"]) {
      const forbidden = await operator.from("counter_payments").select(`id,${column}`).eq("id", id);
      expect(forbidden.error?.code).toBe("42501");
      expect(forbidden.data).toBeNull();
    }
    expect((await operator.from("counter_payments").select("*").eq("id", id)).error?.code).toBe("42501");
    expect((await operator.from("counter_payments").select("id").eq("difference_reason", "Pelanggan langganan")).error?.code).toBe("42501");
    expect((await operator.rpc("counter_payment_admin_details", { p_shipment: shipment })).error?.message).toBe("admin_required");
    const details = await owner.rpc("counter_payment_admin_details", { p_shipment: shipment });
    expect(details.error).toBeNull();
    expect(details.data).toEqual([{ payment_id: id, expected_idr: 12000, difference_reason: "Pelanggan langganan", void_reason: null }]);
    expect((await other.from("counter_payments").select(safeColumns).eq("id", id)).data).toEqual([]);
    expect((await other.rpc("counter_payment_admin_details", { p_shipment: shipment })).error?.message).toBe("not_found");
    expect((await owner.rpc("void_counter_payment", { p_payment: id, p_reason: "Salah metode bayar" })).error).toBeNull();
    const voided = await owner.rpc("counter_payment_admin_details", { p_shipment: shipment });
    expect(voided.error).toBeNull();
    expect(voided.data).toEqual([{ payment_id: id, expected_idr: 12000, difference_reason: "Pelanggan langganan", void_reason: "Salah metode bayar" }]);
  });
});

describe("cross-tenant denial (T-082)", () => {
  it("another tenant can neither read nor write counter payments or cash periods", async () => {
    const { shipment, outlet } = await confirmedShipment();
    const operator = await signIn("operator-a@geraiexpress.test");
    const id = (await operator.rpc("record_counter_payment", record(shipment))).data as string;
    const other = await signIn("owner-b@geraiexpress.test");

    expect((await other.from("counter_payments").select("id").eq("id", id)).data).toEqual([]);
    expect((await other.from("cash_periods").select("id").eq("outlet_id", outlet)).data).toEqual([]);
    expect((await other.rpc("record_counter_payment", record(shipment))).error?.message).toBe("not_found");
    expect((await other.rpc("void_counter_payment", { p_payment: id, p_reason: "Coba batalkan" })).error?.message).toBe("not_found");

    // No direct write path exists for members either.
    expect((await operator.from("counter_payments").insert({ tenant_id: IDS.tenantA, shipment_id: shipment })).error).not.toBeNull();
    expect((await operator.from("counter_payments").update({ amount_idr: 1 }).eq("id", id)).error).not.toBeNull();
    expect((await operator.from("cash_periods").insert({ tenant_id: IDS.tenantA, outlet_id: outlet })).error).not.toBeNull();
    expect(sql(`select amount_idr from public.counter_payments where id = '${id}'`)).toBe("12000");
  });
});
