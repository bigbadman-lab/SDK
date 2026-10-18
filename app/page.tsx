import { BuilderIntro } from "@/components/builder-intro";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Journeys } from "@/components/journeys";
import { Nav } from "@/components/nav";
import { Reveal } from "@/components/reveal";
import { Scope } from "@/components/scope";
import { StructuredData } from "@/components/structured-data";
import { createMetadata, siteConfig } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  ...createMetadata({
    title: "SDK",
    description: siteConfig.description,
    path: "/",
  }),
  title: { absolute: "SDK" },
};

export default function HomePage(): ReactNode {
  return (
    <>
      <StructuredData />
      <span id="top" />
      <Nav />
      <main id="main-content" className="scroll-mt-23">
        <Hero />
        <BuilderIntro />
        <Reveal>
          <Journeys />
        </Reveal>
        <Reveal>
          <Scope />
        </Reveal>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
