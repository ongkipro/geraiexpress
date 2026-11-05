import { friendlyError } from "@/lib/errors";

// Bahasa Indonesia messages for the invoice command (PR-16). Stable database codes in, operator-facing
// sentences out; anything else falls back to the shared mapping.
const MESSAGES: Record<string, string> = {
  whatsapp_missing: "Nomor WhatsApp gerai belum diisi. Minta administrator gerai mengisinya di Pengaturan.",
  simulated_shipment: "Pengiriman demo tidak memiliki invoice.",
  no_awb: "Invoice hanya tersedia setelah resi Mengantar terbit.",
  masking_acknowledgement_required: "Centang konfirmasi bahwa penerimaan label masking oleh kurir belum terverifikasi sebelum mencetak resi.",
  masking_disabled: "Masking pengirim dinonaktifkan untuk gerai ini. Buat label baru dengan identitas gerai di halaman Label.",
  charge_unknown: "Ongkos kirim pengiriman ini belum diketahui, jadi invoice belum bisa dibuat.",
};

export const invoiceError = (error: { message?: string; code?: string } | null | undefined): string =>
  (error?.message && MESSAGES[error.message]) || friendlyError(error);
