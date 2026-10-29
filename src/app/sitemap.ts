import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/marketing-data";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_ORIGIN, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_ORIGIN}/fitur`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_ORIGIN}/simulasi`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_ORIGIN}/cara-kerja`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_ORIGIN}/hubungi-kami`, changeFrequency: "monthly", priority: 0.7 },
  ];
}
