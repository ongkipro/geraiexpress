import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami"],
      disallow: [
        "/pengiriman",
        "/kontak",
        "/pengaturan",
        "/anggota",
        "/admin",
        "/api",
        "/masuk",
        "/daftar",
        "/undangan",
        "/verifikasi-2fa",
        "/akses",
        "/pilih-gerai",
      ],
    },
    sitemap: "https://geraiexpress.com/sitemap.xml",
  };
}
