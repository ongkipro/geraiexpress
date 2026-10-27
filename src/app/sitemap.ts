import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://geraiexpress.com", changeFrequency: "weekly", priority: 1.0 },
    { url: "https://geraiexpress.com/fitur", changeFrequency: "monthly", priority: 0.8 },
    { url: "https://geraiexpress.com/simulasi", changeFrequency: "monthly", priority: 0.8 },
    { url: "https://geraiexpress.com/cara-kerja", changeFrequency: "monthly", priority: 0.8 },
    { url: "https://geraiexpress.com/hubungi-kami", changeFrequency: "monthly", priority: 0.7 },
  ];
}
