import { Footer } from "@/components/footer";
import { PairedTerminal } from "@/components/launch/paired-terminal";
import { Nav } from "@/components/nav";
import { createMetadata } from "@/lib/metadata";
import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "Paired",
  description: "Verified child tokens paired with their parent. A TREST rehearsal is labelled as a test parent.",
  path: "/paired",
});

export default async function PairedPage(): Promise<ReactNode> {
  const loaded = await loadVerifiedLaunches();
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-8 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-4"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Paired</p>
            <h1 className="mt-1 text-[28px] leading-none tracking-[-0.6px] max-[561px]:text-[22px]">Verified pairs</h1>
          </div>
          <p className="hidden max-w-80 text-right text-[12px] leading-[1.45] text-muted-foreground min-[561px]:block">
            Click a mint to copy it. FDV, 24h volume, and holders refresh every 2 seconds.
          </p>
        </div>
        <div className="mt-3 max-[561px]:mt-2">
          {loaded.ok ? (
            <PairedTerminal
              launches={loaded.launches}
              empty="No verified child tokens yet. A prepared launch stays off this page until chain verification succeeds."
            />
          ) : (
            <p className="text-[14px] leading-[1.6] text-muted-foreground">Verified launches are unavailable.</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
