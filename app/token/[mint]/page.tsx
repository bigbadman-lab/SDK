import { Footer } from "@/components/footer";
import { TokenPageSkeleton } from "@/components/launch/page-skeletons";
import { TokenExperience } from "@/components/launch/token-experience";
import { TokenSdkPanel } from "@/components/launch/token-sdk-panel";
import { createMetadata } from "@/lib/metadata";
import { launchByMint } from "@/lib/launch/verified-launch";
import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const mainClass = "mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-10 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-6";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  if (!MINT.test(mint)) return createMetadata({ title: "Token", path: "/paired" });
  const loaded = await loadVerifiedLaunches({ mint });
  const launch = loaded.ok ? launchByMint(loaded.launches, mint) : null;
  if (!launch) return createMetadata({ title: "Token", description: "This token page is not available.", path: "/paired" });
  return createMetadata({
    title: launch.name,
    description: `${launch.name} is paired with ${launch.pairLabel}.`,
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
  if (loaded.ok && !launchByMint(loaded.launches, mint)) notFound();
  return (
    <>
      <main id="main-content" className={mainClass}>
        <Suspense fallback={<TokenPageSkeleton />}>
          <TokenPageBody params={params} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function TokenPageBody({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<ReactNode> {
  const { mint } = await params;
  if (!MINT.test(mint)) notFound();
  const loaded = await loadVerifiedLaunches({ mint });
  if (!loaded.ok) {
    return <p className="text-[15px] leading-[1.7] text-muted-foreground">This token page is unavailable.</p>;
  }
  const launch = launchByMint(loaded.launches, mint);
  if (!launch) notFound();
  return (
    <div className="grid gap-8 min-[801px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[801px]:gap-10">
      <TokenExperience launch={launch} />
      {await TokenSdkPanel({ librarySdkId: launch.librarySdkId, sdkName: launch.sdkName })}
    </div>
  );
}
