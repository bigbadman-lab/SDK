import { Footer } from "@/components/footer";
import { TokenExperience } from "@/components/launch/token-experience";
import { Nav } from "@/components/nav";
import { createMetadata, siteConfig } from "@/lib/metadata";
import { launchByMint } from "@/lib/launch/verified-launch";
import { loadPublishedTokenSdk, loadVerifiedLaunches } from "@/lib/server/launch/discover";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  if (!MINT.test(mint)) return createMetadata({ title: "Token", path: "/paired" });
  const loaded = await loadVerifiedLaunches({ mint });
  const launch = loaded.ok ? launchByMint(loaded.launches, mint) : null;
  return createMetadata({
    title: launch ? launch.name : "Token",
    description: launch
      ? `${launch.name} is paired with ${launch.pairLabel}.`
      : "Verified child token.",
    path: `/token/${mint}`,
  });
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<ReactNode> {
  const { mint } = await params;
  if (!MINT.test(mint)) notFound();
  const loaded = await loadVerifiedLaunches({ mint });
  if (!loaded.ok) {
    return (
      <>
        <Nav />
        <main id="main-content" className="mx-auto w-[min(760px,calc(100%-48px))] pt-16 pb-22 max-[561px]:w-[calc(100%-32px)]">
          <p className="text-[15px] leading-[1.7] text-muted-foreground">This token page is unavailable.</p>
        </main>
        <Footer />
      </>
    );
  }
  const launch = launchByMint(loaded.launches, mint);
  if (!launch) notFound();
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-10 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-6"
      >
        <TokenExperience launch={launch} sdk={await loadPublishedTokenSdk(launch.librarySdkId)} baseUrl={siteConfig.url ?? "https://sdk.fund"} />
      </main>
      <Footer />
    </>
  );
}
