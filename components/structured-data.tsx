import { siteConfig } from "@/lib/metadata";
import type { ReactNode } from "react";

export function StructuredData({ description = siteConfig.description }: { description?: string }): ReactNode {
  if (!siteConfig.url) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    description,
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
