// Run with writers stopped; secrets come only from OLD_AUTH_SECRET / NEW_AUTH_SECRET, never argv.
import { createDecipheriv, hkdfSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seal } from "./db-seed-totp.mjs";

export function unseal(authSecret, userId, sealed) {
  const [version, iv, body, extra] = sealed.split(".");
  if (version !== "v1" || extra !== undefined || !iv || !body) throw new Error("Invalid TOTP seal");
  const nonce = Buffer.from(iv, "base64url");
  const bytes = Buffer.from(body, "base64url");
  if (nonce.length !== 12 || bytes.length < 16) throw new Error("Invalid TOTP seal");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(authSecret), Buffer.alloc(0), Buffer.from("gx:totp:v1"), 32));
  const cipher = createDecipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`gx:totp:${userId}`));
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString("utf8");
}

export function resealSql(rows, oldSecret, newSecret) {
  if (![oldSecret, newSecret].every((s) => typeof s === "string" && Buffer.byteLength(s) >= 32) || oldSecret === newSecret) {
    throw new Error("Distinct OLD_AUTH_SECRET and NEW_AUTH_SECRET of at least 32 bytes required");
  }
  const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
  const updates = rows.map((row) => {
    const next = seal(newSecret, row.user_id, unseal(oldSecret, row.user_id, row.secret_sealed));
    return `UPDATE auth.mfa_factors SET secret_sealed=${literal(next)} WHERE id=${literal(row.id)} AND secret_sealed=${literal(row.secret_sealed)};\nIF NOT FOUND THEN RAISE EXCEPTION 'Factor changed; retry with writers stopped'; END IF;`;
  });
  return `BEGIN;\nLOCK TABLE auth.mfa_factors IN EXCLUSIVE MODE;\nDO $reseal$\nBEGIN\nIF (SELECT count(*) FROM auth.mfa_factors) <> ${rows.length} THEN RAISE EXCEPTION 'Factor set changed'; END IF;\n${updates.join("\n")}\nEND $reseal$;\nCOMMIT;\n`;
}

// realpath both sides: a symlinked path, spaces or "%" must not turn the run into a silent no-op.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 2) throw new Error("Usage: OLD_AUTH_SECRET=... NEW_AUTH_SECRET=... node scripts/reseal-totp.mjs");
  const common = fileURLToPath(new URL("./db-common.sh", import.meta.url));
  const psql = (sql) => execFileSync("bash", ["-c", 'set -euo pipefail; source "$1"; gx_psql -qAt -f -', "reseal-totp", common], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const rows = JSON.parse(psql("SELECT coalesce(json_agg(f), '[]'::json) FROM (SELECT id,user_id,secret_sealed FROM auth.mfa_factors ORDER BY id) f;"));
    psql(resealSql(rows, process.env.OLD_AUTH_SECRET, process.env.NEW_AUTH_SECRET));
    console.log(`TOTP factors re-sealed: ${rows.length} (one transaction)`);
  } catch {
    // Never print child-process errors: they may carry SQL containing ciphertext.
    console.error("TOTP re-seal failed; no partial rotation committed. Check keys, connection and stopped writers.");
    process.exitCode = 1;
  }
}
