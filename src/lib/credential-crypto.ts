// SEC-3 / SEC-7 / DATA-4: seller API keys are sealed on the server before they reach the database.
// AES-256-GCM via WebCrypto (Node). The keys live only in the container environment and form a
// KEY RING: CREDENTIAL_KEYS is a JSON object {"1": "<base64 of 32 random bytes>", "2": ...} and
// CREDENTIAL_KEY_CURRENT names the version that seals new credentials. The single legacy secret
// CREDENTIAL_KEY keeps working as version 1 while CREDENTIAL_KEYS is unset, so no deployed secret has
// to change. Each row stores its key_version ("v1", "v2", ...); opening uses the stored version and
// fails with a clear error when the ring does not hold it. The associated data binds each ciphertext
// to its tenant and credential version, so a database row moved to another tenant or version fails
// to open. Pure functions: no environment access here. Key material is never logged or put in an
// error message.

export type CredentialKeyBindings = {
  CREDENTIAL_KEY?: string;
  CREDENTIAL_KEYS?: string;
  CREDENTIAL_KEY_CURRENT?: string;
};

// Stored key versions ("v1") mapped to base64 keys, plus the version used to seal.
export type CredentialKeyRing = { current: string; keys: Record<string, string> };

// A ring is handed around as a string where an interface only carries one key (DispatcherDeps):
// either a single base64 key (legacy, version v1) or this JSON document.
export type CredentialKeyMaterial = string | CredentialKeyRing;

export const LEGACY_KEY_VERSION = "v1";

export class KeyRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRingError";
  }
}

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function credentialAad(tenantId: string, version: number): string {
  return `geraiexpress:seller-credential:${tenantId}:${version}`;
}

// "2" and "v2" both name key version v2 (the form stored on rows). Anything else is refused.
function versionLabel(raw: string, source: string): string {
  const m = /^v?([0-9]{1,4})$/.exec(raw.trim());
  if (!m || Number(m[1]) < 1) throw new KeyRingError(`${source} must be a positive integer version`);
  return `v${Number(m[1])}`;
}

function validateKey(keyB64: unknown, label: string): string {
  if (typeof keyB64 !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(keyB64)) {
    throw new KeyRingError(`${label} must be base64 of 32 bytes`);
  }
  if (unb64(keyB64).length !== 32) throw new KeyRingError(`${label} must be base64 of 32 bytes`);
  return keyB64;
}

function validateRing(ring: { current: unknown; keys: unknown }): CredentialKeyRing {
  if (typeof ring.current !== "string" || !ring.keys || typeof ring.keys !== "object" || Array.isArray(ring.keys)) {
    throw new KeyRingError("key ring is malformed");
  }
  const keys: Record<string, string> = {};
  for (const [raw, value] of Object.entries(ring.keys as Record<string, unknown>)) {
    const version = versionLabel(raw, "key ring version");
    if (version in keys) throw new KeyRingError(`key ring lists version ${version} twice`);
    keys[version] = validateKey(value, `key ring version ${version}`);
  }
  const current = versionLabel(ring.current, "current key version");
  if (!(current in keys)) throw new KeyRingError(`current key version ${current} is not in the ring`);
  return { current, keys };
}

// Reads the three bindings. Nothing configured => null (callers fail closed). Anything configured
// but malformed throws KeyRingError (no key content in the message).
export function loadKeyRing(b: CredentialKeyBindings): CredentialKeyRing | null {
  if (b.CREDENTIAL_KEYS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(b.CREDENTIAL_KEYS);
    } catch {
      throw new KeyRingError("CREDENTIAL_KEYS is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new KeyRingError("CREDENTIAL_KEYS must be a JSON object of version to key");
    }
    if (!b.CREDENTIAL_KEY_CURRENT) throw new KeyRingError("CREDENTIAL_KEY_CURRENT is required with CREDENTIAL_KEYS");
    return validateRing({ current: b.CREDENTIAL_KEY_CURRENT, keys: parsed });
  }
  if (!b.CREDENTIAL_KEY) return null;
  // Legacy single key = version 1. A current version other than 1 would seal under a key we do not hold.
  if (b.CREDENTIAL_KEY_CURRENT && versionLabel(b.CREDENTIAL_KEY_CURRENT, "CREDENTIAL_KEY_CURRENT") !== LEGACY_KEY_VERSION) {
    throw new KeyRingError("CREDENTIAL_KEY_CURRENT needs CREDENTIAL_KEYS unless it is 1");
  }
  return { current: LEGACY_KEY_VERSION, keys: { [LEGACY_KEY_VERSION]: validateKey(b.CREDENTIAL_KEY, "CREDENTIAL_KEY") } };
}

// The ring as one string for interfaces that carry a single key value.
export function serializeKeyRing(ring: CredentialKeyRing): string {
  return JSON.stringify(ring);
}

export function resolveKeyRing(material: CredentialKeyMaterial): CredentialKeyRing {
  if (typeof material !== "string") return validateRing(material);
  if (material.trimStart().startsWith("{")) {
    let parsed: { current?: unknown; keys?: unknown };
    try {
      parsed = JSON.parse(material);
    } catch {
      throw new KeyRingError("key ring is not valid JSON");
    }
    return validateRing({ current: parsed.current, keys: parsed.keys });
  }
  return { current: LEGACY_KEY_VERSION, keys: { [LEGACY_KEY_VERSION]: validateKey(material, "CREDENTIAL_KEY") } };
}

// The key material the server holds as one value for the dispatcher interface; null when none is set.
// The legacy single key stays the plain base64 key (validated); a CREDENTIAL_KEYS ring is serialized.
export function keyMaterialFromBindings(b: CredentialKeyBindings): string | null {
  const ring = loadKeyRing(b);
  if (!ring) return null;
  return b.CREDENTIAL_KEYS ? serializeKeyRing(ring) : ring.keys[LEGACY_KEY_VERSION];
}

// The ring as one value from a configuration reader (`config`): CREDENTIAL_KEYS +
// CREDENTIAL_KEY_CURRENT, or the legacy CREDENTIAL_KEY as version 1. Nothing configured, or a
// malformed ring => undefined: callers fail closed. The value is key material: never log or return it.
export function keyMaterialFromReader(read: (name: keyof CredentialKeyBindings) => string | undefined): string | undefined {
  try {
    return keyMaterialFromBindings({
      CREDENTIAL_KEY: read("CREDENTIAL_KEY"),
      CREDENTIAL_KEYS: read("CREDENTIAL_KEYS"),
      CREDENTIAL_KEY_CURRENT: read("CREDENTIAL_KEY_CURRENT"),
    }) ?? undefined;
  } catch {
    return undefined;
  }
}

async function importKey(keyB64: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, [usage]);
}

// Seals with the ring's current key version; the returned keyVersion is what the row stores.
export async function sealCredential(plaintext: string, aad: string, material: CredentialKeyMaterial) {
  const ring = resolveKeyRing(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(ring.keys[ring.current], "encrypt");
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext));
  return { ciphertext: b64(new Uint8Array(sealed)), iv: b64(iv), keyVersion: ring.current };
}

// Opened only on the server (tenantMengantar, the dispatcher); never returned or logged. The key
// version is the one stored on the row (key_version from the database, keyVersion from a fresh seal);
// a caller that has none means the legacy single key (v1).
export async function openCredential(
  sealed: { ciphertext: string; iv: string; key_version?: string; keyVersion?: string },
  aad: string,
  material: CredentialKeyMaterial,
): Promise<string> {
  const ring = resolveKeyRing(material);
  const version = sealed.key_version ?? sealed.keyVersion ?? LEGACY_KEY_VERSION;
  const keyB64 = Object.hasOwn(ring.keys, version) ? ring.keys[version] : undefined;
  if (!keyB64) throw new KeyRingError(`credential key version ${version} is not in the key ring`);
  const key = await importKey(keyB64, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv), additionalData: encoder.encode(aad) }, key, unb64(sealed.ciphertext));
  return new TextDecoder().decode(plain);
}

// A displayable hint so admins can tell keys apart without readback: the last 4 characters of a
// long key, only the last 2 of a short one (a hint must stay a small fraction of the key).
export function credentialHint(apiKey: string): string {
  return apiKey.slice(apiKey.length >= 24 ? -4 : -2);
}

// Mengantar does not publish a key format we can rely on; accept a bounded printable token.
export function validApiKey(apiKey: string): boolean {
  // The same shape the Mengantar client accepts (the key becomes a URL path segment), so a key
  // that can be stored can always be used.
  return /^[A-Za-z0-9_-]{16,128}$/.test(apiKey);
}
