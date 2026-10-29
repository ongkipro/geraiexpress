// ADR-0002 section 4 / T-065: SQL-level tests of the owned auth core (migration 20261029100000_auth_core):
// machine-only privileges, emailed one-time codes, sessions and refresh rotation, passwords, the
// anonymous demo lock, TOTP replay protection and housekeeping. Hashes are plain sha256 hex strings:
// the TypeScript module is tested on its own in tests/unit.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, authService, client, machine, signIn, sql } from "./helpers";

type Identity = {
  status: string;
  user_id: string;
  email: string | null;
  is_anonymous: boolean;
  has_password: boolean;
  session_id: string;
  aal: "aal1" | "aal2";
  aal2_at: string | null;
  absolute_expires_at: string;
};
type Reply = Partial<Identity> & { status: string; message?: string; factor_id?: string; live?: boolean };

const m = machine();
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const SCRYPT = `scrypt$32768$8$1$${"A".repeat(22)}$${"B".repeat(86)}`;
const PREFIX = "authcore-";
const email = (tag = "u") => `${PREFIX}${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@geraiexpress.test`;
const SEED_KNOWN = "no-access@geraiexpress.test";
const SEED_ADMIN = "admin@geraiexpress.test";

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Reply> {
  const { data, error } = await m.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as Reply;
}

function sqlError(statement: string): string {
  try {
    sql(statement);
    return "";
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return err.stderr || err.message;
  }
}

const createdUsers: string[] = [];
const createdSessions: string[] = [];
const seedEmailsUsed = new Set<string>();

function newUser(o: { confirmed?: boolean; password?: boolean; anonymous?: boolean; banned?: boolean; deleted?: boolean; tag?: string } = {}) {
  const id = randomUUID();
  const addr = email(o.tag);
  const { confirmed = true, password = false, anonymous = false, banned = false, deleted = false } = o;
  sql(
    `insert into auth.users (id, email, email_confirmed_at, encrypted_password, is_anonymous, banned_until, deleted_at, raw_app_meta_data) values ` +
      `('${id}', '${addr}', ${confirmed ? "now()" : "null"}, '${password ? SCRYPT : ""}', ${anonymous}, ${banned ? "now() + interval '1 day'" : "null"}, ${deleted ? "now()" : "null"}, ` +
      `'{"provider":"email","providers":["email"]}')`,
  );
  createdUsers.push(id);
  return { id, email: addr };
}

async function openSession(userId: string, extra: Record<string, unknown> = {}) {
  const refresh = hex();
  const r = (await rpc("auth_create_session", { p_user: userId, p_refresh_hash: refresh, ...extra })) as Identity;
  expect(r.status).toBe("ok");
  createdSessions.push(r.session_id);
  return { id: r.session_id, refresh, identity: r };
}

async function anonymousSession() {
  const refresh = hex();
  const r = (await rpc("auth_sign_in_anonymous", { p_refresh_hash: refresh })) as Identity;
  expect(r.status).toBe("ok");
  createdUsers.push(r.user_id);
  return { id: r.session_id, user: r.user_id, refresh, identity: r };
}

const live = async (session: string) => (await rpc("auth_session_live", { p_session: session })).live;
const sessionRow = (id: string) =>
  JSON.parse(sql(`select row_to_json(s) from auth.sessions s where s.id = '${id}'`)) as {
    aal: string;
    aal2_at: string | null;
    refresh_hash: string;
    previous_refresh_hash: string | null;
    revoked_at: string | null;
  };
const retired = (id: string) => JSON.parse(sql(`select coalesce(json_agg(hash order by retired_at, hash), '[]') from auth.retired_refresh_tokens where session_id = '${id}'`)) as string[];
const count = (table: string, where: string) => Number(sql(`select count(*) from ${table} where ${where}`));
const secondsAhead = (id: string) => Number(sql(`select extract(epoch from absolute_expires_at - now()) from auth.sessions where id = '${id}'`));

const issue = (addr: string, hash: string, extra: Record<string, unknown> = {}) => rpc("auth_issue_otp", { p_email: addr, p_code_hash: hash, ...extra });
const verify = (addr: string, code: string, refresh = hex(), extra: Record<string, unknown> = {}) =>
  rpc("auth_verify_otp", { p_email: addr, p_code_hash: code, p_refresh_hash: refresh, ...extra });
const backdateCodes = (addr: string, seconds: number) =>
  sql(`update auth.otp_codes set created_at = created_at - interval '${seconds} seconds' where email = '${addr}'`);

let previousRegistration = "false";
const setRegistration = (open: boolean) => sql(`update private.settings set value = '${open}' where key = 'registration_open'`);

beforeAll(() => {
  previousRegistration = sql(`select value::text from private.settings where key = 'registration_open'`) || "false";
  setRegistration(false);
});

afterAll(() => {
  sql(`update private.settings set value = '${previousRegistration}' where key = 'registration_open'`);
  const seedList = [...seedEmailsUsed].map((e) => `'${e}'`).join(", ") || "''";
  sql(`delete from auth.otp_codes where email like '${PREFIX}%@geraiexpress.test' or email in (${seedList})`);
  if (createdSessions.length) sql(`delete from auth.sessions where id in (${createdSessions.map((s) => `'${s}'`).join(", ")})`);
  if (createdUsers.length) {
    sql(`delete from auth.users where id in (${createdUsers.map((u) => `'${u}'`).join(", ")}) or email like '${PREFIX}%@geraiexpress.test'`);
  }
});

const FUNCTIONS: [string, Record<string, unknown>][] = [
  ["auth_issue_otp", { p_email: "not-an-email", p_code_hash: hex() }],
  ["auth_verify_otp", { p_email: "nobody@geraiexpress.test", p_code_hash: hex(), p_refresh_hash: hex() }],
  ["auth_password_credential", { p_email: "nobody@geraiexpress.test" }],
  ["auth_create_session", { p_user: randomUUID(), p_refresh_hash: hex() }],
  ["auth_sign_in_anonymous", { p_refresh_hash: "not-a-hash" }],
  ["auth_refresh_session", { p_refresh_hash: hex(), p_new_refresh_hash: hex() }],
  ["auth_session_live", { p_session: randomUUID() }],
  ["auth_revoke_session", { p_session: randomUUID() }],
  ["auth_set_password", { p_user: randomUUID(), p_hash: "not-a-hash" }],
  ["auth_revoke_user_sessions", { p_user: randomUUID() }],
  ["auth_mfa_enroll", { p_user: randomUUID(), p_secret_sealed: "" }],
  ["auth_mfa_factor", { p_user: randomUUID() }],
  ["auth_mfa_verify", { p_user: randomUUID(), p_factor: randomUUID(), p_session: randomUUID(), p_step: 1, p_new_refresh_hash: hex() }],
  ["auth_purge_expired", {}],
];

describe("privileges (obligation 1)", () => {
  it("anon is refused every auth_* function", async () => {
    const anon = client();
    for (const [fn, args] of FUNCTIONS) {
      const res = await anon.rpc(fn, args);
      expect(res.error, fn).not.toBeNull();
      expect([401, 403, 404], `${fn} status ${res.status}`).toContain(res.status);
    }
  });

  it("an authenticated user is refused every auth_* function", async () => {
    const user = await signIn("owner-a@geraiexpress.test");
    for (const [fn, args] of FUNCTIONS) {
      const res = await user.rpc(fn, args);
      expect(res.error, fn).not.toBeNull();
      expect([401, 403, 404], `${fn} status ${res.status}`).toContain(res.status);
    }
  });

  it("service_role may call every auth_* function", async () => {
    for (const [fn, args] of FUNCTIONS) {
      const res = await m.rpc(fn, args);
      expect(res.error, fn).toBeNull();
    }
  });

  it("the auth schema is unreachable through the Data API, even for service_role", async () => {
    for (const table of ["sessions", "otp_codes", "users", "mfa_factors"]) {
      expect((await m.from(table).select("*")).error, `public.${table}`).not.toBeNull();
      expect((await m.schema("auth" as never).from(table).select("*")).error, `auth.${table}`).not.toBeNull();
    }
    expect((await m.schema("auth" as never).rpc("uid")).error).not.toBeNull();
  });

  it("no API role holds a table privilege on the auth tables", () => {
    for (const role of ["anon", "authenticated", "service_role", "authenticator"]) {
      for (const table of ["sessions", "otp_codes", "users", "mfa_factors"]) {
        for (const priv of ["select", "insert", "update", "delete"]) {
          expect(sql(`select has_table_privilege('${role}', 'auth.${table}', '${priv}')`), `${role} ${priv} auth.${table}`).toBe("f");
        }
      }
    }
  });
});

describe("emailed one-time codes: issue", () => {
  it("closed registration blocks an unknown email, serves a known one", async () => {
    setRegistration(false);
    const unknown = email("unknown");
    const blocked = await issue(unknown, hex());
    expect(blocked.status).toBe("blocked");
    expect(blocked.message).toBeTruthy();
    expect(count("auth.otp_codes", `email = '${unknown}'`)).toBe(0);

    seedEmailsUsed.add(SEED_KNOWN);
    sql(`delete from auth.otp_codes where email = '${SEED_KNOWN}'`);
    try {
      expect((await issue(SEED_KNOWN, hex())).status).toBe("sent");
    } finally {
      sql(`delete from auth.otp_codes where email = '${SEED_KNOWN}'`);
    }
  });

  it("open registration serves an unknown email, creates no user row, and normalizes the address", async () => {
    setRegistration(true);
    try {
      const addr = email("open");
      const res = await issue(`  ${addr.toUpperCase().replace("@GERAIEXPRESS.TEST", "@geraiexpress.test")} `, hex());
      expect(res.status).toBe("sent");
      expect(count("auth.users", `lower(email) = '${addr}'`)).toBe(0);
      expect(count("auth.otp_codes", `email = '${addr}' and consumed_at is null`)).toBe(1);
    } finally {
      setRegistration(false);
    }
  });

  it("a pending invitation lets an unknown email in while registration is closed", async () => {
    setRegistration(false);
    const addr = email("invited");
    const inv = randomUUID();
    sql(`insert into public.tenant_invitations (id, tenant_id, email, role) values ('${inv}', '${IDS.tenantA}', '${addr}', 'operator')`);
    try {
      expect((await issue(addr, hex())).status).toBe("sent");
      // Another address without an invitation stays blocked.
      expect((await issue(email("not-invited"), hex())).status).toBe("blocked");
    } finally {
      sql(`delete from public.tenant_invitations where id = '${inv}'`);
    }
  });

  it("rejects a malformed address or hash", async () => {
    expect((await issue("not-an-email", hex())).status).toBe("invalid");
    expect((await issue("", hex())).status).toBe("invalid");
    expect((await issue(email("badhash"), "xyz")).status).toBe("invalid");
    expect((await issue(email("badhash"), hex().toUpperCase())).status).toBe("invalid");
    expect((await issue(email("badhash"), hex().slice(1))).status).toBe("invalid");
  });

  it("an anonymous requester, a banned user and a deleted user are refused and nothing is stored", async () => {
    const anon = await anonymousSession();
    const some = newUser({ tag: "req" });
    expect((await issue(some.email, hex(), { p_requester: anon.user })).status).toBe("refused");
    expect(count("auth.otp_codes", `email = '${some.email}'`)).toBe(0);

    const banned = newUser({ banned: true, tag: "ban" });
    expect((await issue(banned.email, hex())).status).toBe("refused");
    expect(count("auth.otp_codes", `email = '${banned.email}'`)).toBe(0);

    const deleted = newUser({ deleted: true, tag: "del" });
    setRegistration(false);
    // A deleted identity is treated as absent: the gate decides, and it is closed.
    expect((await issue(deleted.email, hex())).status).toBe("blocked");
  });

  it("a second request within 30 seconds is too_soon; a later one supersedes the old code", async () => {
    const user = newUser({ tag: "soon" });
    const first = hex();
    const second = hex();
    expect((await issue(user.email, first)).status).toBe("sent");
    expect((await issue(user.email, second)).status).toBe("too_soon");
    expect(count("auth.otp_codes", `email = '${user.email}'`)).toBe(1);

    backdateCodes(user.email, 40);
    expect((await issue(user.email, second)).status).toBe("sent");
    expect(count("auth.otp_codes", `email = '${user.email}' and consumed_at is null`)).toBe(1);
    expect(count("auth.otp_codes", `email = '${user.email}'`)).toBe(2);
    // The old code no longer verifies; the new one does.
    expect((await verify(user.email, first)).status).toBe("invalid");
    expect((await verify(user.email, second)).status).toBe("ok");
  });

  it("20 wrong guesses over an hour throttle further codes for that email", async () => {
    const user = newUser({ tag: "throttle" });
    for (let round = 0; round < 4; round++) {
      expect((await issue(user.email, hex())).status, `round ${round}`).toBe("sent");
      for (let guess = 0; guess < 5; guess++) expect((await verify(user.email, hex())).status).toBe("invalid");
      backdateCodes(user.email, 40);
    }
    expect(Number(sql(`select sum(attempts) from auth.otp_codes where email = '${user.email}'`))).toBe(20);
    expect((await issue(user.email, hex())).status).toBe("throttled");
    expect(count("auth.otp_codes", `email = '${user.email}' and consumed_at is null`)).toBe(0);
    // The budget is per hour: once those codes are older than an hour it clears.
    sql(`update auth.otp_codes set created_at = created_at - interval '2 hours' where email = '${user.email}'`);
    expect((await issue(user.email, hex())).status).toBe("sent");
  }, 60000);
});

describe("emailed one-time codes: verify", () => {
  it("the right code creates a confirmed user and an aal1 session; the same code is single use", async () => {
    setRegistration(true);
    try {
      const addr = email("signup");
      const code = hex();
      const refresh = hex();
      expect((await issue(addr, code)).status).toBe("sent");
      const res = (await verify(addr, code, refresh)) as Identity;
      expect(res.status).toBe("ok");
      expect(res.email).toBe(addr);
      expect(res.is_anonymous).toBe(false);
      expect(res.has_password).toBe(false);
      expect(res.aal).toBe("aal1");
      expect(res.aal2_at).toBeNull();
      expect(sql(`select (email_confirmed_at is not null) || '|' || is_anonymous || '|' || (last_sign_in_at is not null) from auth.users where id = '${res.user_id}'`)).toBe("true|false|true");
      expect(sessionRow(res.session_id)).toMatchObject({ aal: "aal1", refresh_hash: refresh, revoked_at: null });
      expect(await live(res.session_id)).toBe(true);
      // Single use: replaying the code opens nothing, even with registration still open.
      expect((await verify(addr, code)).status).toBe("invalid");
      expect(count("auth.sessions", `user_id = '${res.user_id}'`)).toBe(1);
    } finally {
      setRegistration(false);
    }
  });

  it("a known user signs in by code without a new account", async () => {
    const user = newUser({ tag: "known" });
    const code = hex();
    expect((await issue(user.email, code)).status).toBe("sent");
    const res = (await verify(user.email.toUpperCase().replace("@GERAIEXPRESS.TEST", "@geraiexpress.test"), code)) as Identity;
    expect(res.status).toBe("ok");
    expect(res.user_id).toBe(user.id);
    expect(count("auth.users", `lower(email) = '${user.email}'`)).toBe(1);
  });

  it("an unknown email, wrong code, or malformed hashes all answer invalid", async () => {
    const user = newUser({ tag: "wrong" });
    expect((await verify(email("never-issued"), hex())).status).toBe("invalid");
    expect((await issue(user.email, hex())).status).toBe("sent");
    expect((await verify(user.email, hex())).status).toBe("invalid");
    expect((await verify(user.email, "nope")).status).toBe("invalid");
    expect((await rpc("auth_verify_otp", { p_email: user.email, p_code_hash: hex(), p_refresh_hash: "nope" })).status).toBe("invalid");
  });

  it("5 wrong guesses kill the code, even for the right hash afterwards", async () => {
    const user = newUser({ tag: "brute" });
    const code = hex();
    expect((await issue(user.email, code)).status).toBe("sent");
    for (let i = 0; i < 5; i++) expect((await verify(user.email, hex())).status).toBe("invalid");
    expect(sql(`select attempts || '|' || (consumed_at is not null) from auth.otp_codes where email = '${user.email}'`)).toBe("5|true");
    expect((await verify(user.email, code)).status).toBe("invalid");
    expect(count("auth.sessions", `user_id = '${user.id}'`)).toBe(0);
  });

  it("4 wrong guesses leave the code usable", async () => {
    const user = newUser({ tag: "four" });
    const code = hex();
    await issue(user.email, code);
    for (let i = 0; i < 4; i++) await verify(user.email, hex());
    expect((await verify(user.email, code)).status).toBe("ok");
  });

  it("an expired code is invalid", async () => {
    const user = newUser({ tag: "expired" });
    const code = hex();
    expect((await issue(user.email, code)).status).toBe("sent");
    sql(`update auth.otp_codes set expires_at = now() - interval '1 second' where email = '${user.email}'`);
    expect((await verify(user.email, code)).status).toBe("invalid");
    expect(count("auth.sessions", `user_id = '${user.id}'`)).toBe(0);
  });

  it("a banned user's outstanding code no longer opens a session", async () => {
    const user = newUser({ tag: "banned-after" });
    const code = hex();
    expect((await issue(user.email, code)).status).toBe("sent");
    sql(`update auth.users set banned_until = now() + interval '1 day' where id = '${user.id}'`);
    expect((await verify(user.email, code)).status).toBe("invalid");
    expect(count("auth.sessions", `user_id = '${user.id}'`)).toBe(0);
  });

  it("closing registration between issue and verify blocks a new email and creates no user", async () => {
    setRegistration(true);
    const addr = email("race");
    const code = hex();
    try {
      expect((await issue(addr, code)).status).toBe("sent");
      setRegistration(false);
      expect((await verify(addr, code)).status).toBe("invalid");
      expect(count("auth.users", `lower(email) = '${addr}'`)).toBe(0);
    } finally {
      setRegistration(false);
    }
  });
});

describe("sessions", () => {
  it("auth_sign_in_anonymous creates a fresh anonymous user with an aal1 session", async () => {
    const s = await anonymousSession();
    expect(s.identity).toMatchObject({ is_anonymous: true, email: null, has_password: false, aal: "aal1", aal2_at: null });
    expect(sql(`select is_anonymous || '|' || coalesce(email, '-') from auth.users where id = '${s.user}'`)).toBe("true|-");
    expect(secondsAhead(s.id)).toBeLessThanOrEqual(7 * 86400);
    expect(await live(s.id)).toBe(true);
  });

  it("auth_create_session opens a session for a confirmed user and refuses unusable identities", async () => {
    const user = newUser({ tag: "create" });
    const s = await openSession(user.id);
    expect(s.identity).toMatchObject({ user_id: user.id, email: user.email, aal: "aal1" });
    expect(sql(`select last_sign_in_at is not null from auth.users where id = '${user.id}'`)).toBe("t");

    const anon = await anonymousSession();
    const refused = [
      randomUUID(),
      anon.user,
      newUser({ confirmed: false, tag: "unconf" }).id,
      newUser({ banned: true, tag: "ban" }).id,
      newUser({ deleted: true, tag: "del" }).id,
    ];
    for (const id of refused) {
      expect((await rpc("auth_create_session", { p_user: id, p_refresh_hash: hex() })).status, id).toBe("invalid");
    }
    expect((await rpc("auth_create_session", { p_user: user.id, p_refresh_hash: "short" })).status).toBe("invalid");
  });

  it("refresh rotates; the old hash is accepted without rotation for 10 s, then reuse revokes the session", async () => {
    const user = newUser({ tag: "rotate" });
    const s = await openSession(user.id);
    const r1 = hex();
    const rotated = await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: r1 });
    expect(rotated).toMatchObject({ status: "ok", session_id: s.id, user_id: user.id });
    expect(sessionRow(s.id)).toMatchObject({ refresh_hash: r1, previous_refresh_hash: s.refresh });

    // Within 10 s the previous hash answers the same identity without touching the session.
    const again = await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: hex() });
    expect(again).toMatchObject({ status: "recent_reuse", session_id: s.id, user_id: user.id });
    expect(sessionRow(s.id)).toMatchObject({ refresh_hash: r1, previous_refresh_hash: s.refresh, revoked_at: null });

    // The new hash keeps working and rotates again.
    const r2 = hex();
    expect((await rpc("auth_refresh_session", { p_refresh_hash: r1, p_new_refresh_hash: r2 })).status).toBe("ok");
    expect(sessionRow(s.id)).toMatchObject({ refresh_hash: r2, previous_refresh_hash: r1 });
    expect(await live(s.id)).toBe(true);

    // Older reuse: the previous hash r1 after 11 s -> reuse_detected and the whole session dies.
    sql(`update auth.sessions set refresh_rotated_at = now() - interval '11 seconds' where id = '${s.id}'`);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: r1, p_new_refresh_hash: hex() })).status).toBe("reuse_detected");
    expect(sessionRow(s.id).revoked_at).not.toBeNull();
    expect((await rpc("auth_refresh_session", { p_refresh_hash: r2, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_refresh_session", { p_refresh_hash: r1, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect(await live(s.id)).toBe(false);
  });

  it("retires every rotated refresh hash (never evicted while the session lives) so presenting a token two or more generations old triggers reuse_detected and revokes the session", async () => {
    const user = newUser({ tag: "retired-reuse" });

    // Double rotation H0 -> H1 -> H2, then presenting H0 immediately revokes the session.
    const s1 = await openSession(user.id);
    const h0 = s1.refresh;
    const h1 = hex();
    const h2 = hex();
    expect((await rpc("auth_refresh_session", { p_refresh_hash: h0, p_new_refresh_hash: h1 })).status).toBe("ok");
    expect((await rpc("auth_refresh_session", { p_refresh_hash: h1, p_new_refresh_hash: h2 })).status).toBe("ok");
    expect(retired(s1.id)).toEqual([h0, h1]);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: h0, p_new_refresh_hash: hex() })).status).toBe("reuse_detected");
    expect(sessionRow(s1.id).revoked_at).not.toBeNull();
    expect(await live(s1.id)).toBe(false);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: h2, p_new_refresh_hash: hex() })).status).toBe("invalid");

    // A token two generations old after 11 s likewise triggers reuse_detected and revokes the session.
    const s2 = await openSession(user.id);
    const g0 = s2.refresh;
    const g1 = hex();
    const g2 = hex();
    expect((await rpc("auth_refresh_session", { p_refresh_hash: g0, p_new_refresh_hash: g1 })).status).toBe("ok");
    expect((await rpc("auth_refresh_session", { p_refresh_hash: g1, p_new_refresh_hash: g2 })).status).toBe("ok");
    sql(`update auth.sessions set refresh_rotated_at = now() - interval '11 seconds' where id = '${s2.id}'`);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: g0, p_new_refresh_hash: hex() })).status).toBe("reuse_detected");
    expect(sessionRow(s2.id).revoked_at).not.toBeNull();
    expect(await live(s2.id)).toBe(false);

    // Sixty rotations keep all sixty hashes: the OLDEST retired token still triggers detection (a count cap
    // would let a long-stolen token fall out of the history, security review second pass).
    const long = await openSession(user.id);
    sql(
      `do $$ declare h text := '${long.refresh}'; next_h text; begin ` +
        `for i in 1..60 loop next_h := md5(h || ':' || i::text) || md5(i::text || ':' || h); ` +
        `perform public.auth_refresh_session(h, next_h); h := next_h; end loop; end $$`,
    );
    expect(retired(long.id)).toHaveLength(60);
    expect(retired(long.id)).toContain(long.refresh);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: long.refresh, p_new_refresh_hash: hex() })).status).toBe("reuse_detected");
    expect(sessionRow(long.id).revoked_at).not.toBeNull();
    expect(await live(long.id)).toBe(false);
    // The history goes away with the session.
    sql(`delete from auth.sessions where id = '${long.id}'`);
    expect(count("auth.retired_refresh_tokens", `session_id = '${long.id}'`)).toBe(0);
  });

  it("an unknown or malformed refresh hash is invalid", async () => {
    expect((await rpc("auth_refresh_session", { p_refresh_hash: hex(), p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_refresh_session", { p_refresh_hash: "bad", p_new_refresh_hash: hex() })).status).toBe("invalid");
    const user = newUser({ tag: "badnew" });
    const s = await openSession(user.id);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: "bad" })).status).toBe("invalid");
    expect(sessionRow(s.id).refresh_hash).toBe(s.refresh);
  });

  it("idle expiry fails closed in refresh and in liveness", async () => {
    const user = newUser({ tag: "idle" });
    const s = await openSession(user.id);
    expect(await live(s.id)).toBe(true);
    sql(`update auth.sessions set idle_expires_at = now() - interval '1 second' where id = '${s.id}'`);
    expect(await live(s.id)).toBe(false);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect(sessionRow(s.id).refresh_hash).toBe(s.refresh);
  });

  it("absolute expiry fails closed in refresh and in liveness, even for the recent previous hash", async () => {
    const user = newUser({ tag: "absolute" });
    const s = await openSession(user.id);
    const r1 = hex();
    await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: r1 });
    sql(`update auth.sessions set absolute_expires_at = now() - interval '1 second', idle_expires_at = now() - interval '2 seconds' where id = '${s.id}'`);
    expect(await live(s.id)).toBe(false);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: r1, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: hex() })).status).toBe("invalid");
  });

  it("an idle window longer than the absolute bound is clamped to it", async () => {
    const user = newUser({ tag: "clamp" });
    const s = await openSession(user.id, { p_absolute_seconds: 120, p_idle_seconds: 100000 });
    expect(secondsAhead(s.id)).toBeLessThanOrEqual(120);
    expect(Number(sql(`select extract(epoch from idle_expires_at - absolute_expires_at) from auth.sessions where id = '${s.id}'`))).toBeLessThanOrEqual(0);
    const r1 = hex();
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: r1, p_idle_seconds: 100000 })).status).toBe("ok");
    expect(Number(sql(`select extract(epoch from idle_expires_at - absolute_expires_at) from auth.sessions where id = '${s.id}'`))).toBeLessThanOrEqual(0);
  });

  it("auth_revoke_session kills the session", async () => {
    const user = newUser({ tag: "revoke" });
    const s = await openSession(user.id);
    const other = await openSession(user.id);
    await rpc("auth_revoke_session", { p_session: s.id });
    expect(await live(s.id)).toBe(false);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect(await live(other.id)).toBe(true);
    // Revoking an unknown session is a no-op.
    await rpc("auth_revoke_session", { p_session: randomUUID() });
  });

  it("auth_revoke_user_sessions revokes all of a user's sessions except the named one", async () => {
    const user = newUser({ tag: "revoke-all" });
    const a = await openSession(user.id);
    const b = await openSession(user.id);
    const c = await openSession(user.id);
    const bystander = await openSession(newUser({ tag: "bystander" }).id);
    await rpc("auth_revoke_user_sessions", { p_user: user.id, p_except: b.id });
    expect([await live(a.id), await live(b.id), await live(c.id)]).toEqual([false, true, false]);
    expect(await live(bystander.id)).toBe(true);
    await rpc("auth_revoke_user_sessions", { p_user: user.id });
    expect(await live(b.id)).toBe(false);
  });

  it("a password change revokes the user's other sessions and keeps the named one", async () => {
    const user = newUser({ tag: "pw-sessions" });
    const keep = await openSession(user.id);
    const other = await openSession(user.id);
    const third = await openSession(user.id);
    const bystander = await openSession(newUser({ tag: "pw-bystander" }).id);
    expect(await rpc("auth_set_password", { p_user: user.id, p_hash: SCRYPT, p_keep_session: keep.id })).toEqual({ status: "ok" });
    expect([await live(keep.id), await live(other.id), await live(third.id)]).toEqual([true, false, false]);
    expect(await live(bystander.id)).toBe(true);
    expect(sql(`select encrypted_password from auth.users where id = '${user.id}'`)).toBe(SCRYPT);
    expect((await rpc("auth_session_live", { p_session: keep.id })).has_password).toBe(true);

    // Without a kept session every session ends.
    await rpc("auth_set_password", { p_user: user.id, p_hash: SCRYPT });
    expect(await live(keep.id)).toBe(false);
  });

  it("auth_set_password refuses a p_keep_session that is revoked, expired, or belongs to another user, leaving password and sessions untouched", async () => {
    const user = newUser({ password: true, tag: "pw-keep-bad" });
    const active = await openSession(user.id);
    const revoked = await openSession(user.id);
    await rpc("auth_revoke_session", { p_session: revoked.id });
    const idleExpired = await openSession(user.id);
    sql(`update auth.sessions set idle_expires_at = now() - interval '1 second' where id = '${idleExpired.id}'`);
    const absExpired = await openSession(user.id);
    sql(`update auth.sessions set absolute_expires_at = now() - interval '1 second', idle_expires_at = now() - interval '2 seconds' where id = '${absExpired.id}'`);
    const otherUser = newUser({ tag: "pw-keep-other" });
    const foreign = await openSession(otherUser.id);
    const newHash = `scrypt$32768$8$1$${"C".repeat(22)}$${"D".repeat(86)}`;

    for (const badKeep of [revoked.id, foreign.id, idleExpired.id, absExpired.id, randomUUID()]) {
      expect(await rpc("auth_set_password", { p_user: user.id, p_hash: newHash, p_keep_session: badKeep }), badKeep).toEqual({ status: "invalid" });
    }
    expect(sql(`select encrypted_password from auth.users where id = '${user.id}'`)).toBe(SCRYPT);
    expect(await live(active.id)).toBe(true);
    expect(await live(foreign.id)).toBe(true);
  });

  it("banning a user revokes every session at once", async () => {
    const user = newUser({ tag: "ban-sessions" });
    const a = await openSession(user.id);
    const b = await openSession(user.id);
    sql(`update auth.users set banned_until = now() + interval '1 day' where id = '${user.id}'`);
    expect([await live(a.id), await live(b.id)]).toEqual([false, false]);
    expect(count("auth.sessions", `user_id = '${user.id}' and revoked_at is null`)).toBe(0);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: a.refresh, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_create_session", { p_user: user.id, p_refresh_hash: hex() })).status).toBe("invalid");
  });

  it("a ban that is lifted later stops blocking liveness of a session opened afterwards", async () => {
    const user = newUser({ tag: "unban" });
    const before = await openSession(user.id);
    sql(`update auth.users set banned_until = now() + interval '1 day' where id = '${user.id}'`);
    sql(`update auth.users set banned_until = null where id = '${user.id}'`);
    expect(await live(before.id)).toBe(false);
    const after = await openSession(user.id);
    expect(await live(after.id)).toBe(true);
  });

  it("soft-deleting a user revokes every session at once", async () => {
    const user = newUser({ tag: "delete-sessions" });
    const a = await openSession(user.id);
    const b = await openSession(user.id);
    sql(`update auth.users set deleted_at = now() where id = '${user.id}'`);
    expect([await live(a.id), await live(b.id)]).toEqual([false, false]);
    expect(count("auth.sessions", `user_id = '${user.id}' and revoked_at is null`)).toBe(0);
    expect((await rpc("auth_refresh_session", { p_refresh_hash: b.refresh, p_new_refresh_hash: hex() })).status).toBe("invalid");
  });

  it("a ban set by expiry alone (banned_until in the past) does not block a user", async () => {
    const user = newUser({ tag: "past-ban" });
    sql(`update auth.users set banned_until = now() - interval '1 minute' where id = '${user.id}'`);
    const s = await openSession(user.id);
    expect(await live(s.id)).toBe(true);
  });

  it("platform-grant holders get at most 12 hours, ordinary users at most 7 days, whatever is requested", async () => {
    const tenYears = 315360000;
    const adminId = sql(`select id from auth.users where email = '${SEED_ADMIN}'`);
    const admin = await openSession(adminId, { p_absolute_seconds: tenYears, p_idle_seconds: tenYears });
    expect(secondsAhead(admin.id)).toBeLessThanOrEqual(12 * 3600);
    expect(secondsAhead(admin.id)).toBeGreaterThan(11 * 3600);
    expect(Number(sql(`select extract(epoch from idle_expires_at - now()) from auth.sessions where id = '${admin.id}'`))).toBeLessThanOrEqual(12 * 3600);

    const ordinary = await openSession(newUser({ tag: "lifetime" }).id, { p_absolute_seconds: tenYears, p_idle_seconds: tenYears });
    expect(secondsAhead(ordinary.id)).toBeLessThanOrEqual(7 * 86400);
    expect(secondsAhead(ordinary.id)).toBeGreaterThan(6 * 86400);

    // Lower bound: shorter than 60 s is raised to 60 s.
    const tiny = await openSession(newUser({ tag: "tiny" }).id, { p_absolute_seconds: 1, p_idle_seconds: 1 });
    expect(secondsAhead(tiny.id)).toBeGreaterThan(30);
    expect(secondsAhead(tiny.id)).toBeLessThanOrEqual(60);

    // The same bound applies on the code path.
    const adminCode = hex();
    sql(`delete from auth.otp_codes where email = '${SEED_ADMIN}'`);
    seedEmailsUsed.add(SEED_ADMIN);
    try {
      expect((await issue(SEED_ADMIN, adminCode)).status).toBe("sent");
      const viaCode = (await verify(SEED_ADMIN, adminCode, hex(), { p_absolute_seconds: tenYears, p_idle_seconds: tenYears })) as Identity;
      expect(viaCode.status).toBe("ok");
      createdSessions.push(viaCode.session_id);
      expect(secondsAhead(viaCode.session_id)).toBeLessThanOrEqual(12 * 3600);
    } finally {
      sql(`delete from auth.otp_codes where email = '${SEED_ADMIN}'`);
    }
  });

  it("every sign-in gets a new session id and refresh hash (session fixation)", async () => {
    const user = newUser({ tag: "fixation" });
    const a = await openSession(user.id);
    const b = await openSession(user.id);
    expect(a.id).not.toBe(b.id);
    expect(a.refresh).not.toBe(b.refresh);
    const anonA = await anonymousSession();
    const anonB = await anonymousSession();
    expect(anonA.id).not.toBe(anonB.id);
    expect(anonA.user).not.toBe(anonB.user);
    expect(anonA.refresh).not.toBe(anonB.refresh);

    // A code sign-in never reuses a session either.
    const code1 = hex();
    const code2 = hex();
    await issue(user.email, code1);
    const v1 = (await verify(user.email, code1)) as Identity;
    backdateCodes(user.email, 40);
    await issue(user.email, code2);
    const v2 = (await verify(user.email, code2)) as Identity;
    expect(new Set([a.id, b.id, v1.session_id, v2.session_id]).size).toBe(4);
  });

  it("a refresh hash cannot be stored twice", async () => {
    const user = newUser({ tag: "dup" });
    const s = await openSession(user.id);
    const dup = await m.rpc("auth_create_session", { p_user: user.id, p_refresh_hash: s.refresh });
    expect(dup.error).not.toBeNull();
    const anonDup = await m.rpc("auth_sign_in_anonymous", { p_refresh_hash: s.refresh });
    expect(anonDup.error).not.toBeNull();
    expect(sqlError(
      `insert into auth.sessions (user_id, refresh_hash, absolute_expires_at, idle_expires_at) values ('${user.id}', '${s.refresh}', now() + interval '1 hour', now() + interval '1 hour')`,
    )).toMatch(/duplicate key|unique/i);
    expect(count("auth.sessions", `refresh_hash = '${s.refresh}'`)).toBe(1);
  });

  it("session_live answers false for unknown ids", async () => {
    expect(await rpc("auth_session_live", { p_session: randomUUID() })).toEqual({ live: false });
  });
});

describe("passwords", () => {
  it("auth_password_credential returns the stored hash of a seed user, case-insensitively", async () => {
    const stored = sql(`select encrypted_password from auth.users where email = 'owner-a@geraiexpress.test'`);
    expect(stored).toMatch(/^scrypt\$/);
    const cred = await m.rpc("auth_password_credential", { p_email: "owner-a@geraiexpress.test" });
    expect(cred.error).toBeNull();
    expect(cred.data).toEqual({ user_id: "00000000-0000-4000-a000-0000000000a1", encrypted_password: stored });
    expect((await m.rpc("auth_password_credential", { p_email: " Owner-A@GeraiExpress.test " })).data).toEqual(cred.data);
  });

  it("the seeded fixture password signs in through the service and a wrong one does not", async () => {
    const auth = authService();
    const ok = await auth.signInWithPassword({ email: "owner-a@geraiexpress.test", password: "geraiexpress-local-dev", captchaToken: "" });
    expect(ok.ok).toBe(true);
    const bad = await auth.signInWithPassword({ email: "owner-a@geraiexpress.test", password: "geraiexpress-local-dev!", captchaToken: "" });
    expect(bad).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("returns null for unknown, anonymous, unconfirmed, password-less, banned and deleted identities", async () => {
    const withPassword = newUser({ password: true, tag: "pw-ok" });
    expect((await m.rpc("auth_password_credential", { p_email: withPassword.email })).data).toEqual({ user_id: withPassword.id, encrypted_password: SCRYPT });

    const nulls = [
      email("nobody"),
      newUser({ password: true, anonymous: true, tag: "pw-anon" }).email,
      newUser({ password: true, confirmed: false, tag: "pw-unconf" }).email,
      newUser({ password: false, tag: "pw-none" }).email,
      newUser({ password: true, banned: true, tag: "pw-ban" }).email,
      newUser({ password: true, deleted: true, tag: "pw-del" }).email,
      "",
    ];
    for (const addr of nulls) {
      const res = await m.rpc("auth_password_credential", { p_email: addr });
      expect(res.error, addr).toBeNull();
      expect(res.data, addr).toBeNull();
    }
  });

  it("auth_set_password stores a well-formed hash and flips has_password", async () => {
    const user = newUser({ tag: "setpw" });
    const s = await openSession(user.id);
    expect((await rpc("auth_session_live", { p_session: s.id })).has_password).toBe(false);
    expect(await rpc("auth_set_password", { p_user: user.id, p_hash: SCRYPT, p_keep_session: s.id })).toEqual({ status: "ok" });
    expect((await m.rpc("auth_password_credential", { p_email: user.email })).data).toEqual({ user_id: user.id, encrypted_password: SCRYPT });
  });

  it("auth_set_password rejects a malformed hash, an anonymous, unconfirmed, banned or unknown user", async () => {
    const user = newUser({ tag: "setpw-bad" });
    const malformed = [
      "",
      "plaintext-password",
      "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
      "scrypt$32768$8$1$salt",
      "scrypt$x$8$1$salt$hash",
      "scrypt$32768$8$1$sa lt$hash",
      "scrypt$32768$8$1$salt$ha$sh",
      `${SCRYPT}\n`,
    ];
    for (const hash of malformed) {
      expect((await rpc("auth_set_password", { p_user: user.id, p_hash: hash })).status, JSON.stringify(hash)).toBe("invalid");
    }
    expect(sql(`select encrypted_password from auth.users where id = '${user.id}'`)).toBe("");

    const anon = await anonymousSession();
    const unconfirmed = newUser({ confirmed: false, tag: "setpw-unconf" });
    const banned = newUser({ banned: true, tag: "setpw-ban" });
    for (const id of [anon.user, unconfirmed.id, banned.id, randomUUID()]) {
      expect((await rpc("auth_set_password", { p_user: id, p_hash: SCRYPT })).status, id).toBe("invalid");
    }
    expect(sql(`select encrypted_password from auth.users where id in ('${anon.user}', '${unconfirmed.id}', '${banned.id}')`)).toBe("");
  });
});

describe("anonymous demo identity (obligation 7)", () => {
  it("cannot be turned into a permanent account, request mail, enroll a factor or set a password", async () => {
    const anon = await anonymousSession();
    const addr = email("conversion");

    expect(sqlError(`update auth.users set email = '${addr}' where id = '${anon.user}'`)).toContain("anonymous_identity_is_demo_only");
    expect(sqlError(`update auth.users set encrypted_password = '${SCRYPT}' where id = '${anon.user}'`)).toContain("anonymous_identity_is_demo_only");
    expect(sqlError(`update auth.users set is_anonymous = false where id = '${anon.user}'`)).toContain("anonymous_identity_is_demo_only");
    expect(sqlError(`update auth.users set phone = '+6281200000000' where id = '${anon.user}'`)).toContain("anonymous_identity_is_demo_only");
    expect(sql(`select is_anonymous || '|' || coalesce(email, '-') || '|' || encrypted_password from auth.users where id = '${anon.user}'`)).toBe("true|-|");

    setRegistration(true);
    try {
      expect((await issue(addr, hex(), { p_requester: anon.user })).status).toBe("refused");
    } finally {
      setRegistration(false);
    }
    expect(count("auth.otp_codes", `email = '${addr}'`)).toBe(0);

    expect((await rpc("auth_mfa_enroll", { p_user: anon.user, p_secret_sealed: "v1.aaaa.bbbb", p_friendly_name: "x" })).status).toBe("invalid");
    expect(count("auth.mfa_factors", `user_id = '${anon.user}'`)).toBe(0);
    expect((await rpc("auth_set_password", { p_user: anon.user, p_hash: SCRYPT })).status).toBe("invalid");
    expect((await rpc("auth_create_session", { p_user: anon.user, p_refresh_hash: hex() })).status).toBe("invalid");
  });
});

describe("TOTP factors", () => {
  const SEALED = "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  it("enroll stores only the sealed text, a second enroll replaces the unverified factor", async () => {
    const user = newUser({ tag: "enroll" });
    const first = await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: SEALED, p_friendly_name: "Phone" });
    expect(first.status).toBe("ok");
    expect(first.factor_id).toBeTruthy();
    const row = JSON.parse(sql(`select row_to_json(f) from auth.mfa_factors f where f.id = '${first.factor_id}'`)) as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: user.id, status: "unverified", secret_sealed: SEALED, friendly_name: "Phone", last_used_step: null, verified_at: null });

    const sealed2 = `${SEALED}2`;
    const second = await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: sealed2 });
    expect(second.status).toBe("ok");
    expect(second.factor_id).not.toBe(first.factor_id);
    expect(count("auth.mfa_factors", `user_id = '${user.id}'`)).toBe(1);
    expect(count("auth.mfa_factors", `id = '${first.factor_id}'`)).toBe(0);
    expect(sql(`select secret_sealed from auth.mfa_factors where user_id = '${user.id}'`)).toBe(sealed2);

    expect((await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: "" })).status).toBe("invalid");
    expect((await rpc("auth_mfa_enroll", { p_user: randomUUID(), p_secret_sealed: SEALED })).status).toBe("invalid");
    expect((await rpc("auth_mfa_enroll", { p_user: newUser({ confirmed: false, tag: "enroll-unconf" }).id, p_secret_sealed: SEALED })).status).toBe("invalid");
    expect((await rpc("auth_mfa_enroll", { p_user: newUser({ banned: true, tag: "enroll-ban" }).id, p_secret_sealed: SEALED })).status).toBe("invalid");
  });

  it("auth_mfa_factor returns the named unverified factor, and the verified one in preference", async () => {
    const user = newUser({ tag: "factor" });
    const s = await openSession(user.id);
    const enrolled = await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: SEALED });
    const factor = enrolled.factor_id!;

    expect((await m.rpc("auth_mfa_factor", { p_user: user.id })).data).toBeNull();
    expect((await m.rpc("auth_mfa_factor", { p_user: user.id, p_factor: randomUUID() })).data).toBeNull();
    expect((await m.rpc("auth_mfa_factor", { p_user: randomUUID(), p_factor: factor })).data).toBeNull();
    expect((await m.rpc("auth_mfa_factor", { p_user: newUser({ tag: "factor-other" }).id, p_factor: factor })).data).toBeNull();
    expect((await m.rpc("auth_mfa_factor", { p_user: user.id, p_factor: factor })).data).toEqual({
      factor_id: factor, status: "unverified", secret_sealed: SEALED, last_used_step: null,
    });

    expect((await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 100, p_new_refresh_hash: hex() })).status).toBe("ok");
    // A second factor row for the same user is refused by the unique index; enrol already replaced an unverified one above.
    const stray = randomUUID();
    expect(sqlError(`insert into auth.mfa_factors (id, user_id, status, secret_sealed) values ('${stray}', '${user.id}', 'unverified', 'v1.other.other')`)).toMatch(
      /mfa_factors_one_per_user|duplicate key|unique/i,
    );
    for (const named of [null, factor, stray]) {
      const res = await m.rpc("auth_mfa_factor", { p_user: user.id, p_factor: named });
      expect(res.data).toEqual({ factor_id: factor, status: "verified", secret_sealed: SEALED, last_used_step: 100 });
    }
  });

  it("a fresh step upgrades the session to aal2, clamps a 7-day session to <= 12 hours, retires the old refresh hash, and refuses replays", async () => {
    const user = newUser({ tag: "verify" });
    const s = await openSession(user.id);
    expect(secondsAhead(s.id)).toBeGreaterThan(6 * 86400);
    const factor = (await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: SEALED })).factor_id!;
    expect(sessionRow(s.id)).toMatchObject({ aal: "aal1", aal2_at: null });

    const newRefresh = hex();
    const ok = (await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 5000, p_new_refresh_hash: newRefresh })) as Identity;
    expect(ok).toMatchObject({ status: "ok", aal: "aal2", session_id: s.id, user_id: user.id });
    expect(ok.aal2_at).toBeTruthy();
    expect(sessionRow(s.id)).toMatchObject({ aal: "aal2", refresh_hash: newRefresh, previous_refresh_hash: null });
    expect(retired(s.id)).toEqual([s.refresh]);
    expect(secondsAhead(s.id)).toBeLessThanOrEqual(12 * 3600);
    expect(secondsAhead(s.id)).toBeGreaterThan(11 * 3600);
    expect(Number(sql(`select extract(epoch from idle_expires_at - now()) from auth.sessions where id = '${s.id}'`))).toBeLessThanOrEqual(12 * 3600);
    expect(sql(`select status || '|' || last_used_step || '|' || (verified_at is not null) from auth.mfa_factors where id = '${factor}'`)).toBe("verified|5000|true");
    expect((await rpc("auth_session_live", { p_session: s.id }))).toMatchObject({ live: true, aal: "aal2" });

    // The new refresh token rotates and keeps aal2.
    const r3 = hex();
    expect(await rpc("auth_refresh_session", { p_refresh_hash: newRefresh, p_new_refresh_hash: r3 })).toMatchObject({ status: "ok", aal: "aal2" });

    // Same step: replay; older step: replay; neither touches the session.
    const before = sessionRow(s.id);
    expect((await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 5000, p_new_refresh_hash: hex() })).status).toBe("replay");
    expect((await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 4999, p_new_refresh_hash: hex() })).status).toBe("replay");
    expect(sessionRow(s.id)).toEqual(before);
    expect(sql(`select last_used_step from auth.mfa_factors where id = '${factor}'`)).toBe("5000");

    // A newer step is fine, rotates the refresh hash again, and retires the previous one.
    const r4 = hex();
    expect((await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 5001, p_new_refresh_hash: r4 })).status).toBe("ok");
    expect(sessionRow(s.id)).toMatchObject({ refresh_hash: r4 });
    expect(retired(s.id)).toEqual([s.refresh, newRefresh, r3]);
    expect(sql(`select last_used_step from auth.mfa_factors where id = '${factor}'`)).toBe("5001");

    // Presenting the pre-MFA refresh hash triggers reuse_detected and revokes the session.
    expect((await rpc("auth_refresh_session", { p_refresh_hash: s.refresh, p_new_refresh_hash: hex() })).status).toBe("reuse_detected");
    expect(await live(s.id)).toBe(false);
  });

  it("a verified user cannot enroll again and the factor is untouched", async () => {
    const user = newUser({ tag: "verified" });
    const s = await openSession(user.id);
    const factor = (await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: SEALED })).factor_id!;
    await rpc("auth_mfa_verify", { p_user: user.id, p_factor: factor, p_session: s.id, p_step: 10, p_new_refresh_hash: hex() });
    expect((await rpc("auth_mfa_enroll", { p_user: user.id, p_secret_sealed: "v1.new.new" })).status).toBe("already_verified");
    expect(sql(`select count(*) || '|' || min(secret_sealed) || '|' || min(status) from auth.mfa_factors where user_id = '${user.id}'`)).toBe(`1|${SEALED}|verified`);
  });

  it("another user's session or factor changes nothing", async () => {
    const owner = newUser({ tag: "mfa-owner" });
    const other = newUser({ tag: "mfa-other" });
    const ownerSession = await openSession(owner.id);
    const otherSession = await openSession(other.id);
    const factor = (await rpc("auth_mfa_enroll", { p_user: owner.id, p_secret_sealed: SEALED })).factor_id!;
    const otherFactor = (await rpc("auth_mfa_enroll", { p_user: other.id, p_secret_sealed: SEALED })).factor_id!;
    const ownerBefore = sessionRow(ownerSession.id);
    const otherBefore = sessionRow(otherSession.id);

    // The owner's factor with someone else's session, and someone else's factor with the own session.
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: factor, p_session: otherSession.id, p_step: 7, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_mfa_verify", { p_user: other.id, p_factor: factor, p_session: otherSession.id, p_step: 7, p_new_refresh_hash: hex() })).status).toBe("replay");
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: otherFactor, p_session: ownerSession.id, p_step: 7, p_new_refresh_hash: hex() })).status).toBe("replay");
    // Unknown session, revoked session, malformed hash, negative step.
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: factor, p_session: randomUUID(), p_step: 7, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: factor, p_session: ownerSession.id, p_step: 7, p_new_refresh_hash: "bad" })).status).toBe("invalid");
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: factor, p_session: ownerSession.id, p_step: -1, p_new_refresh_hash: hex() })).status).toBe("invalid");

    expect(sessionRow(ownerSession.id)).toEqual(ownerBefore);
    expect(sessionRow(otherSession.id)).toEqual(otherBefore);
    expect(sql(`select count(*) from auth.mfa_factors where id in ('${factor}', '${otherFactor}') and last_used_step is null and status = 'unverified'`)).toBe("2");

    await rpc("auth_revoke_session", { p_session: ownerSession.id });
    expect((await rpc("auth_mfa_verify", { p_user: owner.id, p_factor: factor, p_session: ownerSession.id, p_step: 7, p_new_refresh_hash: hex() })).status).toBe("invalid");
    expect(sql(`select last_used_step is null from auth.mfa_factors where id = '${factor}'`)).toBe("t");
  });
});

describe("housekeeping", () => {
  it("auth_purge_expired removes long-dead sessions and old codes and keeps live ones", async () => {
    const user = newUser({ tag: "purge" });
    const liveS = await openSession(user.id);
    const recentlyExpired = await openSession(user.id);
    const longExpired = await openSession(user.id);
    const longRevoked = await openSession(user.id);
    const justRevoked = await openSession(user.id);
    sql(`update auth.sessions set absolute_expires_at = now() - interval '1 day', idle_expires_at = now() - interval '2 days' where id = '${recentlyExpired.id}'`);
    sql(`update auth.sessions set absolute_expires_at = now() - interval '8 days', idle_expires_at = now() - interval '9 days' where id = '${longExpired.id}'`);
    sql(`update auth.sessions set revoked_at = now() - interval '8 days' where id = '${longRevoked.id}'`);
    await rpc("auth_revoke_session", { p_session: justRevoked.id });

    const oldCode = email("purge-old");
    const freshCode = email("purge-fresh");
    sql(
      `insert into auth.otp_codes (email, purpose, code_hash, expires_at, created_at) values ` +
        `('${oldCode}', 'login', '${hex()}', now() - interval '2 days', now() - interval '2 days'), ` +
        `('${freshCode}', 'login', '${hex()}', now() + interval '10 minutes', now() - interval '1 hour')`,
    );

    const res = (await rpc("auth_purge_expired")) as unknown as { sessions: number; otp_codes: number };
    expect(res.sessions).toBeGreaterThanOrEqual(2);
    expect(res.otp_codes).toBeGreaterThanOrEqual(1);
    const survivors = (ids: string[]) => count("auth.sessions", `id in (${ids.map((i) => `'${i}'`).join(", ")})`);
    expect(survivors([longExpired.id, longRevoked.id])).toBe(0);
    expect(survivors([liveS.id, recentlyExpired.id, justRevoked.id])).toBe(3);
    expect(await live(liveS.id)).toBe(true);
    expect(count("auth.otp_codes", `email = '${oldCode}'`)).toBe(0);
    expect(count("auth.otp_codes", `email = '${freshCode}'`)).toBe(1);
  });
});
