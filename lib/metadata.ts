import type { Metadata } from "next";

function configuredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const origin = configuredOrigin();

export const siteConfig = {
  name: "SDK",
  description:
    "Build a working SDK, test it, and launch a token paired with $SDK. A verified launch publishes the token-associated product. Community developers can submit reusable SDKs without minting.",
  url: origin,
  keywords: ["SDK", "$SDK", "token launch", "Solana", "SDK builder"],
} as const;

export const baseMetadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  robots: origin
    ? { index: true, follow: true }
    : { index: false, follow: false },
  ...(origin ? { alternates: { canonical: "/" } } : {}),
  openGraph: {
    type: "website",
    locale: "en_US",
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    ...(origin ? { url: origin } : {}),
  },
  twitter: {
    card: "summary",
    title: siteConfig.name,
    description: siteConfig.description,
  },
  manifest: "/site.webmanifest",
};

export function createMetadata({
  title,
  description = siteConfig.description,
  path = "/",
}: {
  title: string;
  description?: string;
  path?: string;
}): Metadata {
  const pageUrl = origin ? new URL(path, origin).toString() : null;
  return {
    title,
    description,
    ...(pageUrl ? { alternates: { canonical: path } } : {}),
    openGraph: {
      type: "website",
      locale: "en_US",
      title,
      description,
      siteName: siteConfig.name,
      ...(pageUrl ? { url: pageUrl } : {}),
    },
    twitter: { card: "summary", title, description },
  };
}
