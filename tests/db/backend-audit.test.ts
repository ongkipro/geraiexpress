import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authService, client, machine, sql } from "./helpers";

describe("backend audit regressions", () => {
  it("initializes a password once even when the same session submits concurrently", async () => {
    const auth = authService();
    const email = `audit-${randomUUID()}@geraiexpress.test`;
    const code = await auth.requestEmailCode({ email, captchaToken: undefined });
    if (code.status !== "sent") throw new Error("fixture code unavailable");
    const signed = await auth.verifyEmailCode({ email, code: code.code, captchaToken: undefined });
    if (!signed.ok) throw new Error("fixture session unavailable");
    const { userId, sessionId } = signed.session;
    const passwords = ["first-audit-password", "second-audit-password"];
    const results = await Promise.all(passwords.map((password) => auth.setPassword({
      userId, sessionId, password, initialOnly: true,
    })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "invalid" }]);
    for (let i = 0; i < passwords.length; i++) {
      const attempt = await auth.signInWithPassword({ email, password: passwords[i], captchaToken: undefined });
      expect(attempt.ok).toBe(results[i].ok);
    }
    expect(await auth.setPassword({ userId, sessionId, password: "third-audit-password", initialOnly: true }))
      .toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps initialization machine-only and refuses a missing kept session", async () => {
    const args = { p_user: randomUUID(), p_hash: "invalid", p_keep_session: null };
    expect((await client().rpc("auth_initialize_password", args)).error).not.toBeNull();
    expect((await machine().rpc("auth_initialize_password", args)).data).toEqual({ status: "invalid" });
  });

  it("removes obsolete hook/sequence access and does not grant it to new sequences", () => {
    expect(sql("select has_schema_privilege('supabase_auth_admin', 'private', 'USAGE')")).toBe("f");
    expect(sql(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE'))`)).toBe("0");
    expect(sql(`begin; create sequence public.audit_sequence_probe;
      select has_sequence_privilege('anon', 'public.audit_sequence_probe', 'USAGE')
        or has_sequence_privilege('authenticated', 'public.audit_sequence_probe', 'UPDATE'); rollback;`))
      .toContain("f");
  });
});
