// Maps stable database/RPC error codes to operator-facing Bahasa Indonesia messages (UX-1).
const MESSAGES: Record<string, string> = {
  not_found: "Data tidak ditemukan atau Anda tidak memiliki akses.",
  stale_revision: "Draf telah berubah sejak Anda membukanya. Muat ulang lalu periksa kembali.",
  stale_quote: "Estimasi sudah tidak sesuai dengan draf. Cek ongkir lagi sebelum konfirmasi.",
  quote_expired: "Estimasi sudah kedaluwarsa. Cek ongkir lagi sebelum konfirmasi.",
  not_estimated: "Cek ongkir dan pilih layanan sebelum konfirmasi.",
  incomplete_draft: "Lengkapi data pengirim, penerima dan paket sebelum cek ongkir.",
  provider_not_connected:
    "Akun Mengantar gerai ini belum terhubung, jadi ongkir dan resi belum bisa dibuat.",
  shipment_locked: "Pengiriman sudah dikirim ke kurir dan tidak dapat diubah.",
  idempotency_conflict: "Permintaan konfirmasi bentrok dengan pengiriman lain. Muat ulang halaman.",
  no_awb: "Label hanya tersedia setelah resi terbit.",
  provider_label_required: "Label resmi untuk pengiriman ini harus diambil dari PDF Mengantar, bukan label contoh.",
  nothing_to_reconcile: "Tidak ada operasi yang perlu direkonsiliasi.",
  demo_requires_anonymous_session: "Mode demo hanya untuk sesi demo.",
};

export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Terjadi kesalahan. Coba lagi.";
  if (error.message && MESSAGES[error.message]) return MESSAGES[error.message];
  if (error.code === "23514" || error.code === "22P02") return "Periksa kembali isian yang ditandai.";
  if (error.code === "42501") return "Anda tidak memiliki izin untuk tindakan ini.";
  return "Terjadi kesalahan. Coba lagi.";
}
