import { friendlyError } from "../../lib/errors";

// Bahasa Indonesia messages for the label and gerai-WhatsApp commands (UX-9). Stable database codes in,
// operator-facing sentences out; anything else falls back to the shared mapping.
export const WHATSAPP_MISSING = "Nomor WhatsApp gerai belum diisi. Minta admin gerai mengisinya di Pengaturan.";
export const WHATSAPP_INVALID = "Nomor WhatsApp gerai tidak valid. Gunakan nomor Indonesia (misalnya 081234567890).";
export const WHATSAPP_SAVED = "Nomor WhatsApp gerai disimpan.";
export const MASKING_DISABLED =
  "Masking pengirim dinonaktifkan untuk gerai ini oleh administrator platform. Label dicetak dengan identitas gerai. Hubungi admin gerai untuk informasi lebih lanjut.";
export const RETENTION_NOTE = "Identitas asli gerai dan alamat pickup tetap tersimpan pada setiap label selama masa retensi audit, termasuk saat masking aktif.";

export const FORMAT_LOCKED = "Format resi terkunci sejak cetak pertama. Cetak ulang memakai ukuran yang sama.";

// T-084 / PR-46 / UX-9 acceptance gate: a masked label of a courier without recorded scan acceptance.
export const MASKING_ACK_REQUIRED =
  "Centang konfirmasi bahwa penerimaan label masking oleh kurir belum terverifikasi sebelum mencetak.";

const MESSAGES: Record<string, string> = {
  label_format_locked: FORMAT_LOCKED,
  masking_acknowledgement_required: MASKING_ACK_REQUIRED,
  whatsapp_missing: WHATSAPP_MISSING,
  invalid_whatsapp: WHATSAPP_INVALID,
  masking_disabled: MASKING_DISABLED,
  sender_fields_required: "Isi nama, nomor HP dan kota pengirim.",
  simulated_shipment: "Pengiriman demo memakai label contoh, bukan label cetak.",
  no_awb: "Label hanya tersedia setelah resi Mengantar terbit.",
  stale_state: "Nomor WhatsApp gerai sudah diubah admin lain. Muat ulang halaman lalu coba lagi.",
  admin_required: "Hanya admin gerai yang dapat mengubah nomor WhatsApp gerai.",
  demo_restricted: "Fitur ini tidak tersedia di demo.",
};

export const LABEL_UNKNOWN_RESULT =
  "Hasil penyimpanan label belum pasti. Muat ulang halaman untuk memeriksa riwayat permintaan cetak sebelum mencoba lagi.";

// Only stable refusals from the label commands prove that the write did not happen.
// Transport errors and unrecognized responses require reconciliation, never a blind retry.
export function labelPrintError(error: { message?: string; code?: string } | null | undefined): string {
  const refusals = ["label_format_locked", "not_found", "invalid_input", "simulated_shipment", "no_awb", "masking_disabled", "sender_fields_required", "whatsapp_missing", "masking_acknowledgement_required"];
  return error?.message && refusals.includes(error.message) ? labelError(error) : LABEL_UNKNOWN_RESULT;
}

export const labelError = (error: { message?: string; code?: string } | null | undefined): string =>
  (error?.message && MESSAGES[error.message]) || friendlyError(error);
