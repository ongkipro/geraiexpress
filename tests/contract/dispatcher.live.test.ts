import { describe, expect, it } from "vitest";
import { dispatchOperation, payUnpaidShipmentBatch, reconcileOperation } from "../../src/lib/mengantar/dispatcher";
import { machine, realOperation, signIn, sql } from "../db/helpers";

// TD-3 / DEC-010 end to end against the local database and the Mengantar SANDBOX: the real
// dispatcher claims an operation, sends one order with the Partner-registered sandbox seller's
// key, records the result; then a lost answer is reconciled by reference, and an attempt that was
// never sent is concluded "not created". It creates one sandbox order per run, so it only runs
// when asked:
//   MENGANTAR_CONTRACT_DISPATCH=1 MENGANTAR_CONTRACT_SELLER_KEY_VAR=GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY \
//   secrets-env run -- pnpm exec vitest run tests/contract/dispatcher.live.test.ts
const keyVar = process.env.MENGANTAR_CONTRACT_SELLER_KEY_VAR ?? "";
if (keyVar && !keyVar.startsWith("GERAIEXPRESS_MENGANTAR_SANDBOX_")) throw new Error("MENGANTAR_CONTRACT_SELLER_KEY_VAR must name a GERAIEXPRESS_MENGANTAR_SANDBOX_* variable");
const sellerKey = keyVar ? process.env[keyVar] : undefined;
const run = process.env.MENGANTAR_CONTRACT_DISPATCH === "1" && !!sellerKey;

describe.skipIf(!run)("dispatcher against the Mengantar sandbox (writes one sandbox order)", () => {
  const sealKey = Buffer.alloc(32, 11).toString("base64");
  const deps = () => {
    const m = machine();
    return { rpc: (fn: string, args: Record<string, unknown>) => m.rpc(fn, args), environment: "sandbox" as const, credentialKey: sealKey };
  };
  const state = (op: string) => sql(`select o.state || '|' || coalesce(o.result_code, '-') || '|' || coalesce(o.provider_order_id, '-') || '|' || s.submission_state || '|' || s.payment_state || '|' || coalesce(s.awb, '-')
    from public.provider_operations o join public.shipments s on s.id = o.shipment_id where o.id = '${op}'`);

  it("dispatches one order, then reconciles a lost answer to the same provider order", async () => {
    const f = await realOperation({ sellerKey, sealKey });
    const sent = await dispatchOperation(f.op, deps());
    expect(sent.status).toBe("recorded");
    const after = state(f.op).split("|");
    // The sandbox seller has no balance: a non-COD order is created unpaid (issued if topped up).
    expect(["UNPAID", "ISSUED"]).toContain(after[1]);
    const orderId = after[2];
    expect(orderId).toMatch(/^[A-Z0-9]{6,20}$/);
    console.log("dispatched", sent, after.join("|"));

    // Simulate a lost answer: the operation is unknown again and the order id was never stored.
    sql(`update public.provider_operations set state = 'unknown', result_code = 'UNKNOWN_OUTCOME', provider_order_id = null,
      provider_batch = null, dispatched_at = now() - interval '6 minutes' where id = '${f.op}';
      update public.shipments set submission_state = 'unknown', payment_state = 'not_applicable', awb = null where id = '${f.shipment}'`);
    const reconciled = await reconcileOperation(f.op, deps());
    expect(reconciled).toEqual({ status: "recorded", outcome: after[1] === "ISSUED" ? "issued" : "unpaid" });
    expect(state(f.op).split("|").slice(1, 3)).toEqual(["RECONCILED", orderId]);
    console.log("reconciled", reconciled, state(f.op));
  });

  it("concludes 'not created' for an attempt that never reached Mengantar", async () => {
    const f = await realOperation({ sellerKey, sealKey });
    sql(`update public.provider_operations set state = 'unknown', attempts = 1, provider_env = 'sandbox', credential_version = 1,
      dispatched_at = now() - interval '6 minutes' where id = '${f.op}';
      update public.shipments set submission_state = 'unknown' where id = '${f.shipment}'`);
    expect(await reconcileOperation(f.op, deps())).toEqual({ status: "recorded", outcome: "not_created" });
    expect(state(f.op)).toBe("failed|NOT_CREATED|-|failed|not_applicable|-");
  });
});

// T-033 supervised sandbox payment. NOT RUN in the T-033 change: it spends the sandbox seller's
// wallet balance, so it needs the owner's explicit approval and a sandbox balance that covers one
// order. Skipped unless both are given:
//   MENGANTAR_CONTRACT_PAY_UNPAID=1 MENGANTAR_CONTRACT_SELLER_KEY_VAR=GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY \
//   secrets-env run -- pnpm exec vitest run tests/contract/dispatcher.live.test.ts -t "pay-unpaid"
// It records the real answers the research note still lacks (research §7.1): the accepted `batch_id`,
// the shape of `data` and `cnote_no`, and the refusal text for an insufficient balance.
const runPay = process.env.MENGANTAR_CONTRACT_PAY_UNPAID === "1" && !!sellerKey;
describe.skipIf(!runPay)("pay-unpaid against the Mengantar sandbox (OWNER-APPROVED; spends sandbox balance)", () => {
  const sealKey = Buffer.alloc(32, 11).toString("base64");
  const deps = () => {
    const m = machine();
    return { rpc: (fn: string, args: Record<string, unknown>) => m.rpc(fn, args), environment: "sandbox" as const, credentialKey: sealKey };
  };

  it("creates one unpaid order, authorizes and pays its batch with the batch object id, and reconciles by reads", async () => {
    const f = await realOperation({ sellerKey, sealKey });
    const created = await dispatchOperation(f.op, deps());
    expect(created.status).toBe("recorded");
    const row = sql(`select result_code || '|' || provider_batch || '|' || coalesce(provider_batch_id, '-') from public.provider_operations where id = '${f.op}'`).split("|");
    // A funded sandbox seller would have the order issued at creation: then there is nothing to pay.
    expect(row[0], "needs an UNPAID order: empty the sandbox balance first").toBe("UNPAID");
    expect(row[2]).toMatch(/^[a-f0-9]{24}$/);
    expect(row[2]).not.toBe(row[1]);

    sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '00000000-0000-4000-a000-0000000000a1', 'tenant_admin')`);
    const owner = await signIn("owner-a@geraiexpress.test");
    const review = await owner.rpc("review_unpaid_batch", { p_shipment: f.shipment });
    expect(review.error).toBeNull();
    expect((await owner.rpc("authorize_batch_payment", { p_shipment: f.shipment, p_batch_digest: review.data.batch_digest })).data).toMatchObject({ authorized: true });

    const paid = await payUnpaidShipmentBatch(f.shipment, review.data.batch_digest, deps());
    console.log("pay-unpaid", paid, sql(`select state from private.batch_payment_attempts where tenant_id = '${f.tenant}'`));
    // Whatever the provider answered, the batch is never paid twice: a second claim only reconciles.
    expect(["recorded", "inconclusive", "not_reconcilable"]).toContain(paid.status);
  });
});
