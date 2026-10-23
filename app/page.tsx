import { BuilderIntro } from "@/components/builder-intro";
import { Ecosystem } from "@/components/home/ecosystem";
import { HowItWorks } from "@/components/home/how-it-works";
import { LaunchShowcase } from "@/components/home/launch-showcase";
import { LibraryShowcase } from "@/components/home/library-showcase";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Reveal } from "@/components/reveal";
import { StructuredData } from "@/components/structured-data";
import { createMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const description =
  "Create working SDKs with AI, remix existing tools, or bring your own code. Turn software into token-powered applications on Solana, all paired with $SDK.";

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
        <Reveal>
          <HowItWorks />
        </Reveal>
        <LaunchShowcase />
        <Reveal>
          <Ecosystem />
        </Reveal>
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
