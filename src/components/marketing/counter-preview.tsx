import { Check, CircleCheck, FlaskConical, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { courierName } from "@/lib/format";
import { formatIdr } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

// Product visual (C10.6): the static look of the real create-shipment screen (the C4 progress spine and
// the summary rail of src/modules/shipments/intake-step.tsx and intake-summary.tsx), drawn with the
// same tokens and filled with labelled sample data. Not a screenshot and not interactive: hidden from
// assistive technology, described by its caption. One container query turns the single column into
// spine + summary side by side when the panel is wide (768-1023 full-width hero).
const STEPS = [
  { title: "Pengirim", value: "Toko Contoh, Kota Bandung" },
  { title: "Penerima", value: "Ibu Contoh · Coblong, Kota Bandung" },
  { title: "Paket & serah", value: "Kue kering · 1 kg · drop-off" },
  { title: "Ongkir", value: `${courierName("JT")} Reguler` },
] as const;

const SAMPLE_TOTAL = 15_000;
const SAMPLE_AWB = "SIM2610290001";

interface CounterPreviewProps {
  // "review": the moment before the cashier confirms (home hero); "issued": after confirmation, when the
  // simulated resi is recorded on the shipment (feature page), so a repeated panel adds information.
  state?: "review" | "issued";
  className?: string;
}

export function CounterPreview({ state = "review", className }: CounterPreviewProps) {
  const issued = state === "issued";
  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <div aria-hidden="true" className="@container overflow-hidden rounded-lg bg-card ring-1 ring-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <p className="truncate text-[17px] font-semibold">{issued ? "Detail kiriman" : "Kiriman baru"}</p>
          <Badge variant="pending" className="shrink-0">
            <FlaskConical />
            Simulasi
          </Badge>
        </div>

        <div className="grid @xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <ol className="flex flex-col px-5 pt-5 @xl:pb-5">
            {STEPS.map((step) => (
              <li key={step.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
                <span className="flex flex-col items-center">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" />
                  </span>
                  <span className="w-px flex-1 bg-primary" />
                </span>
                <span className="flex min-w-0 flex-col pb-4">
                  <span className="text-sm text-muted-foreground">{step.title}</span>
                  <span className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{step.value}</span>
                </span>
              </li>
            ))}
            <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
              {issued ? (
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" />
                </span>
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-card text-primary ring-2 ring-primary">
                  <PenLine className="size-3.5" />
                </span>
              )}
              <span className="flex min-w-0 flex-col pb-1">
                <span className="text-sm text-muted-foreground">Konfirmasi</span>
                <span className={cn("text-[15px] font-semibold", !issued && "text-primary")}>
                  {issued ? "Dikonfirmasi kasir" : "Periksa ringkasan"}
                </span>
              </span>
            </li>
          </ol>

          <div className="m-5 flex flex-col gap-3 self-start rounded-md bg-background p-5 @xl:ml-0">
            {issued ? (
              <>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-success">
                  <CircleCheck className="size-4 shrink-0" />
                  Resi simulasi sudah terbit
                </p>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-muted-foreground">Resi</span>
                  <span className="tabular text-xl font-semibold tracking-tight">{SAMPLE_AWB} (simulasi)</span>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
                  <span className="whitespace-nowrap font-semibold">Total ongkir</span>
                  <span className="tabular text-xl font-semibold">{formatIdr(SAMPLE_TOTAL)}</span>
                </div>
                <p className="text-sm text-muted-foreground">Drop-off: gerai menyerahkan paket ke kurir.</p>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Ongkir (tarif normal)</span>
                  <span className="tabular">{formatIdr(SAMPLE_TOTAL)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="whitespace-nowrap font-semibold">Total ongkir</span>
                  <span className="tabular text-3xl font-semibold tracking-tight">{formatIdr(SAMPLE_TOTAL)}</span>
                </div>
                <p className="text-sm text-muted-foreground">Harga contoh (simulasi)</p>
                <span className="mt-1 flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground">
                  Periksa &amp; konfirmasi
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        {issued
          ? "Ilustrasi halaman kiriman setelah konfirmasi, dengan data contoh. Resi tercatat di halaman kiriman."
          : "Ilustrasi layar buat pengiriman dengan data contoh. Pesanan baru diteruskan ke kurir setelah kasir menekan konfirmasi."}
      </figcaption>
    </figure>
  );
}
