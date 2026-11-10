// T-086 / UX-20: every Bahasa Indonesia text of the case screens, in one module so the copy test
// (tests/unit/cases-copy.test.ts) can prove item 6: no case text, button or message promises
// compensation. Pure: no '@/' imports.

export type CaseType = "lost" | "damaged" | "late" | "return" | "other";
export type ClaimType = "return" | "full_value" | "other";
export type CaseState = "open" | "submitted" | "closed";
export type CaseOutcome = "compensated" | "rejected" | "return_received" | "other";
export type DecidedBy = "courier" | "mengantar";
export type CaseRegion = "java_sumatra_bali_ntb" | "other";

export const CASE_TYPES: readonly CaseType[] = ["lost", "damaged", "late", "return", "other"];
export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  lost: "Hilang", damaged: "Rusak", late: "Terlambat", return: "Retur", other: "Lainnya",
};
export const CLAIM_TYPES: readonly ClaimType[] = ["return", "full_value", "other"];
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  return: "Klaim retur",
  full_value: "Klaim nilai penuh (nilai COD atau nilai asuransi)",
  other: "Klaim lainnya",
};
export const CASE_STATE_LABEL: Record<CaseState, string> = {
  open: "Terbuka", submitted: "Diajukan ke Mengantar", closed: "Ditutup",
};
export const OUTCOMES: readonly CaseOutcome[] = ["compensated", "rejected", "return_received", "other"];
export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  compensated: "Diganti", rejected: "Ditolak", return_received: "Retur diterima", other: "Lainnya",
};
export const DECIDED_BY_LABEL: Record<DecidedBy, string> = { courier: "Kurir", mengantar: "Mengantar" };
export const REGIONS: readonly CaseRegion[] = ["java_sumatra_bali_ntb", "other"];
export const REGION_LABEL: Record<CaseRegion, string> = {
  java_sumatra_bali_ntb: "Tujuan di Jawa, Sumatra, Bali atau NTB",
  other: "Tujuan di wilayah lain",
};
export const UNIT_LABEL = { working_days: "hari kerja", days: "hari", hours: "jam" } as const;
export const ANCHOR_LABEL = { last_status: "status terakhir", delivered: "status terkirim", rts: "status retur (RTS)" } as const;

export const CASE_COPY = {
  listTitle: "Kasus",
  listIntro: "Retur dan klaim per paket. Klaim diajukan lewat Live Chat Mengantar (08.00–20.00 WIB); GeraiExpress hanya mencatat kasusnya.",
  filterOpen: "Terbuka",
  filterClosed: "Ditutup",
  emptyOpen: "Tidak ada kasus terbuka.",
  emptyClosed: "Belum ada kasus ditutup.",
  emptyHint: "Kasus dibuka dari detail pengiriman yang resinya sudah terbit.",
  decisionNote: "Keputusan ganti rugi ada pada kurir atau Mengantar.",
  noPromise: "GeraiExpress tidak menjanjikan hasil klaim. Hasil dicatat setelah ada keputusan.",
  processingInfo: "Informasi Mengantar: proses klaim paling lama 14 hari dan dana yang disetujui masuk ke Saldo Tersedia akun Mengantar. Ini informasi dari Mengantar, bukan janji GeraiExpress.",
  processingSource: "Sumber: bantuan Mengantar 5207011",
  exclusionsTitle: "Biasanya tidak dapat diklaim",
  exclusions: [
    "Kerusakan yang dilaporkan lebih dari 3 hari setelah paket diterima",
    "Tanpa video unboxing",
    "Cairan lebih dari 100 ml",
    "Tanaman hidup",
  ],
  exclusionsSource: "Sumber: bantuan Mengantar 6046101 (diperbarui 13 Mei 2026). Ketentuan bisa berubah; periksa di Mengantar.",
  openButton: "Buka kasus",
  openTitle: "Buka kasus",
  openSubmit: "Simpan kasus",
  updateButton: "Perbarui kasus",
  updateTitle: "Perbarui kasus",
  updateSubmit: "Simpan perubahan",
  closeButton: "Tutup kasus",
  closeTitle: "Tutup kasus",
  closeSubmit: "Konfirmasi tutup kasus",
  closeAdminOnly: "Hanya admin gerai yang dapat menutup kasus.",
  pending: "Menyimpan…",
  back: "Kembali",
  reload: "Muat ulang",
  caseTypeLegend: "Jenis kasus",
  claimTypeLabel: "Jenis klaim Mengantar",
  descriptionLabel: "Keterangan",
  descriptionHint: "Apa yang terjadi, kapan diketahui, dan apa yang sudah dilakukan (5–1000 karakter).",
  evidenceLabel: "Bukti (nama berkas atau tautan)",
  evidenceHint: "Satu per baris, maksimal 10. Unggah berkas belum tersedia; simpan berkasnya di tempat gerai.",
  ticketLabel: "Nomor tiket Mengantar (jika ada)",
  regionLabel: "Wilayah tujuan (untuk JNE)",
  regionNone: "Belum dipilih",
  anchorLabel: "Tanggal titik awal tenggat (WIB)",
  anchorHint: "Isi tanggal dan jam status di aplikasi Mengantar yang menjadi titik awal tenggat kurir ini. Dicatat sebagai data yang dimasukkan petugas.",
  stateLabel: "Status kasus",
  outcomeLegend: "Hasil",
  amountLabel: "Nilai yang diputuskan (Rp)",
  amountHint: "Isi sesuai keputusan kurir atau Mengantar.",
  decidedByLegend: "Diputuskan oleh",
  noteLabel: "Catatan penutupan (opsional)",
  deadlineTitle: "Tenggat pengajuan klaim",
  deadlineUnknown: "Tenggat tidak diketahui",
  deadlineNoRule: "Belum ada aturan tenggat untuk kurir dan jenis kasus ini.",
  deadlineNoAnchorEvent: "Sumber Mengantar tidak menyebut titik awal tenggat ini, jadi tanggalnya tidak dihitung.",
  deadlineNoAnchor: "Belum bisa dihitung: isi tanggal titik awal saat memperbarui kasus.",
  deadlineNeedsRegion: "Pilih wilayah tujuan untuk menghitung tenggat JNE.",
  deadlineWarning: "Tenggat hampir habis (lebih dari 80% waktu terpakai).",
  deadlineOverdue: "Tenggat sudah lewat menurut perhitungan ini. Tanyakan ke Mengantar sebelum mengajukan.",
  workingDaysNote: "Hari kerja dihitung Senin–Jumat; hari libur nasional belum diperhitungkan karena kalender libur belum diatur.",
  anchorEnteredByStaff: "dimasukkan petugas",
  lostSuggestionDeferred: "Saran kasus otomatis dari status Hilang akan tersedia setelah status kurir diterima otomatis.",
  returnBadge: "Retur",
  openCaseBadge: "Kasus terbuka",
  returnRule: "Paket retur kembali ke alamat jemput (pickup) di Mengantar, bukan ke pengirim yang tercetak pada label masking. Alamat retur khusus hanya berlaku bila asal dan tujuan sama-sama di Pulau Jawa (JNE, SiCepat, SAP).",
  attentionTitle: "Retur dan kasus",
  unknownResult: "Hasil penyimpanan kasus belum pasti. Muat ulang halaman untuk memeriksa status kasus sebelum mencoba lagi.",
  checkFields: "Periksa isian yang ditandai.",
  saved: "Kasus disimpan.",
  updated: "Kasus diperbarui.",
  closed: "Kasus ditutup.",
} as const;

const CASE_ERRORS: Record<string, string> = {
  not_found: "Kasus atau pengiriman tidak ditemukan, atau Anda tidak memiliki akses.",
  admin_required: "Hanya admin gerai yang dapat menutup kasus.",
  case_type_invalid: "Pilih jenis kasus.",
  claim_type_invalid: "Pilih jenis klaim Mengantar.",
  description_required: "Tuliskan keterangan (5–1000 karakter).",
  evidence_invalid: "Bukti maksimal 10 baris, masing-masing paling panjang 300 karakter.",
  ticket_invalid: "Nomor tiket paling panjang 80 karakter.",
  region_invalid: "Pilih wilayah tujuan.",
  anchor_invalid: "Tanggal titik awal tidak valid atau masih di masa depan.",
  state_invalid: "Pilih status kasus.",
  case_not_allowed: "Kasus hanya bisa dibuka untuk pengiriman yang resinya sudah terbit.",
  case_open_exists: "Pengiriman ini sudah punya kasus yang belum ditutup. Perbarui kasus itu.",
  case_closed: "Kasus sudah ditutup. Muat ulang untuk melihat hasilnya.",
  case_changed: "Kasus ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru.",
  outcome_required: "Pilih hasil.",
  decided_amount_required: "Isi nilai yang diputuskan dalam rupiah, lebih dari nol.",
  decided_amount_invalid: "Nilai hanya diisi bila hasilnya Diganti.",
  decided_by_required: "Pilih siapa yang memutuskan.",
  decided_by_invalid: "Pilih kurir atau Mengantar.",
  note_invalid: "Catatan paling panjang 500 karakter.",
};
export const caseError = (error: { message?: string | null }) => CASE_ERRORS[error.message ?? ""] ?? CASE_COPY.unknownResult;
export const CASE_ERROR_TEXTS: readonly string[] = Object.values(CASE_ERRORS);

// UX-20 item 6: words that would promise compensation. Checked by the copy test against every text
// above and the case components' literal strings.
// "belum pasti" (an uncertain save result) is not a promise, so the bare word is not listed.
export const FORBIDDEN_PROMISE_WORDS: readonly RegExp[] = [
  /dijamin/i, /\bjamin/i, /garansi/i, /pasti\s+(diganti|cair|dibayar|disetujui|dapat|kembali)/i,
  /uang\s+kembali/i, /100\s*%/, /ganti\s+rugi\s+penuh/i, /akan\s+diganti/i,
];
// UX-20 item 6: no amount before an outcome is recorded. A rupiah figure in fixed copy is an amount.
export const RUPIAH_AMOUNT = /Rp\s*\d/i;
