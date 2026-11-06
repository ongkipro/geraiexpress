// T-045 / ADR-0003: the tenant admin connects the Mengantar status webhook; a signed delivery on the cookie-less
// hooks host updates the shipment, and the public tracking page shows the mapped status (kind + time only).
// Synthetic data only; no provider call (the "provider" is this test, signing like Mengantar does).
import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { audienceUrl, expectNoHorizontalOverflow, localSql, signIn } from "./helpers";

const tenant = "00000000-0000-4000-b000-00000000000a";
const outlet = "00000000-0000-4000-c000-00000000000a";
const owner = "00000000-0000-4000-a000-0000000000a1";
const SECRET = `whsec_e2e_${randomUUID().replace(/-/g, "")}`;
const created: string[] = [];

test.afterAll(() => {
  localSql(`delete from private.webhook_endpoints where tenant_id = '${tenant}'; delete from private.seller_credentials where tenant_id = '${tenant}' and hint = 'TXYZ'`);
  if (created.length) {
    const ids = created.map((id) => `'${id}'`).join(",");
    localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
});

function issuedShipment() {
  const id = randomUUID(), quote = randomUUID(), op = randomUUID();
  const orderId = `ORD${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const awb = `JP${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  created.push(id);
  localSql(`insert into public.shipments(tenant_id,outlet_id,id,reference,submission_state,payment_state,sender_name,sender_phone,
      recipient_name,recipient_phone,recipient_address,recipient_area,item_description,weight_grams,goods_value_idr,is_cod,is_simulated,created_by,awb,issued_at)
    values ('${tenant}','${outlet}','${id}','STATUS-E2E-${id.slice(0, 6)}','issued','paid','Pengirim Uji','081200000099',
      'Penerima Uji','081299998888','Jl. Tujuan 9','Kec. Tujuan, Kota Uji','Buku',1000,50000,false,false,'${owner}','${awb}',now());
    insert into public.shipment_quotes(tenant_id,shipment_id,id,shipment_revision,courier,service,normal_tariff_idr,eta_days,is_simulated,expires_at)
      values ('${tenant}','${id}','${quote}',1,'JT','REG',24680,'1-2',false,now()+interval '1 hour');
    update public.shipments set selected_quote_id='${quote}' where id='${id}';
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor, provider_env, provider_order_id)
      values ('${tenant}','${id}','${op}','create_order','key-${op}','digest','succeeded',false,'${owner}','sandbox','${orderId}');`);
  return { id, orderId, awb };
}

test("an admin connects the status webhook; a signed delivery updates the public tracking page", async ({ page, playwright, baseURL }, info) => {
  test.skip(info.project.name !== "desktop-1280" && info.project.name !== "mobile-390", "390 and 1280");
  const hooks = audienceUrl("hooks", baseURL!);
  test.skip(!hooks, "needs the hooks host");
  localSql(`delete from private.webhook_endpoints where tenant_id = '${tenant}'`);

  // 1. The webhook card appears once a seller key is stored; the secret is write-only.
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan");
  const keys = page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" });
  if (await page.getByTestId("seller-key-status").count() === 0) {
    await keys.getByLabel("Kunci API Mengantar").fill(`mk_e2e_${Date.now()}STATUSTXYZ`);
    await keys.getByRole("checkbox").check();
    await keys.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
    await expect(page.getByTestId("seller-key-status")).toBeVisible();
  }
  const card = page.getByRole("region", { name: "Status pengiriman otomatis (webhook)" });
  await expect(card.getByTestId("webhook-status")).toHaveText("Rahasia webhook belum disimpan.");
  const url = (await card.getByTestId("webhook-url").textContent())!.trim();
  expect(url).toMatch(/\/api\/webhooks\/mengantar\/[A-Za-z0-9_-]{43}$/);
  await card.getByLabel("Rahasia webhook (Webhook Secret)").fill(SECRET);
  await card.getByRole("button", { name: "Simpan rahasia" }).click();
  await expect(card.getByText("Rahasia webhook tersimpan terenkripsi")).toBeVisible();
  await expect(card.getByTestId("webhook-status")).toContainText(`…${SECRET.slice(-4)}`);
  await page.reload();
  expect(await page.content()).not.toContain(SECRET);
  await expectNoHorizontalOverflow(page);

  // 2. Share the tracking link through the UI (the app derives the token); the page starts with no status.
  const s = issuedShipment();
  await page.addInitScript(() => {
    (window as unknown as { __copy: string }).__copy = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { (window as unknown as { __copy: string }).__copy = t; } } });
  });
  await page.goto(`/pengiriman/${s.id}`);
  await page.getByRole("button", { name: "Salin tautan", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copy: string }).__copy)).toMatch(/\/lacak\/[A-Za-z0-9_-]{43}$/);
  const link = await page.evaluate(() => (window as unknown as { __copy: string }).__copy);
  const publicUrl = `${audienceUrl("site", baseURL!) ?? new URL(link).origin}${new URL(link).pathname}`;
  const visitor = await (await page.context().browser()!.newContext()).newPage();
  await visitor.goto(publicUrl);
  await expect(visitor.getByTestId("tracking-status")).toHaveText("Status belum tersedia");

  // 3. Signed deliveries on the hooks host: a forgery is refused, the real one is accepted (twice = idempotent).
  const path = new URL(url).pathname;
  const api = await playwright.request.newContext({ baseURL: hooks! });
  const deliver = async (status: string, opts: { secret?: string; ts?: number } = {}) => {
    const ts = String(opts.ts ?? Date.now());
    const body = JSON.stringify({ cnote_no: s.awb, order_id: s.orderId, courier: "jnt", status_category: status });
    const sig = createHmac("sha256", opts.secret ?? SECRET).update(`${ts}.${body}`).digest("hex");
    return api.post(path, { data: body, headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": sig, "x-environment": "sandbox" } });
  };
  expect((await deliver("DELIVERED", { secret: "forged" })).status()).toBe(401);
  expect((await deliver("ON DELIVERY", { ts: Date.now() - 60_000 })).status()).toBe(204);
  // A true duplicate repeats the exact timestamp and body (the provider's retry), and is stored once.
  const deliveredAt = Date.now();
  expect((await deliver("DELIVERED", { ts: deliveredAt })).status()).toBe(204);
  expect((await deliver("DELIVERED", { ts: deliveredAt })).status()).toBe(204);
  expect(localSql(`select provider_status_kind from public.shipments where id = '${s.id}'`)).toBe("delivered");
  expect(localSql(`select count(*) from public.shipment_events where shipment_id = '${s.id}' and provider_ts is not null`)).toBe("2");
  await api.dispose();

  // 4. The admin sees the forged delivery as a mismatch notice; the public page shows the mapped status only.
  await page.goto("/pengaturan");
  await expect(card.getByTestId("webhook-mismatch")).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByTestId("tracking-status")).toHaveText("Terkirim");
  await expect(visitor.getByTestId("tracking-timeline").getByRole("listitem")).toHaveText([/Terkirim/, /Dalam perjalanan/]);
  expect(await visitor.content()).not.toMatch(/DELIVERED|ON DELIVERY|ORD[A-Z0-9]{10}/);
});
