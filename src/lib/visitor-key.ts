// RATE-2: group IPv6 visitors at /56 so rotating addresses or /64 subnets inside an allocation
// cannot evade the visitor budget; IPv4 is limited per address.
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
  const prefix = groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, ""));
  const subnet = (parseInt(groups[3] ?? "0", 16) & 0xff00).toString(16);
  return `${prefix.join(":")}:${subnet}::/56`;
}

// Without a visitor address (no TRUSTED_PROXY, or no valid proxy header) a production server refuses
// (fail closed); only a non-production build (`next dev`, tests) proceeds unlimited.
export function allowUnlimited(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}
