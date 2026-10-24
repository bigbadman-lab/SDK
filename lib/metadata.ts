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
    "Create working SDKs with AI, remix existing tools, or bring your own code. Turn software into token-powered applications on Solana, all paired with $SDK.",
  url: origin,
  keywords: ["SDK", "$SDK", "Solana", "AI Builder", "SDK Library", "token launch", "developer tools"],
  ogImage: "/images/sdkmeta.jpg",
  icon: "/images/sdkpair.png",
} as const;

const ogImage = {
  url: siteConfig.ogImage,
  width: 1200,
  height: 630,
  alt: "Build Anything.",
  type: "image/jpeg",
} as const;

const icons: Metadata["icons"] = {
  icon: [{ url: siteConfig.icon, type: "image/png", sizes: "1080x1080" }],
  shortcut: [siteConfig.icon],
  apple: [{ url: siteConfig.icon, type: "image/png", sizes: "1080x1080" }],
};

function socialTitle(title: string): string {
  return title === siteConfig.name ? title : `${title} | ${siteConfig.name}`;
}

function openGraph(title: string, description: string, url: string | null): Metadata["openGraph"] {
  return {
    type: "website",
    locale: "en_US",
    siteName: siteConfig.name,
    title,
    description,
    images: [ogImage],
    ...(url ? { url } : {}),
  };
}

function twitter(title: string, description: string): Metadata["twitter"] {
  return {
    card: "summary_large_image",
    title,
    description,
    images: [siteConfig.ogImage],
  };
}

export const baseMetadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.name, url: origin ?? undefined }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "technology",
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, email: false, address: false },
  robots: origin
    ? {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          "max-video-preview": -1,
        },
      }
    : { index: false, follow: false },
  ...(origin ? { alternates: { canonical: "/" } } : {}),
  openGraph: openGraph(siteConfig.name, siteConfig.description, origin),
  twitter: twitter(siteConfig.name, siteConfig.description),
  icons,
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
  const social = socialTitle(title);
  return {
    title,
    description,
    ...(pageUrl ? { alternates: { canonical: path } } : {}),
    openGraph: openGraph(social, description, pageUrl),
    twitter: twitter(social, description),
  };
}
