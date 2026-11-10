import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { friendlyError } from "@/lib/errors";
import { CLOSE_ERROR, DISPATCH_INFO as BASE_DISPATCH_INFO } from "@/lib/format";

// T-043: dispatch messages of the pickup flow, kept beside the shared table.
const DISPATCH_INFO: Record<string, string> = {
  ...BASE_DISPATCH_INFO,
  reservation_ambiguous: "Ada lebih dari satu jadwal pickup yang cocok di Mengantar. Tidak ada slot baru yang dipesan; hubungi admin GeraiExpress sebelum melanjutkan.",
  requeue_failed: "Jadwal pickup ditemukan, tetapi pesanan belum bisa dijadwalkan ulang. Periksa lagi sebentar lagi.",
  pickup_phase_unexpected: "Pesanan pickup ini sedang diperiksa. Jangan buat pengiriman baru; sistem akan memeriksanya.",
};

// Flash after a real dispatch, reconciliation or payment check (T-024).
const RESULT_TEXT: Record<string, string> = {
  issued: "Resi Mengantar sudah terbit.",
  unpaid: "Pesanan Mengantar dibuat, tetapi saldo Mengantar belum cukup. Isi saldo dan bayar di aplikasi Mengantar, lalu periksa pembayaran.",
  rejected: "Mengantar menolak pesanan ini. Tidak ada pesanan yang dibuat.",
  failed: "Mengantar mencatat percobaan ini sebagai gagal.",
  unknown: "Hasil pengiriman ke Mengantar belum pasti. Jangan buat pengiriman baru; sistem akan memeriksanya.",
  not_created: "Pemeriksaan tidak menemukan pesanan di Mengantar.",
  quote_stale: "Pesanan terlalu lama di antrean sehingga ongkirnya kedaluwarsa. Pesanan tidak dikirim; buka draf lagi dan cek ongkir ulang. Jika ini pengiriman pickup, cek status slot di halaman pengiriman.",
  reservation_confirmed: "Jadwal pickup terkonfirmasi di Mengantar. Pesanan akan dikirim; tidak ada slot kedua yang dipesan.",
};

export type ShipmentFlags = { galat?: string; terbit?: string; rekonsiliasi?: string; hasil?: string; info?: string; kontak?: string };

// C2: breadcrumb (depth 2), large title with the reference; the draft view also carries the state
// badge here (the issued/failed views show it in the "Langkah berikutnya" card).
export function ShipmentHeader({ reference, state, isCod, draft }: { reference: string; state: string; isCod: boolean; draft: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/pengiriman" className="inline-flex min-h-11 items-center text-primary">Pengiriman</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{draft ? "Draf" : "Detail"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[28px] leading-tight tracking-tight tabular sm:text-3xl">{reference}</h1>
        {draft ? <StatusBadge state={state} /> : null}
        {isCod ? <Badge variant="neutral">COD</Badge> : null}
      </div>
      {draft ? (
        <p className="text-muted-foreground">Lengkapi lima langkah di bawah. Draf belum menjadi pesanan sampai Anda mengonfirmasi.</p>
      ) : null}
    </div>
  );
}

// Flash banners. Only mapped codes are rendered; the query text itself never is. Errors are alerts,
// everything else is a polite status.
export function ShipmentFlash({ flags, simulated, draft }: { flags: ShipmentFlags; simulated: boolean; draft: boolean }) {
  const result = flags.hasil ? RESULT_TEXT[flags.hasil] : undefined;
  const resultOk = flags.hasil === "issued" || flags.hasil === "reservation_confirmed";
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {flags.galat ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{Object.hasOwn(CLOSE_ERROR, flags.galat) ? CLOSE_ERROR[flags.galat] : friendlyError({ message: flags.galat })}</AlertTitle>
        </Alert>
      ) : null}
      {!draft && flags.terbit ? (
        <Alert role="status" className="*:[svg]:text-success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Resi {simulated ? "simulasi " : ""}sudah terbit. Siapkan label untuk dicetak.</AlertTitle>
        </Alert>
      ) : null}
      {!draft && flags.rekonsiliasi ? (
        <Alert role="status" className="*:[svg]:text-success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Operasi asli sudah direkonsiliasi. Tidak ada pesanan kedua yang dibuat.</AlertTitle>
        </Alert>
      ) : null}
      {!draft && flags.hasil && result ? (
        <Alert role="status" data-testid="dispatch-result" className={resultOk ? "*:[svg]:text-success" : "*:[svg]:text-warning"}>
          {resultOk ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <AlertTitle>{result}</AlertTitle>
        </Alert>
      ) : null}
      {!draft && flags.info ? (
        <Alert role="status" data-testid="dispatch-info" className="*:[svg]:text-info">
          <Info aria-hidden="true" />
          <AlertTitle>{DISPATCH_INFO[flags.info] ?? "Pemeriksaan belum memberi hasil. Coba lagi nanti."}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
