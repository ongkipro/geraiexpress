const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 5000;

/** True only for HTTP 200 with `success: true`; every other outcome (including errors and timeouts) fails closed. */
export async function verifyTurnstile(opts: {
  secret: string;
  token: string | undefined;
  remoteIp?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<boolean> {
  const { secret, token, remoteIp, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });
  const check = (async () => {
    const response = await fetchImpl(SITEVERIFY_URL, { method: "POST", body, signal: controller.signal });
    if (response.status !== 200) return false;
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "success" in result && result.success === true;
  })().catch(() => false);

  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
