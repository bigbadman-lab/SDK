import { BuilderIntro } from "@/components/builder-intro";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Journeys } from "@/components/journeys";
import { Reveal } from "@/components/reveal";
import { Scope } from "@/components/scope";
import { StructuredData } from "@/components/structured-data";
import { createMetadata, siteConfig } from "@/lib/metadata";
import { loadOfficialSdk } from "@/lib/server/sdk/official";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "SDK",
    description: siteConfig.description,
    path: "/",
  }),
  title: { absolute: "SDK" },
};

export default async function HomePage(): Promise<ReactNode> {
  const official = await loadOfficialSdk();
  const mint = official.ok && official.phase === "live" ? official.mint : null;

  return (
    <>
      <StructuredData />
      <span id="top" />
      <main id="main-content" className="scroll-mt-23">
        <Hero mint={mint} />
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
