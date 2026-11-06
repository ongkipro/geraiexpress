// SEC-8: explicit public contract. Never extend this with a shipment row, event detail or
// free-text area. The city is read from the structured area catalogue in track_shipment.
// T-045 / ADR-0003: the fixed status labels and kinds track_shipment may return; anything else fails closed.
export const STATUS_LABELS = ["Status belum tersedia", "Menunggu dijemput kurir", "Dalam perjalanan", "Ada kendala pengiriman",
  "Terkirim", "Dikembalikan ke pengirim", "Dibatalkan", "Status tidak dikenal"] as const;
export const TIMELINE_KINDS = ["awaiting_pickup", "in_transit", "problem", "delivered", "returned", "cancelled", "unknown"] as const;
export type StatusLabel = typeof STATUS_LABELS[number];
export type TimelineKind = typeof TIMELINE_KINDS[number];
export const KIND_LABEL: Record<TimelineKind, string> = {
  awaiting_pickup: "Menunggu dijemput kurir", in_transit: "Dalam perjalanan", problem: "Ada kendala pengiriman",
  delivered: "Terkirim", returned: "Dikembalikan ke pengirim", cancelled: "Dibatalkan", unknown: "Status tidak dikenal",
};

export type PublicTracking = {
  gerai_label: string | null;
  courier: string | null;
  service: string | null;
  awb: string;
  status_label: StatusLabel;
  // Kind and time only: never a raw provider value, detail or hub (SEC-8).
  timeline: { kind: TimelineKind; at: string }[];
  destination_city: string | null;
  sender_initials: string | null;
  recipient_initials: string | null;
  created_at: string;
  issued_at: string | null;
};

// Reconstruct the allowlist rather than forwarding an untyped DB object or request header. The timeline holds
// only whitelisted kinds with a valid time (at most 50 entries); anything else fails closed.
export function publicTracking(value: unknown): PublicTracking | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const nullable = ["gerai_label", "courier", "service", "destination_city", "sender_initials", "recipient_initials", "issued_at"] as const;
  if (nullable.some((key) => v[key] !== null && typeof v[key] !== "string")) return null;
  if (typeof v.awb !== "string" || !/^[A-Za-z0-9-]{6,40}$/.test(v.awb)
      || typeof v.created_at !== "string" || !(STATUS_LABELS as readonly unknown[]).includes(v.status_label)
      || !Array.isArray(v.timeline) || v.timeline.length > 50) return null;
  const timeline: { kind: TimelineKind; at: string }[] = [];
  for (const entry of v.timeline) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (Object.keys(e).some((k) => k !== "kind" && k !== "at")) return null;
    if (!(TIMELINE_KINDS as readonly unknown[]).includes(e.kind) || typeof e.at !== "string" || Number.isNaN(Date.parse(e.at))) return null;
    timeline.push({ kind: e.kind as TimelineKind, at: e.at });
  }
  return {
    gerai_label: v.gerai_label as string | null,
    courier: v.courier as string | null,
    service: v.service as string | null,
    awb: v.awb,
    status_label: v.status_label as StatusLabel,
    timeline,
    destination_city: v.destination_city as string | null,
    sender_initials: v.sender_initials as string | null,
    recipient_initials: v.recipient_initials as string | null,
    created_at: v.created_at,
    issued_at: v.issued_at as string | null,
  };
}

// Deliberately no AWB in an outbound URL. Visitors may paste the displayed AWB on the courier site.
export function courierTrackingUrl(courier: string | null): string | null {
  switch (courier?.toUpperCase()) {
    case "JT": return "https://jet.co.id/track";
    case "JNE": return "https://www.jne.co.id/tracking-package";
    case "SICEPAT": return "https://www.sicepat.com/checkAwb";
    default: return null;
  }
}
