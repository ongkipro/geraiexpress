import { describe, expect, it } from "vitest";
import { dispatchOperation, reconcileOperation } from "../../src/lib/mengantar/dispatcher";
import { machine, realOperation, sql } from "../db/helpers";

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
