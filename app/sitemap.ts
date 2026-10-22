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
      url: new URL("/build", siteConfig.url).toString(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: new URL("/library", siteConfig.url).toString(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: new URL("/paired", siteConfig.url).toString(),
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: new URL("/feed", siteConfig.url).toString(),
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: new URL("/account", siteConfig.url).toString(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: new URL("/code", siteConfig.url).toString(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
