import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteConfig.url) return [];
  return [
    { url: siteConfig.url, changeFrequency: "monthly", priority: 1 },
    {
      url: new URL("/about", siteConfig.url).toString(),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: new URL("/account", siteConfig.url).toString(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
