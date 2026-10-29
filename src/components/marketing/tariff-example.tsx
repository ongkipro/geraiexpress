import { Check } from "lucide-react";
import { courierName } from "@/lib/format";
import { formatIdr } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

// Illustrative rows only: invented prices, courier names resolved from the application's offered list.
// In each set the selected first row is the cheapest, so the sample shows why the cashier picked it.
// Two routes so the panel does not repeat itself where it appears twice on the site.
const SAMPLES = {
  bandung: {
    route: "Paket 1 kg · ke Kota Bandung",
    quotes: [
      { code: "JT", service: "Reguler", price: 15_000 },
      { code: "SiCepat", service: "Reguler", price: 15_500 },
      { code: "JNE", service: "Reguler", price: 16_000 },
      { code: "iDexpress", service: "Reguler", price: 16_500 },
    ],
  },
  surabaya: {
    route: "Paket 2 kg · ke Kota Surabaya",
    quotes: [
      { code: "SiCepat", service: "Reguler", price: 34_000 },
      { code: "JNE", service: "Reguler", price: 36_000 },
      { code: "lion", service: "Reguler", price: 37_500 },
      { code: "pos", service: "Reguler", price: 39_000 },
    ],
  },
} as const;

// Drawn like the "Ongkir" step of the create-shipment screen (radio rows, selected row tinted, money
// right-aligned and tabular) so the public page previews the real control. Static and hidden from
// assistive technology; the caption states that the prices are samples.
export function TariffExample({ sample = "bandung", className }: { sample?: keyof typeof SAMPLES; className?: string }) {
  const { route, quotes } = SAMPLES[sample];
  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <div className="rounded-lg bg-card p-5 ring-1 ring-border sm:p-6" aria-hidden="true">
        <p className="text-[17px] font-semibold">Ongkir</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{route}</p>
        <ul className="mt-4 flex flex-col divide-y divide-border overflow-hidden rounded-md ring-1 ring-border">
          {quotes.map((quote, index) => (
            <li
              key={quote.code}
              className={cn("flex min-h-16 items-start gap-3 px-4 py-3", index === 0 && "bg-info-soft")}
            >
              <span
                className={cn(
                  "mt-1 size-5 shrink-0 rounded-full bg-card",
                  index === 0 ? "ring-[6px] ring-inset ring-primary" : "ring-1 ring-inset ring-input",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">{courierName(quote.code)}</span>
                  {index === 0 && (
                    <span className="inline-flex items-center gap-1 text-sm text-primary">
                      <Check className="size-4" />
                      Dipilih
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{quote.service}</span>
              </span>
              <span className="tabular shrink-0 text-right text-xl font-semibold">{formatIdr(quote.price)}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        Contoh tampilan cek tarif dengan data rekaan. Gerai yang akun Mengantar-nya terhubung melihat tarif nyata dari
        Mengantar; mode demo memakai harga contoh.
      </figcaption>
    </figure>
  );
}
