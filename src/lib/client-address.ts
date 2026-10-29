// T-062 / RATE-1 / DEC-020: the client address, read only from the header the reverse proxy overwrites.
//
// The proxy in infra/proxy sets `X-Real-IP` to the address of the TCP peer (`header_up X-Real-IP
// {remote_host}`), replacing whatever the client sent; the app never reads `X-Forwarded-For` or any
// other client-controllable header. The header is honoured ONLY while TRUSTED_PROXY is exactly "1",
// which is set only in a deployment whose app port is reachable from the proxy alone (compose.yaml
// publishes nothing but the proxy). Without it the address is unknown (null): the visitor limiters then
// refuse in production (fail closed, src/lib/rate-limit.ts). The auth service receives the address only
// as the Turnstile `remoteip`.
//
// If the header carries several comma-separated values (a proxy that appends instead of replacing), the
// LAST one is used: it is the one the nearest, trusted hop appended. Anything that is not a plain IPv4 or
// IPv6 address is treated as unknown.
//
// Do not blacklist private/bridge-looking addresses here: legitimate local/LAN clients can have them,
// and rejecting one cannot recover an address already lost by NAT. Production publishes IPv4 ONLY
// (compose.yaml, checked by check:environments) and must have no AAAA DNS records until native IPv6 is
// supported through the whole network; this prevents docker-proxy collapsing all IPv6 visitors to a gateway.
export const CLIENT_ADDRESS_HEADER = "x-real-ip";
export const TRUSTED_PROXY_VAR = "TRUSTED_PROXY";

// Pure syntax check, no DNS and no netmask: used for the header value. URL's native IPv6 parser is
// available in Node and in Next's Edge runtime.
export function isIpAddress(value: string): boolean {
  if (value.includes(":")) return /^[a-f0-9:.]+$/i.test(value) && URL.canParse(`http://[${value}]/`);
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value.split(".").every((octet) => Number(octet) <= 255);
}

export function proxyTrusted(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[TRUSTED_PROXY_VAR]?.trim() === "1";
}

export function clientAddress(
  headers: { get(name: string): string | null },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (!proxyTrusted(env)) return null;
  const last = headers.get(CLIENT_ADDRESS_HEADER)?.split(",").at(-1)?.trim();
  return last && isIpAddress(last) ? last : null;
}
