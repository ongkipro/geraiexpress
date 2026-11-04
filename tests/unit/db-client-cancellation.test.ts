import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machine } from "../db/helpers";

// This is a client transport contract, not proof of server transaction cancellation.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configureClient() {
  vi.stubEnv("POSTGREST_URL", "http://test.invalid");
  vi.stubEnv("AUTH_JWT_SECRET", "test-only-cancellation-signing-key");
}

describe("DB test client cancellation", () => {
  it("does not dispatch with an aborted owner or per-request signal", async () => {
    configureClient();
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", transport);
    const stopped = new AbortController();
    stopped.abort();
    await expect(machine(stopped.signal).rpc("registration_open").throwOnError()).rejects.toBeDefined();
    const active = new AbortController();
    await expect(machine(active.signal).rpc("registration_open").abortSignal(stopped.signal).throwOnError()).rejects.toBeDefined();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an abort-ignoring late response and suppresses subsequent dispatch", async () => {
    configureClient();
    let release!: () => void;
    let entered!: () => void;
    let deliveredSignal: AbortSignal | null | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const dispatched = new Promise<void>((resolve) => { entered = resolve; });
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      deliveredSignal = init?.signal;
      entered();
      await blocked;
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    const owner = new AbortController();
    const client = machine(owner.signal);
    // Attach rejection handling before cancellation; PostgREST builders are lazy thenables.
    const pending = Promise.resolve(client.rpc("registration_open").throwOnError());
    const rejected = expect(pending).rejects.toBeDefined();
    try {
      await dispatched;
      expect(deliveredSignal?.aborted).toBe(false);
      owner.abort();
      expect(deliveredSignal?.aborted).toBe(true);
    } finally {
      release();
    }
    await rejected;
    await expect(client.rpc("registration_open").throwOnError()).rejects.toBeDefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("DB owner init preflight", () => {
  it.each(["postgres", "docker-init", "", null])("checks PID 1 (%s) before admitting fixture work", (comm) => {
    const source = readFileSync(new URL("../db/batch-payment-fixes.test.ts", import.meta.url), "utf8");
    const prefix = source.match(/const GATED_SQL = `([\s\S]*?)\n  dir=\$1;/)?.[1];
    expect(prefix).toBeDefined();
    // Execute the actual shell preflight, substituting only its proc-file input.
    const dir = mkdtempSync(join(tmpdir(), "gx-init-preflight-"));
    try {
      const file = join(dir, "comm");
      if (comm !== null) writeFileSync(file, `${comm}\n`);
      const script = prefix!.replace("/proc/1/comm", '"$1"') + '\nprintf admitted';
      const result = spawnSync("sh", ["-c", script, "init-preflight-test", file], { encoding: "utf8", timeout: 2000 });
      const allowed = comm === "docker-init";
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(allowed ? 0 : 126);
      expect(result.stdout).toBe(allowed ? "admitted" : "");
      if (!allowed) expect(result.stderr).toContain("recreate the test container with init: true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
