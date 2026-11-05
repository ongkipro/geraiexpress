import { friendlyError } from "../../lib/errors";

// Bahasa Indonesia messages for the label and gerai-WhatsApp commands (UX-9). Stable database codes in,
// operator-facing sentences out; anything else falls back to the shared mapping.
export const WHATSAPP_MISSING = "Nomor WhatsApp gerai belum diisi. Minta administrator gerai mengisinya di Pengaturan.";
export const WHATSAPP_INVALID = "Nomor WhatsApp gerai tidak valid. Gunakan nomor Indonesia berawalan 0, misalnya 081234567890.";
export const WHATSAPP_SAVED = "Nomor WhatsApp gerai disimpan.";
export const MASKING_DISABLED =
  "Masking pengirim dinonaktifkan untuk gerai ini oleh administrator platform. Label dicetak dengan identitas gerai. Hubungi administrator gerai untuk informasi lebih lanjut.";
export const RETENTION_NOTE = "Identitas asli gerai dan alamat pickup tetap tersimpan pada setiap label, juga saat masking aktif, dan disimpan selama masa retensi audit.";

const MESSAGES: Record<string, string> = {
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
  const refusals = ["not_found", "invalid_input", "simulated_shipment", "no_awb", "masking_disabled", "sender_fields_required", "whatsapp_missing"];
  return error?.message && refusals.includes(error.message) ? labelError(error) : LABEL_UNKNOWN_RESULT;
}

export const labelError = (error: { message?: string; code?: string } | null | undefined): string =>
  (error?.message && MESSAGES[error.message]) || friendlyError(error);
