import { BuilderIntro } from "@/components/builder-intro";
import { Ecosystem } from "@/components/home/ecosystem";
import { HowItWorks } from "@/components/home/how-it-works";
import { LaunchShowcase } from "@/components/home/launch-showcase";
import { LibraryShowcase } from "@/components/home/library-showcase";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { StructuredData } from "@/components/structured-data";
import { createMetadata, siteConfig } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const description = siteConfig.description;

export const metadata: Metadata = {
  ...createMetadata({
    title: "SDK",
    description,
    path: "/",
  }),
  title: { absolute: "SDK" },
};

export default function HomePage(): ReactNode {
  return (
    <>
      <StructuredData description={description} />
      <span id="top" />
      <main id="main-content" className="scroll-mt-23">
        <Hero />
        <BuilderIntro />
        <LibraryShowcase />
        <HowItWorks />
        <LaunchShowcase />
        <Ecosystem />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
