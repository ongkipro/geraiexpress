// DEC-009 / PR-29 / PR-33 / SEC-5: Supabase Auth hands every Auth email to the Worker (Send Email
// Hook). This module is pure: it verifies the Standard Webhooks signature, decides whether a
// message may be sent at all, and renders the Bahasa Indonesia text. Transport lives elsewhere.

export type HookUser = { id: string; email?: string; new_email?: string; is_anonymous?: boolean };
export type HookEmailData = {
  token?: string;
  token_new?: string;
  email_action_type: string;
};
export type HookPayload = { user: HookUser; email_data: HookEmailData };
export type OutgoingMail = { to: string; subject: string; text: string; html: string };

const encoder = new TextEncoder();

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function b64encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Standard Webhooks (used by Supabase hooks): HMAC-SHA256 over "id.timestamp.body" with the
// base64 secret after "v1,whsec_"; the signature header lists "v1,<base64>" entries; timestamps
// outside +-5 minutes are refused to bound replay.
// lazy: webhook-id is not remembered, so a captured request can be replayed inside the 5-minute
// window (same recipient and code only; needs the TLS traffic). Add a short-lived id store (KV or
// Durable Object) when the production transport lands.
export async function verifyHookSignature(body: string, headers: {
  id: string | null; timestamp: string | null; signature: string | null;
}, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const raw = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = b64decode(raw);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`)));
  const expected = b64encode(mac);
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    return version === "v1" && typeof value === "string" && constantTimeEqual(value, expected);
  });
}

// Only messages the product actually uses are sent; everything else is refused, and an anonymous
// identity never causes any mail (the T-016 residual: email change from a demo session).
const CODE_ACTIONS: Record<string, string> = {
  signup: "Kode verifikasi GeraiExpress",
  magiclink: "Kode masuk GeraiExpress",
  email: "Kode masuk GeraiExpress",
  recovery: "Kode pemulihan akun GeraiExpress",
  reauthentication: "Kode konfirmasi GeraiExpress",
};

export type MailDecision = { refuse: string } | { messages: OutgoingMail[] };

function codeMail(to: string, subject: string, code: string): OutgoingMail {
  const text = [
    `${subject}: ${code}`,
    "",
    "Masukkan kode ini di halaman GeraiExpress yang sedang Anda buka. Kode berlaku 1 jam.",
    "Jika Anda tidak meminta kode ini, abaikan email ini.",
  ].join("\n");
  const html = `<p>${subject}:</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p>`
    + "<p>Masukkan kode ini di halaman GeraiExpress yang sedang Anda buka. Kode berlaku 1 jam.</p>"
    + "<p>Jika Anda tidak meminta kode ini, abaikan email ini.</p>";
  return { to, subject, text, html };
}

export function decideMail(payload: HookPayload): MailDecision {
  const { user, email_data: data } = payload ?? ({} as Partial<HookPayload>);
  if (!user || !data) return { refuse: "malformed" };
  if (user.is_anonymous) return { refuse: "anonymous_identity" };
  const subject = CODE_ACTIONS[data.email_action_type];
  if (subject) {
    if (!user.email || !/^\d{6}$/.test(data.token ?? "")) return { refuse: "malformed" };
    return { messages: [codeMail(user.email, subject, data.token!)] };
  }
  if (data.email_action_type === "email_change") {
    // Secure email change: a code to the current address and one to the new address. A real user
    // always has a current address; without one (as for anonymous identities) nothing is sent,
    // even if the anonymous flag were missing.
    if (!user.email) return { refuse: "malformed" };
    const messages: OutgoingMail[] = [];
    if (user.email && /^\d{6}$/.test(data.token ?? "")) messages.push(codeMail(user.email, "Konfirmasi perubahan email GeraiExpress", data.token!));
    if (user.new_email && /^\d{6}$/.test(data.token_new ?? "")) messages.push(codeMail(user.new_email, "Konfirmasi email baru GeraiExpress", data.token_new!));
    return messages.length ? { messages } : { refuse: "malformed" };
  }
  return { refuse: "unsupported_action" };
}
