// T-109: the newest migration this image was built with (the 14-digit prefix of the newest file in
// db/migrations). tests/unit/schema-version.test.ts fails until it equals that file, so a release that adds
// a migration updates it in the same change. /healthz is not ready while the database is older.
export const EXPECTED_SCHEMA_VERSION = "20261106100000";

// A database at or beyond the expected version is compatible (migrations are forward-only and additive
// for the running image); an older one, or an answer that is not a version, is not.
export function schemaReady(applied: unknown, expected = EXPECTED_SCHEMA_VERSION): boolean {
  return typeof applied === "string" && /^[0-9]{14}$/.test(applied) && applied >= expected;
}
