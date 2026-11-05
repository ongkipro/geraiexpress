// SEC-8: explicit public contract. Never extend this with a shipment row, event detail or
// free-text area. The city is read from the structured area catalogue in track_shipment.
export type PublicTracking = {
  gerai_label: string | null;
  courier: string | null;
  service: string | null;
  awb: string;
  status_label: "Status belum tersedia";
  timeline: [];
  destination_city: string | null;
  sender_initials: string | null;
  recipient_initials: string | null;
  created_at: string;
  issued_at: string | null;
};

// Reconstruct the allowlist rather than forwarding an untyped DB object or request header.
// Until T-045 supplies the reviewed event mapping, even unexpected timeline data fails closed.
export function publicTracking(value: unknown): PublicTracking | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const nullable = ["gerai_label", "courier", "service", "destination_city", "sender_initials", "recipient_initials", "issued_at"] as const;
  if (nullable.some((key) => v[key] !== null && typeof v[key] !== "string")) return null;
  if (typeof v.awb !== "string" || !/^[A-Za-z0-9-]{6,40}$/.test(v.awb)
      || typeof v.created_at !== "string" || v.status_label !== "Status belum tersedia"
      || !Array.isArray(v.timeline) || v.timeline.length !== 0) return null;
  return {
    gerai_label: v.gerai_label as string | null,
    courier: v.courier as string | null,
    service: v.service as string | null,
    awb: v.awb,
    status_label: v.status_label,
    timeline: [],
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
