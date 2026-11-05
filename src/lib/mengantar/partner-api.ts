// DEC-006 / PR-17–PR-20 / TD-3: Mengantar Partner API client (seller registration and seller keys).
// Every request is signed: SHA256(METHOD:PATH:TYPE:BODY:TIMESTAMP:PARTNER_SECRET), lowercase hex,
// headers partner-id/timestamp/signature (plain SHA-256 as Mengantar specifies, not HMAC). TYPE is
// empty on every route used here, hence the `::` after the path. The body
// is serialized once, signed and sent as the same string. The Partner Secret is never sent, and
// returned seller API keys are secrets the caller must seal (credential-crypto) before storing.
// Contract: docs/research/geraiexpress-mengantar-partner-api.md.
// lazy: sandbox only. Production needs the provider-given origin and approved egress addresses
// (Partner research §2); add it to PARTNER_ORIGINS then.

import { MengantarError, readBounded } from "./public-api";

export const PARTNER_ORIGINS = { sandbox: "https://sandbox.mengantar.com" } as const;
export type PartnerEnvironment = keyof typeof PARTNER_ORIGINS;

const PATHS = {
  list: "/api/partner/v1/sellers/list",
  register: "/api/partner/v1/sellers",
  apiKey: "/api/partner/v1/sellers/api-key",
  regenerate: "/api/partner/v1/sellers/api-key/regenerate",
} as const;

// Provider codes we branch on (Partner research §8); anything else is "unknown".
const PROVIDER_CODES = new Set([
  "MISSING_FIELDS", "PASSWORD_NOT_ALLOWED", "INVALID_NAME", "INVALID_EMAIL", "INVALID_PHONE",
  "INVALID_EXTERNAL_USER_ID", "PHONE_NOT_ALLOWED", "INVALID_PAGINATION", "INVALID_TIMESTAMP",
  "UNAUTHORIZED", "IP_NOT_ALLOWED", "PARTNER_DEACTIVATED", "SELLER_DEACTIVATED", "API_KEY_DISABLED",
  "SELLER_NOT_FOUND", "EMAIL_ALREADY_REGISTERED", "RATE_LIMITED", "DAILY_REGISTRATION_LIMIT",
  "KEY_PROVISIONING_FAILED", "INTERNAL_ERROR",
]);

export class PartnerError extends Error {
  constructor(
    // A provider code, or a local integration failure: "unavailable" (network, timeout, redirect,
    // 5xx without a code), "malformed" (unexpected status, type, size or shape) or "unknown".
    // T-110 local refusals, raised BEFORE anything is signed or sent (retry later, never a resend
    // trigger): "partner_quota_exhausted" (Partner-wide quota or a shared Retry-After; retryAfterSeconds
    // is the wait when known) and "provider_fence_engaged" (post-restore provider mutation fence).
    readonly code: string,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    // Present on KEY_PROVISIONING_FAILED: retry the same externalUserId, never a new identity.
    readonly sellerId: string | null = null,
  ) {
    super(`Mengantar Partner request failed: ${code}`);
    this.name = "PartnerError";
  }
}

export type SellerSummary = { sellerId: string; externalUserId: string; active: boolean };
export type Registration = { alreadyRegistered: boolean; sellerId: string; apiKey: string | null };
export type NewSeller = { name: string; email: string; phone: string; externalUserId: string };

const SELLER_ID: RegExp = /^[A-Za-z0-9_-]{1,64}$/;
const API_KEY: RegExp = /^[A-Za-z0-9_-]{8,128}$/;
const TIMEOUT_MS = 15_000;

export async function partnerSignature(path: string, body: string, timestamp: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`POST:${path}::${body}:${timestamp}:${secret}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type PartnerClient = ReturnType<typeof createPartnerClient>;

// T-110 / NFR-5: the durable Partner-wide quota every Partner request passes BEFORE it is signed.
// `mutating`: the call may change provider state (refused while the provider mutation fence is engaged);
// `newSellerRef`: the externalUserId of a registration (one seller counts once per WIB day).
// `cost` (default 1): requests reserved at once, for a caller that reserves before a local fence.
export type PartnerQuotaCall = { mutating: boolean; newSellerRef: string | null; cost?: number };
export type PartnerQuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: "quota" | "fence"; nextEligibleAt: number | null };
export type PartnerQuotaGate = {
  reserve(call: PartnerQuotaCall): Promise<PartnerQuotaDecision>;
  // A provider back-off for the whole Partner account (every tenant and replica waits). until = null:
  // the provider gave no Retry-After (the database applies its own bounded default).
  noteRetryAfter(until: number | null, scope: "request" | "new_seller"): Promise<void>;
};

type QuotaRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

// The gate backed by the machine-only RPCs reserve_partner_quota / note_partner_retry_after. Anything but
// a well-formed "allowed" answer (an RPC error, a malformed or missing reply) is a denial: fail closed.
export function rpcPartnerQuotaGate(rpc: QuotaRpc, environment: string, partnerId: string): PartnerQuotaGate {
  return {
    async reserve(call) {
      let res: Awaited<ReturnType<QuotaRpc>>;
      try {
        res = await rpc("reserve_partner_quota", {
          p_env: environment, p_partner: partnerId, p_cost: call.cost ?? 1, p_new_seller_ref: call.newSellerRef, p_mutating: call.mutating,
        });
      } catch {
        return { allowed: false, reason: "quota", nextEligibleAt: null };
      }
      if (res.error?.message === "provider_fence_engaged") return { allowed: false, reason: "fence", nextEligibleAt: null };
      const data = res.error ? null : res.data;
      if (isRecord(data) && data.allowed === true) return { allowed: true };
      const next = isRecord(data) && typeof data.next_eligible_at === "string" ? Date.parse(data.next_eligible_at) : Number.NaN;
      return { allowed: false, reason: "quota", nextEligibleAt: Number.isFinite(next) ? next : null };
    },
    async noteRetryAfter(until, scope) {
      try {
        await rpc("note_partner_retry_after", {
          p_env: environment, p_partner: partnerId, p_until: until === null ? null : new Date(until).toISOString(), p_scope: scope,
        });
      } catch {
        // Best effort: the provider refusal itself is still returned to the caller.
      }
    },
  };
}

export function createPartnerClient(
  environment: PartnerEnvironment,
  partnerId: string,
  partnerSecret: string,
  quota: PartnerQuotaGate,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const origin = PARTNER_ORIGINS[environment];
  if (!origin) throw new Error("Unknown Mengantar Partner environment");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(partnerId)) throw new Error("Malformed Partner ID");
  if (partnerSecret.length < 16) throw new Error("Malformed Partner Secret");

  // `call === "reserved"`: the caller already reserved this request's quota (key regeneration reserves
  // before its local fence, so a denial can never leave a fenced rotation).
  async function post(path: (typeof PATHS)[keyof typeof PATHS], payload: Record<string, unknown>, call: PartnerQuotaCall | "reserved") {
    // T-110: reserved before signing; a denial sends nothing.
    const decision = call === "reserved" ? ({ allowed: true } as const) : await quota.reserve(call);
    if (!decision.allowed) {
      if (decision.reason === "fence") throw new PartnerError("provider_fence_engaged");
      const wait = decision.nextEligibleAt === null ? null : Math.max(1, Math.ceil((decision.nextEligibleAt - now()) / 1000));
      throw new PartnerError("partner_quota_exhausted", null, wait);
    }
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(now() / 1000));
    const signature = await partnerSignature(path, body, timestamp, partnerSecret);
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "partner-id": partnerId, timestamp, signature },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PartnerError("unavailable");
    }
    if (response.status >= 300 && response.status < 400) throw new PartnerError("unavailable", response.status);
    let text: string;
    try {
      text = await readBounded(response);
    } catch (error) {
      throw new PartnerError(error instanceof MengantarError ? "malformed" : "unavailable", response.status);
    }
    let json: unknown;
    try {
      json = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const envelope = isRecord(json) ? json : null;
    if (envelope?.success === true && response.status < 300) return { status: response.status, envelope };
    const code = envelope && typeof envelope.code === "string" && PROVIDER_CODES.has(envelope.code) ? envelope.code : "unknown";
    // A missing Retry-After is "unknown", never "retry now".
    const rawRetry = response.headers.get("retry-after")?.trim();
    const retry = rawRetry ? Number(rawRetry) : Number.NaN;
    const retrySeconds = Number.isFinite(retry) && retry >= 0 ? retry : null;
    // T-110: a provider throttle applies to the whole Partner account, so it is stored for every caller.
    // HTTP 429 is a throttle whatever its body (non-JSON or an unrecognised code); only the recognised daily
    // registration limit narrows it to new sellers.
    if (code === "DAILY_REGISTRATION_LIMIT") {
      await quota.noteRetryAfter(retrySeconds === null ? null : now() + retrySeconds * 1000, "new_seller");
    } else if (code === "RATE_LIMITED" || response.status === 429) {
      await quota.noteRetryAfter(retrySeconds === null ? null : now() + retrySeconds * 1000, "request");
    }
    if (!envelope) throw new PartnerError(response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "unavailable" : "malformed", response.status, retrySeconds);
    const data = isRecord(envelope.data) ? envelope.data : envelope;
    const sellerId = typeof data.sellerId === "string" && SELLER_ID.test(data.sellerId) ? data.sellerId : null;
    throw new PartnerError(code, response.status, retrySeconds, sellerId);
  }

  return {
    async listSellers(filter: { page?: number; size?: number; externalUserId?: string } = {}) {
      const { page, size, externalUserId } = filter;
      if (externalUserId !== undefined && (!externalUserId || externalUserId.length > 128)) throw new Error("Invalid externalUserId");
      if ((page !== undefined && !(Number.isInteger(page) && page >= 1)) || (size !== undefined && !(Number.isInteger(size) && size >= 1 && size <= 200))) {
        throw new Error("Invalid pagination");
      }
      const { status, envelope } = await post(PATHS.list, filter, { mutating: false, newSellerRef: null });
      const data = envelope.data;
      if (!isRecord(data) || !Array.isArray(data.sellers) || !Number.isSafeInteger(data.total) || (data.total as number) < 0) {
        throw new PartnerError("malformed", status);
      }
      // Names, emails and phones stay at the provider; callers get the binding facts only. One bad
      // entry fails the page: silently dropping it would let reconciliation think a seller is unbound.
      const sellers: SellerSummary[] = data.sellers.map((s) => {
        if (!isRecord(s) || typeof s.sellerId !== "string" || !SELLER_ID.test(s.sellerId) || typeof s.externalUserId !== "string" || typeof s.active !== "boolean") {
          throw new PartnerError("malformed", status);
        }
        return { sellerId: s.sellerId, externalUserId: s.externalUserId, active: s.active };
      });
      return { sellers, total: data.total as number };
    },

    // Idempotent on externalUserId: a repeat returns the same seller and its current key.
    async registerSeller(seller: NewSeller): Promise<Registration> {
      const { name, email, phone, externalUserId } = seller;
      if (!externalUserId || externalUserId.length > 128) throw new Error("Invalid externalUserId");
      const { status, envelope } = await post(PATHS.register, { name, email, phone, externalUserId }, { mutating: true, newSellerRef: externalUserId });
      const data = envelope.data;
      if (!isRecord(data) || typeof data.sellerId !== "string" || !SELLER_ID.test(data.sellerId)) throw new PartnerError("malformed", status);
      if (typeof envelope.alreadyRegistered !== "boolean") throw new PartnerError("malformed", status, null, data.sellerId);
      const alreadyRegistered = envelope.alreadyRegistered;
      if (status !== (alreadyRegistered ? 200 : 201)) throw new PartnerError("malformed", status, null, data.sellerId);
      // A null key only exists for a repeat registration whose key Mengantar disabled.
      const apiKey = data.apiKey === null && alreadyRegistered ? null : typeof data.apiKey === "string" && API_KEY.test(data.apiKey) ? data.apiKey : undefined;
      if (apiKey === undefined) throw new PartnerError("malformed", status, null, data.sellerId);
      return { alreadyRegistered, sellerId: data.sellerId, apiKey };
    },

    // Creates a key if the seller has none, so it is a credential operation, not a harmless read.
    async getSellerApiKey(sellerId: string): Promise<string> {
      if (!SELLER_ID.test(sellerId)) throw new Error("Invalid sellerId");
      const { status, envelope } = await post(PATHS.apiKey, { sellerId }, { mutating: true, newSellerRef: null });
      const data = envelope.data;
      if (!isRecord(data) || data.sellerId !== sellerId || typeof data.apiKey !== "string" || !API_KEY.test(data.apiKey)) {
        throw new PartnerError("malformed", status);
      }
      return data.apiKey;
    },

    // T-039: retires the old key at the provider IMMEDIATELY and returns the new one once. The response also
    // carries `callbackSecret`, which is deliberately never read: the server neither stores, logs nor
    // returns it (PR-19). A thrown PartnerError is not proof that nothing changed: only a refusal with a
    // known provider code is definite (partner-key-rotation.ts). The Partner docs promise no idempotency,
    // so never call this twice for one intent; lost responses recover through getSellerApiKey.
    // `quotaReserved`: the caller reserved the quota itself before fencing (partner-key-rotation.ts).
    async regenerateSellerKey(sellerId: string, options: { quotaReserved?: boolean } = {}): Promise<string> {
      if (!SELLER_ID.test(sellerId)) throw new Error("Invalid sellerId");
      const { status, envelope } = await post(PATHS.regenerate, { sellerId },
        options.quotaReserved === true ? "reserved" : { mutating: true, newSellerRef: null });
      const data = envelope.data;
      if (!isRecord(data) || data.sellerId !== sellerId || typeof data.apiKey !== "string" || !API_KEY.test(data.apiKey)) {
        throw new PartnerError("malformed", status);
      }
      return data.apiKey;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
