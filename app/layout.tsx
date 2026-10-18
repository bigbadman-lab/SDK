import { Providers } from "@/components/providers";
import { SessionTouch } from "@/components/session-touch";
import { SkipToContent } from "@/components/skip-to-content";
import { ThemeSwitch } from "@/components/theme-switch";
import { baseMetadata } from "@/lib/metadata";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const displaySerif = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = baseMetadata;

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased [&_section[id]]:scroll-mt-23">
        <Providers>
          <SkipToContent />
          <SessionTouch />
          {children}
          <ThemeSwitch />
        </Providers>
      </body>
    </html>
  );
}
