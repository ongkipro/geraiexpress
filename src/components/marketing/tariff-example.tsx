import { SAMPLE_LABEL as label, formatIdr } from "@/lib/marketing-data";

const SAMPLE_QUOTES = [
  { courier: "J&T Express", badge: "J&T", service: "EZ", eta: "2–3 hari", price: label.cod.shippingIdr, chosen: true },
  { courier: "SiCepat", badge: "SiCepat", service: "REG", eta: "2–3 hari", price: 15_500, chosen: false },
  { courier: "JNE", badge: "JNE", service: "REG", eta: "2–3 hari", price: 16_000, chosen: false },
  { courier: "ID Express", badge: "ID Express", service: "STD", eta: "3–4 hari", price: 15_000, chosen: false },
] as const;

export function TariffExample() {
  return (
    <figure className="grid gap-3">
      <div className="rounded-2xl border border-border bg-card p-5" aria-hidden="true">
        <p className="text-sm font-semibold text-muted-foreground">Cek tarif · 1 kg · Kota Bandung</p>
        <ul className="mt-3 divide-y divide-border">
          {SAMPLE_QUOTES.map((quote) => (
            <li
              key={`${quote.courier}-${quote.service}`}
              className={`flex items-center justify-between gap-3 px-2.5 py-3 ${
                quote.chosen ? "rounded-md bg-background outline outline-2 outline-primary" : ""
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex min-w-16 items-center justify-center rounded-sm border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                  {quote.badge}
                </span>
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {quote.service} · {quote.eta}
                </span>
              </span>
              <span className="text-base font-semibold tabular-nums text-foreground">{formatIdr(quote.price)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-semibold text-foreground">
          Dipilih: {label.courier} {formatIdr(label.cod.shippingIdr)} → resi {label.awb}
        </p>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        Contoh tampilan cek tarif dengan data rekaan; tarif nyata datang dari Mengantar saat Anda mengecek.
      </figcaption>
    </figure>
  );
}
