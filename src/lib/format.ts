const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

const shortDateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

export const formatIdr = (value: number | null | undefined) => (value == null ? "—" : idr.format(value));
export const formatWib = (iso: string | null | undefined) => (iso ? `${dateTime.format(new Date(iso))} WIB` : "—");
export const formatWibShort = (iso: string | null | undefined) => (iso ? shortDateTime.format(new Date(iso)) : "—");
export const formatWeight = (grams: number | null | undefined) =>
  grams == null ? "—" : grams >= 1000 ? `${(grams / 1000).toLocaleString("id-ID")} kg` : `${grams} g`;

export const SUBMISSION_LABEL: Record<string, string> = {
  draft: "Draf",
  estimated: "Sudah dicek ongkir",
  queued: "Dalam antrean",
  in_flight: "Sedang diproses",
  unknown: "Hasil belum pasti",
  awaiting_payment: "Menunggu pembayaran",
  issued: "Resi terbit",
  failed: "Gagal",
};

// Mengantar courier codes (stored as sent to create-order) → names counter staff know. The one
// courier-name table: the public pages derive their list from it too.
export const COURIER_NAME: Readonly<Record<string, string>> = {
  JNE: "JNE", SiCepat: "SiCepat", Sap: "SAP Express", iDexpress: "ID Express", JT: "J&T Express",
  lion: "Lion Parcel", anteraja: "AnterAja", spx: "SPX Express", pos: "Pos Indonesia",
};
export const courierName = (code: string) => COURIER_NAME[code] ?? code;

// Mengantar's delivery estimates arrive as "1 - 2 days", "2 - 1 days", "4 HARI", "1-2 Day" or
// "—"; show them as Indonesian day ranges ("1–2 hari"), smallest first. Anything else is shown
// as given (simulated quotes already read "2–3 hari").
export function etaLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^\s*(\d{1,2})\s*(?:[-–]\s*(\d{1,2}))?\s*(?:days?|hari)\s*$/i.exec(raw);
  if (!m) return raw;
  const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])].sort((x, y) => x - y);
  return a === b ? `${a} hari` : `${a}–${b} hari`;
}

// T-024: why a real dispatch did not run now (info flag) — the operation is still safe.
export const DISPATCH_INFO: Record<string, string> = {
  account_busy: "Pesanan lain gerai ini sedang dikirim ke Mengantar. Pesanan ini menunggu di antrean dan dikirim otomatis.",
  credential_missing: "Akun Mengantar gerai ini belum terhubung. Pesanan menunggu di antrean.",
  credential_unavailable: "Kunci Mengantar gerai ini tidak bisa dipakai (diganti atau tidak terbaca). Admin gerai perlu memeriksanya.",
  mengantar_unavailable: "Mengantar sedang tidak bisa dihubungi. Pesanan menunggu di antrean dan dikirim otomatis.",
  mengantar_not_configured: "Koneksi Mengantar di server belum disiapkan. Pesanan menunggu di antrean.",
  still_unpaid: "Mengantar belum menerima pembayaran pesanan ini.",
  too_early: "Terlalu cepat untuk menyimpulkan. Periksa lagi beberapa menit lagi.",
  duplicate_orders: "Ditemukan lebih dari satu pesanan Mengantar dengan referensi ini. Hubungi admin GeraiExpress sebelum melanjutkan.",
  lookup_failed: "Mengantar sedang tidak bisa dihubungi. Periksa lagi nanti.",
  incomplete_order: "Pesanan Mengantar ditemukan tetapi datanya belum lengkap. Periksa lagi nanti.",
  service_mismatch: "Pesanan Mengantar ditemukan, tetapi jenis layanannya (Reguler/Kargo) berbeda dari yang dikonfirmasi. Hubungi admin GeraiExpress sebelum melanjutkan.",
  wrong_environment: "Pesanan ini dibuat di lingkungan Mengantar lain.",
  not_queued: "Pesanan ini sudah diproses.",
  shipment_not_ready: "Data pengiriman belum lengkap untuk dikirim.",
  tenant_not_active: "Gerai ini sedang tidak aktif.",
  closed: "Percobaan ditutup. Anda bisa membuka draf lagi dan mengonfirmasi ulang.",
  payment_closed: "Percobaan pembayaran batch ditutup dan tercatat di audit. Batch dapat diotorisasi lagi bila masih ada pesanan yang belum dibayar.",
  payment_unresolved: "Hasil pembayaran di Mengantar belum pasti. Periksa lagi nanti; tidak ada pembayaran yang dikirim ulang otomatis.",
  payment_unconfirmed: "Mengantar belum mengonfirmasi pembayaran batch ini. Periksa lagi beberapa menit lagi.",
  payment_count_mismatch: "Jumlah pesanan yang dibayar di Mengantar tidak sama dengan jumlah di GeraiExpress. Hubungi admin GeraiExpress sebelum melanjutkan.",
  attempt_not_recorded: "Percobaan pembayaran ini tidak tercatat, jadi belum bisa dicek. Hubungi admin GeraiExpress.",
  pickup_reservation_not_recorded: "Pengiriman belum dimulai karena status pemesanan slot jemput belum tersimpan. Pesanan menunggu di antrean dan dikirim otomatis.",
  pickup_known_ids_unavailable: "Pengiriman belum dimulai karena daftar slot jemput gerai belum dapat dibaca. Tidak ada slot yang dipesan; pesanan menunggu di antrean dan dikirim otomatis.",
  pickup_create_not_recorded: "Slot jemput sudah dipesan, tetapi status pengiriman pesanan belum tersimpan. Pesanan menunggu di antrean dan dikirim otomatis tanpa memesan slot lagi.",
  missing_attempt: "Catatan percobaan pengiriman atau pembayaran tidak lengkap, jadi belum bisa dicek. Hubungi admin GeraiExpress.",
  pickup_phase_unexpected: "Pesanan jemput ini sedang diperiksa. Jangan buat pengiriman baru; sistem akan memeriksanya.",
  reservation_ambiguous: "Ada lebih dari satu slot jemput yang cocok di Mengantar. Tidak ada slot baru yang dipesan; hubungi admin GeraiExpress sebelum melanjutkan.",
  requeue_failed: "Slot jemput ditemukan, tetapi pesanan belum bisa dijadwalkan ulang. Periksa lagi sebentar lagi.",
  batch_id_unavailable: "Nomor batch Mengantar tidak tersedia, jadi pembayaran belum bisa dicek otomatis. Hubungi admin GeraiExpress.",
  batch_scope_mismatch: "Batch Mengantar ini mencakup pesanan di luar yang dicek. Hubungi admin GeraiExpress sebelum melanjutkan.",
  invalid_order_request: "Data pesanan belum memenuhi syarat Mengantar, jadi tidak ada yang dikirim.",
  mengantar_key_refused: "Mengantar menolak kunci akun gerai ini. Admin gerai perlu memeriksa kunci di Pengaturan.",
  mengantar_refused: "Mengantar menolak permintaan ini. Periksa data pesanan, lalu coba lagi.",
  payment_not_applied: "Mengantar menjawab tidak ada pesanan yang dibayar, dan semua pesanan masih belum dibayar. Periksa saldo Mengantar, lalu otorisasi pembayaran lagi.",
};

// T-056: refusal codes of the admin close commands (?galat=) that the shared error table does not
// cover; the detail page reads these before falling back to friendlyError.
export const CLOSE_ERROR: Record<string, string> = {
  // T-082: reopen_shipment refuses while an active counter payment exists (void it first).
  payment_recorded: "Pembayaran pelanggan sudah dicatat untuk pengiriman ini. Admin gerai perlu membatalkan catatan itu sebelum draf dibuka lagi.",
  stale_attempt: "Percobaan pembayaran batch sudah berganti sejak halaman ini dibuka. Muat ulang, tinjau lagi, lalu tutup bila masih perlu.",
};

// Result codes of a failed real operation, for the operator.
export const FAILURE_REASON: Record<string, string> = {
  PROVIDER_REJECTED: "Mengantar menolak pesanan ini (misalnya kurir tidak melayani rute atau drop-off).",
  NOT_ALLOWED: "Mengantar menolak akses dengan kunci gerai ini.",
  INPUT_INVALID: "Data pengiriman tidak memenuhi syarat Mengantar.",
  INPUT_INCOMPLETE: "Data pengiriman belum lengkap untuk Mengantar.",
  PICKUP_NOT_FOUND: "Alamat pickup outlet sudah tidak ada di akun Mengantar. Admin gerai perlu memilih ulang di Pengaturan.",
  PROVIDER_ERROR_ITEM: "Mengantar mencatat percobaan ini sebagai gagal.",
  NOT_CREATED: "Pemeriksaan tidak menemukan pesanan di Mengantar.",
  QUOTE_STALE: "Pesanan terlalu lama di antrean sehingga ongkirnya kedaluwarsa; tidak ada yang dikirim ke Mengantar.",
  CLOSED_NOT_CREATED: "Admin gerai menutup percobaan ini setelah memastikan tidak ada pesanan di Mengantar.",
};
