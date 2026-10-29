import { AlertTriangle } from "lucide-react";

// T-033 / UX-13: the newest payment attempt of a Mengantar batch as reported by review_unpaid_batch
// (`payment_attempt_state`). "sent" and "unknown" are unresolved: the pay request may already have
// reached Mengantar, so the only safe actions are reading the orders back and waiting.
export type UnresolvedPaymentState = "sent" | "unknown";

export function unresolvedPaymentState(value: unknown): UnresolvedPaymentState | null {
  return value === "sent" || value === "unknown" ? value : null;
}

export function PaymentUnresolvedPanel({ state, batch }: { state: UnresolvedPaymentState; batch?: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md bg-warning-soft p-4" data-testid="payment-unresolved" data-attempt-state={state}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
        Pembayaran sedang dicek / hasil belum pasti.
      </p>
      <p>Jangan bayar ulang. Periksa di aplikasi Mengantar atau tunggu pemeriksaan otomatis.</p>
      <p className="text-sm text-muted-foreground">
        {state === "sent"
          ? "Perintah bayar untuk batch ini sudah dikirim ke Mengantar dan hasilnya sedang diperiksa."
          : "Jawaban Mengantar atas perintah bayar tidak jelas, jadi sistem tidak mengirim perintah bayar kedua."}
        {batch ? <> Batch <span className="tabular">{batch}</span>.</> : null}{" "}
        “Periksa pembayaran” hanya membaca ulang pesanan di Mengantar dan tidak memotong saldo.
      </p>
    </div>
  );
}
