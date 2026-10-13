// RATE-1: the limiter key for a visitor. IPv6 visitors usually control a whole /64, so they are
// limited per /64 prefix (otherwise rotating addresses inside it would bypass the limit); IPv4
// is limited per address.
export function visitorKey(ip: string | null): string | null {
  const v = ip?.trim().toLowerCase();
  if (!v) return null;
  if (!v.includes(":")) return v;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - width(h) - width(t))).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Without a limiter binding or a visitor IP the deployed Worker refuses; only `next dev`
// (no Cloudflare edge) proceeds unlimited.
export function allowUnlimited(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}
