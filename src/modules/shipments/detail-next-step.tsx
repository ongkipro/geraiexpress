import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FAILURE_REASON as BASE_FAILURE_REASON, courierName, formatIdr, formatWib } from "@/lib/format";
import { checkPaymentAction, closeFailedAction, reconcileAction, reopenAction } from "./actions";
import { DispatchQueuedDialog } from "./dispatch-queued-dialog";
import { AdminCloseDialog } from "./admin-close-dialog";
import { BatchPayControl } from "./batch-actions";
import { IssuedActions, IssuedResult } from "./detail-issued";
import type { BatchReview, OperationRecord, ShipmentRecord } from "./detail-types";
import { PaymentUnresolvedPanel, unresolvedPaymentState } from "./payment-state";
import { pickupFailureReason, type PickupPhase } from "./pickup-status";

// Mirrors private.definitely_not_created (20261014180000_issuance.sql): nothing was created at
// Mengantar, so the draft can be reopened.
const REOPENABLE = ["PROVIDER_REJECTED", "NOT_ALLOWED", "INPUT_INVALID", "INPUT_INCOMPLETE", "PICKUP_NOT_FOUND", "QUOTE_STALE", "CLOSED_NOT_CREATED", "PICKUP_TIME_INVALID", "PICKUP_SLOT_UNAVAILABLE"];

// T-043: result codes of the pickup flow, kept beside the shared table.
const FAILURE_REASON: Record<string, string> = {
  ...BASE_FAILURE_REASON,
  PICKUP_TIME_INVALID: "Jam jemput tidak memenuhi syarat Mengantar (minimal 90 menit dari sekarang).",
  PICKUP_SLOT_UNAVAILABLE: "Mengantar menolak slot jemput yang dipilih. Tidak ada slot yang dipesan dan tidak ada pesanan yang dibuat.",
};

const RECHECKED = ["NOT_CREATED", "PROVIDER_ERROR_ITEM"];
// Mirrors close_ambiguous_pickup_reservation's 30-minute rest after dispatch (20261029170000_admin_closes.sql).
const CLOSE_AFTER_MS = 30 * 60 * 1000;

function ProviderDetail({ detail }: { detail: string }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="provider-error-detail">
      <span className="font-semibold">Keterangan Mengantar:</span> {detail}
    </p>
  );
}

// C5: the first card of an issued, failed or uncertain shipment. It names the state, says plainly what
// is known, and offers one primary action (secondary ones are outlined). Every branch of the previous
// page is kept: queued, awaiting payment (unresolved attempt, batch review and pay), uncertain outcome,
// issued (real and simulated), reopenable refusal and an unresolved real failure.
export function NextStepCard({ s, op, hasLabel, isAdmin, batchReview }: {
  s: ShipmentRecord;
  op: OperationRecord | null;
  hasLabel: boolean;
  isAdmin: boolean;
  batchReview: BatchReview | null;
}) {
  const real = !s.is_simulated;
  const state = s.submission_state;
  const unresolvedPayment = unresolvedPaymentState(batchReview?.payment_attempt_state);
  const retryable = state === "failed" && !!op && !op.is_simulated && REOPENABLE.includes(op.result_code ?? "");
  // T-056: a pickup reservation whose answer was lost (operation unknown in phase "reserving"). The
  // admin may close it 30 minutes after dispatch and after one read-back; the database re-checks both.
  const ambiguousReservation = real && !!op && !op.is_simulated && op.state === "unknown" && op.pickup_phase === "reserving";
  const reservationClosable = ambiguousReservation && !!op.last_checked_at && !!op.dispatched_at
    && Date.now() - Date.parse(op.dispatched_at) >= CLOSE_AFTER_MS;
  // T-056: an open payment attempt (sent or unknown) may be closed 30 minutes after the pay command was
  // sent (close_unknown_batch_payment, 20261029200000). Display only: the database decides.
  const paymentSentAt = batchReview?.payment_attempt_sent_at ? Date.parse(batchReview.payment_attempt_sent_at) : null;
  const paymentClosable = paymentSentAt === null || Date.now() - paymentSentAt >= CLOSE_AFTER_MS;
  // A shipment-scoped Server Action behind a pending-safe button (UX-13): label and width stay while pending.
  const form = (action: (f: FormData) => Promise<void>, label: string, pendingLabel: string, variant?: "outline") => (
    <form action={action} className="w-full sm:w-auto">
      <input type="hidden" name="shipment_id" value={s.id} />
      <SubmitButton pendingLabel={pendingLabel} variant={variant} className="w-full sm:w-auto">{label}</SubmitButton>
    </form>
  );

  let body: React.ReactNode;
  if (real && state === "queued") {
    body = (
      <>
        <p>Pesanan menunggu dikirim ke Mengantar. Sistem mengirimnya otomatis; Anda juga bisa mengirimnya sekarang.</p>
        <div className="flex"><DispatchQueuedDialog shipmentId={s.id} reference={s.reference} /></div>
      </>
    );
  } else if (real && state === "awaiting_payment") {
    const payable = isAdmin && !!batchReview && !unresolvedPayment;
    body = (
      <>
        {unresolvedPayment ? (
          <p>Pesanan Mengantar sudah dibuat dan perintah bayar batch sudah pernah dikirim. Jangan buat pengiriman baru dan jangan bayar ulang untuk paket ini.</p>
        ) : isAdmin ? (
          <p>Pesanan Mengantar sudah dibuat, tetapi saldo Mengantar belum cukup sehingga resi belum terbit. Isi saldo terlebih dahulu; Anda dapat membayar batch dari sini (khusus admin) atau membayarnya di aplikasi Mengantar lalu memeriksa pembayarannya. Jangan buat pengiriman baru untuk paket ini.</p>
        ) : (
          // Operators cannot see the batch's payment attempts, so an unresolved attempt cannot be
          // ruled out: no instruction to pay anywhere, only to escalate.
          <p>Pesanan Mengantar sudah dibuat, tetapi saldo Mengantar belum cukup sehingga resi belum terbit. Minta admin gerai memeriksa pembayaran batch di GeraiExpress. Jangan bayar sendiri di aplikasi Mengantar dan jangan buat pengiriman baru untuk paket ini.</p>
        )}
        {unresolvedPayment ? <PaymentUnresolvedPanel state={unresolvedPayment} batch={batchReview?.batch} /> : null}
        <div className="flex">{form(checkPaymentAction, "Periksa pembayaran", "Memeriksa…", payable ? "outline" : undefined)}</div>
        {isAdmin && batchReview ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="batch-payment-review">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold">
                Tinjau Batch Mengantar <span className="tabular">{batchReview.batch}</span> ({courierName(batchReview.courier)})
              </h3>
              <p className="text-sm text-muted-foreground">
                <span className="tabular">{batchReview.member_count}</span> pesanan · Total ongkir pelanggan{" "}
                <span className="tabular font-semibold text-foreground">{formatIdr(batchReview.total_customer_charge_idr)}</span>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {unresolvedPayment
                ? "Pesanan dalam batch ini hanya bisa diperiksa; perintah bayar tidak dikirim lagi sampai hasil sebelumnya jelas:"
                : "Perintah bayar Mengantar berlaku untuk seluruh pesanan dalam batch ini sekaligus. Pastikan semua pesanan di bawah sudah benar sebelum memotong saldo Mengantar:"}
            </p>
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {batchReview.members.map((m) => (
                <li key={m.operation_id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular font-semibold">{m.reference}</span>
                      {m.is_cod ? <Badge variant="neutral">COD</Badge> : null}
                    </span>
                    <span className="break-words text-muted-foreground"><span className="tabular">{m.provider_order_id}</span> · {m.recipient_name ?? "—"}</span>
                  </span>
                  <span className="tabular shrink-0 font-medium">{formatIdr(m.customer_charge_idr)}</span>
                </li>
              ))}
            </ul>
            {batchReview.payment_attempt_state === "closed" ? (
              <p className="text-sm" data-testid="payment-attempt-closed">
                Percobaan pembayaran sebelumnya sudah ditutup admin gerai dan tercatat di audit. Batch ini bisa diotorisasi lagi.
              </p>
            ) : null}
            {unresolvedPayment && batchReview.payment_attempt_id ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="close-payment">
                <p className="text-sm text-muted-foreground">
                  {paymentClosable
                    ? "Jika pemeriksaan tetap tidak memberi hasil dan Anda sudah memastikan di aplikasi Mengantar bahwa batch ini belum dibayar, tutup percobaan ini agar batch bisa diotorisasi lagi."
                    : `Perintah bayar dikirim kurang dari 30 menit lalu, jadi jawabannya masih bisa masuk. Percobaan ini baru bisa ditutup 30 menit setelah perintah bayar dikirim (mulai ${formatWib(new Date(paymentSentAt! + CLOSE_AFTER_MS).toISOString())}), setelah Anda memastikan di aplikasi Mengantar bahwa batch ini belum dibayar.`}
                </p>
                {paymentClosable ? (
                  <div className="flex">
                    <AdminCloseDialog kind="payment" shipmentId={s.id} attemptId={batchReview.payment_attempt_id} batch={batchReview.batch} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {unresolvedPayment ? null : (
              <BatchPayControl
                shipmentId={s.id}
                batchDigest={batchReview.batch_digest}
                batch={batchReview.batch}
                courierLabel={courierName(batchReview.courier)}
                memberCount={batchReview.member_count}
                totalCustomerChargeIdr={batchReview.total_customer_charge_idr}
                references={batchReview.members.map((m) => m.reference)}
              />
            )}
          </div>
        ) : !isAdmin ? (
          <p className="text-sm text-muted-foreground">Minta admin gerai memeriksa pembayaran batch di GeraiExpress.</p>
        ) : null}
      </>
    );
  } else if (state === "unknown" || state === "queued" || state === "in_flight") {
    body = (
      <>
        <p>Hasil pengiriman ke kurir belum pasti. Jangan buat pengiriman baru untuk paket ini — periksa operasi aslinya terlebih dahulu.</p>
        {isAdmin ? (
          <div className="flex">{form(reconcileAction, "Periksa status operasi asli", "Memeriksa…")}</div>
        ) : (
          <p className="font-semibold">Minta admin gerai memeriksa status operasi asli.</p>
        )}
        {isAdmin && ambiguousReservation ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="close-reservation">
            <p className="text-sm text-muted-foreground">
              {reservationClosable
                ? "Jawaban Mengantar atas pemesanan slot jemput hilang dan pemeriksaan belum bisa memastikan slotnya. Jika Anda sudah memastikan di aplikasi Mengantar bahwa tidak ada slot maupun pesanan untuk paket ini, tutup pemesanan ini lalu buka drafnya lagi."
                : "Jawaban Mengantar atas pemesanan slot jemput hilang. Jika pemeriksaan tetap tidak memberi hasil, admin gerai bisa menutup pemesanan ini 30 menit setelah dikirim dan setelah satu kali pemeriksaan."}
            </p>
            {reservationClosable ? (
              <div className="flex">
                <AdminCloseDialog kind="reservation" shipmentId={s.id} reference={s.reference} />
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  } else if (state === "issued") {
    body = (
      <>
        <IssuedResult s={s} />
        {real ? (
          <p>Anda bisa mencetak label lokal dengan barcode resi dari GeraiExpress; label dari aplikasi Mengantar tetap bisa dipakai sebagai cadangan.</p>
        ) : null}
        <IssuedActions s={s} hasLabel={hasLabel} />
      </>
    );
  } else if (retryable && op) {
    body = (
      <>
        <p>{pickupFailureReason(op.result_code, (op.pickup_phase ?? null) as PickupPhase, FAILURE_REASON[op.result_code!])} Tidak ada pesanan yang dibuat, jadi Anda bisa memperbaiki data lalu mengonfirmasi lagi.</p>
        {op.provider_error_detail ? <ProviderDetail detail={op.provider_error_detail} /> : null}
        <div className="flex">{form(reopenAction, "Ubah & coba lagi", "Membuka…")}</div>
      </>
    );
  } else if (real && op) {
    const rechecked = RECHECKED.includes(op.result_code ?? "");
    body = (
      <>
        <p>
          {FAILURE_REASON[op.result_code ?? ""] ?? "Pengiriman gagal."} Mengantar mungkin masih mencatat percobaan ini, jadi jangan buat pengiriman baru sebelum admin gerai memeriksanya.
          {rechecked ? " Sistem memeriksanya ulang otomatis selama 24 jam." : ""}
        </p>
        {op.provider_error_detail ? <ProviderDetail detail={op.provider_error_detail} /> : null}
        {isAdmin && rechecked ? (
          <>
            <div className="flex">{form(reconcileAction, "Periksa lagi di Mengantar", "Memeriksa…")}</div>
            <form action={closeFailedAction} className="flex flex-col gap-2 border-t border-border pt-4">
              <input type="hidden" name="shipment_id" value={s.id} />
              <Label htmlFor="close-reason">Tutup sebagai “tidak ada pesanan”</Label>
              <p id="close-reason-hint" className="text-sm text-muted-foreground">
                Hanya setelah Anda memastikan di aplikasi Mengantar bahwa pesanan dengan referensi {s.reference} tidak ada. Alasan dicatat di audit; setelah ditutup, draf bisa dibuka lagi.
              </p>
              <Textarea id="close-reason" name="reason" rows={2} required minLength={5} maxLength={500} aria-describedby="close-reason-hint" />
              <SubmitButton pendingLabel="Menutup…" variant="outline" className="w-full sm:w-auto sm:self-start">Tutup percobaan</SubmitButton>
            </form>
          </>
        ) : !isAdmin ? <p className="font-semibold">Minta admin gerai memeriksanya.</p> : null}
      </>
    );
  } else {
    body = <p>Pengiriman gagal. Periksa data lalu buat draf baru bila perlu.</p>;
  }

  return (
    <section aria-labelledby="next-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-heading" className="text-xl">Langkah berikutnya</h2>
        <StatusBadge state={state} />
      </div>
      {body}
    </section>
  );
}
