import { courierName, etaLabel, formatIdr, formatWeight, formatWib } from "@/lib/format";
import { dateLabel, isPickupVolume, slotLabel, VOLUME_LABEL } from "@/lib/mengantar/pickup";
import { GERAI_COST_LABEL, GERAI_COST_NOTE, geraiCostText } from "@/modules/pricing/display";
import type { OperationRecord, PickupSnapshot, ShipmentRecord } from "./detail-types";

type Fact = [term: string, value: React.ReactNode];
type Group = { title: string; facts: Fact[] };

// C5: what was sent, frozen at confirmation, as one grouped list (Penerima, Pengirim, Layanan, Biaya,
// Serah terima, Paket) inside a single frame. Rows stay <dt>/<dd> pairs.
export function ShipmentFacts({ s, quote, op, pickup, isPickup, reservationText, geraiCost, viewerId }: {
  s: ShipmentRecord;
  quote: { courier: string; service: string; eta_days: string | null } | null;
  op: OperationRecord | null;
  pickup: PickupSnapshot;
  isPickup: boolean;
  reservationText: string | null;
  // undefined = not shown; null = shown as "belum diketahui" (T-053).
  geraiCost: number | null | undefined;
  // The signed-in member: the declaration says "Anda" when they confirmed it.
  viewerId?: string;
}) {
  const real = !s.is_simulated;
  const groups: Group[] = [
    {
      title: "Penerima",
      facts: [
        ["Nama", `${s.recipient_name ?? "—"} · ${s.recipient_phone ?? "—"}`],
        ["Alamat tujuan", [s.recipient_address, s.recipient_area, s.recipient_postal_code].filter(Boolean).join(", ") || "—"],
      ],
    },
    {
      title: "Pengirim",
      facts: [
        ["Nama", `${s.sender_name ?? "—"} · ${s.sender_phone ?? "—"}`],
        ["Pickup (alamat asli, untuk retur)", [pickup.outlet, pickup.address, pickup.area].filter(Boolean).join(", ") || "—"],
      ],
    },
    {
      title: "Layanan",
      facts: [
        ["Resi", s.awb ? <span className="tabular font-semibold">{s.awb}{s.is_simulated ? " (simulasi)" : ""}</span> : "Belum terbit"],
        ...(real && op?.provider_order_id ? [["ID pesanan Mengantar", <span className="tabular" key="o">{op.provider_order_id}</span>] as Fact] : []),
        ["Kurir", quote ? `${courierName(quote.courier)} ${quote.service} · ${etaLabel(quote.eta_days)}` : "—"],
        ["Dikonfirmasi", <span className="tabular" key="t">{formatWib(s.submitted_at)}</span>],
      ],
    },
    {
      title: "Biaya",
      facts: [
        ["Ongkir pelanggan", <span className="tabular font-semibold" key="c">{formatIdr(s.customer_charge_idr)}</span>],
        ...(real ? [["Pembayaran Mengantar", <span key="mp" data-testid="provider-payment-state">{
          s.payment_state === "paid" ? "Sudah dibayar ke Mengantar" : s.payment_state === "unpaid" ? "Belum dibayar ke Mengantar"
            : s.payment_state === "not_applicable" ? "Tidak berlaku" : "Belum teramati"
        }</span>] as Fact] : []),
        ...(s.is_cod ? ([
          ["Metode pembayaran", "COD (Bayar di Tempat)"],
          ["Nilai barang", <span className="tabular" key="gv">{formatIdr(s.goods_value_idr)}</span>],
          ["Tagihan COD ke penerima", <span className="tabular font-semibold" key="cod">{formatIdr(s.cod_amount_idr)}</span>],
        ] as Fact[]) : []),
        ...(geraiCost !== undefined ? ([[GERAI_COST_LABEL, (
          <span key="gc" className="flex flex-col gap-1">
            <span className="tabular font-semibold" data-testid="gerai-cost-issued">{geraiCostText(geraiCost)}</span>
            <span className="text-sm text-muted-foreground">{GERAI_COST_NOTE} Hanya terlihat oleh admin gerai.</span>
          </span>
        )]] as Fact[]) : []),
      ],
    },
    {
      title: "Serah terima",
      facts: isPickup ? [
        ["Serah paket", "Dijemput kurir"],
        ["Jadwal jemput", <span className="tabular" key="pj" data-testid="pickup-slot">{dateLabel(pickup.pickup_date!)} · {slotLabel(pickup.pickup_slot_hour!)}</span>],
        ["Kendaraan penjemput", pickup.pickup_volume && isPickupVolume(pickup.pickup_volume) ? VOLUME_LABEL[pickup.pickup_volume] : "—"],
        ...(real && reservationText ? [["Status slot", <span key="ps" data-testid="pickup-state">{reservationText}</span>] as Fact] : []),
        ...(pickup.pickup_note ? [["Catatan jemput (lokal)", pickup.pickup_note] as Fact] : []),
      ] : [["Serah paket", "Antar sendiri ke gerai kurir"]],
    },
    {
      title: "Paket",
      facts: [
        ["Isi", s.item_description ?? "—"],
        ["Pernyataan isi", s.content_declaration_version == null
          ? "Tidak tercatat (dikonfirmasi sebelum pernyataan isi berlaku)"
          : <span key="decl" data-testid="content-declaration">Pengirim menyatakan bukan barang terlarang · versi {s.content_declaration_version} · {s.content_declared_by === viewerId ? "dicatat oleh Anda" : `dicatat oleh ${s.content_declared_by_email ?? "anggota gerai (email tidak tersedia)"}`}{s.content_declared_at ? ` · ${formatWib(s.content_declared_at)}` : ""}</span>],
        ["Berat aktual", <span className="tabular" key="w">{formatWeight(s.weight_grams)}</span>],
        ["Berat volume", s.weight_snapshot?.volumetric_weight_grams == null ? "Tidak dihitung" : formatWeight(s.weight_snapshot.volumetric_weight_grams)],
        ["Berat ditagih", s.weight_snapshot?.billable_weight_grams == null ? "Belum dihitung" : formatWeight(s.weight_snapshot.billable_weight_grams)],
        ...(s.provider_weight_grams != null ? [
          ["Berat kurir (penimbangan ulang)", formatWeight(s.provider_weight_grams)],
          ["Selisih berat kurir − aktual", s.weight_grams == null ? "Belum dapat dibandingkan" : `${s.provider_weight_grams - s.weight_grams} g`],
        ] as Fact[] : []),
      ],
    },
  ];

  return (
    <section aria-labelledby="facts-heading" className="flex flex-col rounded-lg bg-card ring-1 ring-border">
      <div className="flex flex-col gap-1 px-5 pt-5 pb-2 sm:px-6 sm:pt-6">
        <h2 id="facts-heading" className="text-xl">Detail pengiriman</h2>
        <p className="text-sm text-muted-foreground">Data ini dibekukan saat konfirmasi; perubahan kontak tidak mengubahnya.</p>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {groups.map((g, i) => (
          <section key={g.title} aria-labelledby={`fakta-${i}`} className="flex flex-col gap-1 px-5 py-4 sm:px-6">
            <h3 id={`fakta-${i}`} className="text-sm font-semibold text-muted-foreground">{g.title}</h3>
            <dl className="flex flex-col">
              {g.facts.map(([term, value]) => (
                <div key={term} className="grid gap-x-6 gap-y-0.5 py-1.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <dt className="text-sm text-muted-foreground sm:pt-0.5">{term}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
