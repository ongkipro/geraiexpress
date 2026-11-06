import { describe, expect, it } from "vitest";
import { openCredential, sealCredential, serializeKeyRing, webhookSecretAad } from "../../src/lib/credential-crypto";
import { beforeEach } from "vitest";
import { resetWebhookRewrapCursors, rewrapWebhookSecrets } from "../../src/lib/credential-keyring";

// T-045 review P1: Webhook Secrets follow the key-ring rotation; retiring the old key must not break webhooks.
const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const OLD = serializeKeyRing({ current: "v1", keys: { v1: K1 } });
const NEW = serializeKeyRing({ current: "v2", keys: { v1: K1, v2: K2 } });
const T = "00000000-0000-4000-b000-00000000000a";

describe("webhook secret rewrap (T-045)", () => {
  beforeEach(() => resetWebhookRewrapCursors());
  it("re-seals an old-key secret under the current key with the same AAD, then opens without the retired key", async () => {
    const aad = webhookSecretAad(T, "sandbox", 3);
    const old = await sealCredential("whsec-rotate-me-0001", aad, OLD);
    let stored = { tenant_id: T, ciphertext: old.ciphertext, iv: old.iv, key_version: old.keyVersion, secret_version: 3 };
    const writes: Record<string, unknown>[] = [];
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      if (fn === "machine_webhook_rewrap_candidates") return { data: stored.key_version === "v1" ? [stored] : [], error: null };
      if (fn === "rewrap_webhook_secret") {
        writes.push(args);
        if (args.p_expected_key_version !== stored.key_version) return { data: false, error: null };
        stored = { ...stored, ciphertext: args.p_ciphertext as string, iv: args.p_iv as string, key_version: args.p_new_key_version as string };
        return { data: true, error: null };
      }
      return { data: null, error: { message: "unexpected" } };
    };
    expect(await rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox" })).toEqual({ scanned: 1, rewrapped: 1, conflicts: 0, failed: 0, pending: false });
    expect(writes[0]).toMatchObject({ p_tenant: T, p_env: "sandbox", p_secret_version: 3, p_expected_key_version: "v1", p_new_key_version: "v2" });
    const retired = serializeKeyRing({ current: "v2", keys: { v2: K2 } });
    expect(await openCredential(stored, aad, retired)).toBe("whsec-rotate-me-0001");
    // A second run finds nothing left.
    expect(await rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox" })).toMatchObject({ scanned: 0, rewrapped: 0 });
  });

  it("counts a fenced write as a conflict and an unreadable row as failed, never throwing for one row", async () => {
    const good = await sealCredential("whsec-a-000000000001", webhookSecretAad(T, "sandbox", 1), OLD);
    const rows = [
      { tenant_id: T, ciphertext: good.ciphertext, iv: good.iv, key_version: "v1", secret_version: 1 },
      { tenant_id: T, ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA", iv: "AAAAAAAAAAAAAAAA", key_version: "v1", secret_version: 2 },
    ];
    const rpc = async (fn: string) => fn === "machine_webhook_rewrap_candidates" ? { data: rows, error: null } : { data: false, error: null };
    expect(await rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox" })).toEqual({ scanned: 2, rewrapped: 0, conflicts: 1, failed: 1, pending: false });
  });

  it("throws on a failed candidate read (a partial list must not look like a finished run)", async () => {
    const rpc = async () => ({ data: null, error: { message: "down" } });
    await expect(rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox" })).rejects.toThrow("webhook_list_failed");
  });

  it("a full page of failing rows cannot starve a readable endpoint behind it (review round 2)", async () => {
    const tenant = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
    const bad = Array.from({ length: 2 }, (_, i) => ({ tenant_id: tenant(i + 1), ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA", iv: "AAAAAAAAAAAAAAAA", key_version: "v1", secret_version: 1 }));
    const okAad = webhookSecretAad(tenant(3), "sandbox", 1);
    const ok = await sealCredential("whsec-behind-the-bad-01", okAad, OLD);
    const all = [...bad, { tenant_id: tenant(3), ciphertext: ok.ciphertext, iv: ok.iv, key_version: "v1", secret_version: 1 }];
    const rewrapped: string[] = [];
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      if (fn === "machine_webhook_rewrap_candidates") {
        const after = args.p_after as string | null;
        return { data: all.filter((r) => after === null || r.tenant_id > after).slice(0, args.p_limit as number), error: null };
      }
      rewrapped.push(args.p_tenant as string);
      return { data: true, error: null };
    };
    expect(await rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox", batchSize: 2 })).toMatchObject({ scanned: 2, failed: 2, pending: true });
    expect(await rewrapWebhookSecrets({ rpc, key: NEW, environment: "sandbox", batchSize: 2 })).toMatchObject({ scanned: 1, rewrapped: 1, pending: false });
    expect(rewrapped).toEqual([tenant(3)]);
  });
});
