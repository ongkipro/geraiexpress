// The one counter sequence shown on the home page and on /cara-kerja, so both pages name the same
// steps in the same order (drop-off only at this release, PR-35).
export const COUNTER_STEPS = [
  {
    title: "Isi data pengirim dan penerima",
    text: "Pilih dari kontak tersimpan atau ketik baru. Pelanggan langganan tidak perlu mengetik ulang dari awal.",
    example: "Contoh: penerima Ibu Contoh, Coblong, Kota Bandung.",
  },
  {
    title: "Masukkan berat dan cek tarif",
    text: "Masukkan berat paket. Tarif beberapa kurir tampil berdampingan untuk dipilih pelanggan.",
    example: "Contoh: paket 1 kg ke Kota Bandung.",
  },
  {
    title: "Konfirmasi kiriman",
    text: "Periksa ringkasan kiriman dan kurir pilihan, lalu konfirmasi. Pesanan baru dikirim ke Mengantar setelah konfirmasi.",
    example: "Contoh: ringkasan tampil sebelum konfirmasi.",
  },
  {
    title: "Serahkan paket (drop-off)",
    text: "Versi ini melayani drop-off: paket diserahkan oleh gerai ke kurir. Resi tercatat di halaman kiriman.",
    example: "Contoh: resi tercatat di halaman kiriman.",
  },
] as const;
