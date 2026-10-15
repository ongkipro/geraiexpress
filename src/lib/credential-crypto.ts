// SEC-3 / DATA-4: seller API keys are sealed in the Worker before they reach the database.
// AES-256-GCM via WebCrypto (workerd and Node). The key lives only in a Worker secret
// (CREDENTIAL_KEY, base64 of 32 random bytes); the associated data binds each ciphertext to its
// tenant and credential version, so a database row moved to another tenant or version fails to
// open. Pure functions: no environment access here.

export const CREDENTIAL_KEY_VERSION = "v1";

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function credentialAad(tenantId: string, version: number): string {
  return `geraiexpress:seller-credential:${tenantId}:${version}`;
}

async function importKey(keyB64: string, usage: KeyUsage): Promise<CryptoKey> {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error("CREDENTIAL_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}

export async function sealCredential(plaintext: string, aad: string, keyB64: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyB64, "encrypt");
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext));
  return { ciphertext: b64(new Uint8Array(sealed)), iv: b64(iv), keyVersion: CREDENTIAL_KEY_VERSION };
}

// Opened only inside the Worker (tenantMengantar, the dispatcher); never returned or logged.
export async function openCredential(sealed: { ciphertext: string; iv: string }, aad: string, keyB64: string): Promise<string> {
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
