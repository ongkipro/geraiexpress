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
  admin_required: "Hanya admin gerai yang dapat melakukan tindakan ini.",
  platform_access_required: "Akses Super Admin dengan verifikasi dua langkah diperlukan.",
  reason_required: "Tuliskan alasan (5–500 karakter).",
  stale_state: "Data sudah berubah sejak halaman dibuka. Muat ulang lalu coba lagi.",
  transition_not_allowed: "Perubahan status ini tidak diizinkan.",
  last_access_governor: "Harus tersisa minimal satu admin tata kelola akses yang sudah memasang autentikator.",
  user_not_found: "Tidak ada akun terverifikasi dengan email itu.",
  registration_closed: "Pendaftaran gerai baru sedang ditutup.",
  verified_identity_required: "Verifikasi email Anda terlebih dahulu.",
  application_locked: "Pengajuan sedang ditinjau atau sudah selesai, jadi tidak bisa diubah.",
  incomplete_application: "Lengkapi semua data gerai sebelum mengajukan.",
  own_application: "Pengajuan Anda sendiri harus ditinjau Super Admin lain.",
  demo_restricted: "Fitur ini tidak tersedia di demo.",
  already_member: "Email ini sudah menjadi anggota gerai.",
  already_invited: "Email ini sudah punya undangan yang masih berlaku.",
  invitation_unavailable: "Undangan ini sudah tidak berlaku. Minta admin gerai mengirim undangan baru.",
  last_tenant_admin: "Gerai harus tetap punya minimal satu admin gerai aktif.",
  invalid_partner_id: "Partner ID hanya boleh berisi huruf, angka, titik, garis bawah dan tanda hubung.",
  too_many_invitations: "Terlalu banyak undangan yang masih menunggu. Cabut yang tidak dipakai dulu.",
  demo_requires_anonymous_session: "Mode demo hanya untuk sesi demo.",
  invalid_input: "Periksa kembali isian yang ditandai.",
  // T-023 live Mengantar (raised by the Worker, not the database).
  mengantar_not_configured: "Koneksi Mengantar di server belum disiapkan. Hubungi admin GeraiExpress.",
  mengantar_no_key: "Akun Mengantar gerai ini belum terhubung. Admin gerai bisa menyimpan kunci API di Pengaturan.",
  mengantar_key_unreadable: "Kunci API Mengantar tersimpan tidak bisa dipakai. Admin gerai perlu menyimpannya ulang di Pengaturan.",
  mengantar_unavailable: "Mengantar sedang tidak bisa dihubungi. Coba lagi sebentar lagi.",
  mengantar_key_refused: "Mengantar menolak akses dengan kunci ini (kunci salah atau server belum diizinkan). Periksa kunci di akun Mengantar, lalu simpan lagi.",
  area_required: "Pilih wilayah penerima dari hasil pencarian Mengantar sebelum konfirmasi.",
  not_closable: "Belum bisa ditutup: tunggu minimal 30 menit sejak dikirim dan periksa lagi di Mengantar terlebih dahulu.",
  goods_value_required: "Isi nilai barang (minimal Rp1) sebelum menerbitkan resi Mengantar.",
  tenant_not_active: "Gerai ini sedang tidak aktif, jadi resi tidak bisa diterbitkan.",
  not_reopenable: "Pengiriman ini tidak bisa dibuka lagi karena Mengantar mungkin sudah membuat pesanannya.",
  nothing_to_dispatch: "Tidak ada pesanan yang menunggu dikirim.",
  nothing_to_check: "Tidak ada pembayaran yang perlu diperiksa.",
  mengantar_data_unreadable: "Data dari Mengantar tidak bisa dibaca. Coba lagi; jika berulang, hubungi admin GeraiExpress.",
  mengantar_refused: "Mengantar menolak permintaan ini. Periksa wilayah, berat dan alamat pickup.",
  pickup_not_set: "Alamat pickup Mengantar outlet ini belum dipilih. Admin gerai bisa memilihnya di Pengaturan.",
  pickup_not_found: "Alamat pickup itu tidak ditemukan di akun Mengantar gerai ini. Muat ulang lalu pilih lagi.",
  // T-025 COD & T-026 batch payment recovery
  cod_not_supported: "Layanan kurir ini tidak mendukung pengiriman COD ke wilayah tujuan.",
  cod_goods_value_required: "Isi nilai barang minimal Rp1.000 untuk pengiriman COD.",
  batch_not_payable: "Batch pembayaran ini belum siap atau tidak memiliki pesanan yang menunggu pembayaran.",
  batch_scope_mismatch: "Batch Mengantar ini memuat pesanan di luar gerai ini atau data yang belum dikenali. Periksa langsung di aplikasi Mengantar.",
  batch_digest_mismatch: "Rincian batch pembayaran berubah sejak Anda meninjaunya. Muat ulang lalu tinjau kembali.",
  courier_discontinued: "Layanan kurir ini sudah dihentikan dan tidak dapat dibayar melalui API. Hubungi dukungan Mengantar.",
  // T-027 Partner seller onboarding
  consent_required: "Centang persetujuan kepemilikan akun dan Ketentuan/Privasi Mengantar terlebih dahulu.",
  partner_not_configured: "Pendaftaran Partner Mengantar di server belum disiapkan. Gunakan opsi kunci API sendiri (BYOK) atau hubungi admin.",
  partner_email_registered: "Email ini sudah terdaftar di Mengantar. Masuk ke Mengantar untuk menyalin kunci API, lalu hubungkan lewat formulir Kunci API sendiri di bawah.",
  partner_key_pending: "Akun Mengantar berhasil dibuat, tetapi kunci API sedang disiapkan. Klik Ambil Kunci API untuk melanjutkan.",
  partner_rate_limited: "Batas permintaan pendaftaran Mengantar tercapai. Tunggu beberapa saat lalu coba lagi.",
  partner_restricted: "Akun penjual atau akses Partner dibatasi oleh Mengantar. Hubungi dukungan Mengantar.",
  already_partner_connected: "Gerai ini sudah memiliki akun penjual Mengantar yang terdaftar.",
  // T-028 Contact archive
  contact_already_archived: "Kontak ini sudah diarsipkan.",
};

export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Terjadi kesalahan. Coba lagi.";
  if (error.message && MESSAGES[error.message]) return MESSAGES[error.message];
  if (error.code === "23514" || error.code === "22P02") return "Periksa kembali isian yang ditandai.";
  if (error.code === "42501") return "Anda tidak memiliki izin untuk tindakan ini.";
  return "Terjadi kesalahan. Coba lagi.";
}
