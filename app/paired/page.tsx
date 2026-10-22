import { Footer } from "@/components/footer";
import { VerifiedLaunchList } from "@/components/launch/verified-list";
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
        className="mx-auto w-[min(760px,calc(100%-48px))] scroll-mt-23 pt-16 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Paired</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.08] tracking-[-1.6px] max-[561px]:text-[38px]">
          Verified launches.
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">
          A child appears here after its launch transaction is confirmed and the recorded mint, parent, metadata, and fee shares match. A rehearsal parent is shown as $TREST. It is not an official $SDK market.
        </p>
        <div className="mt-8">
          {loaded.ok ? (
            <VerifiedLaunchList
              launches={loaded.launches}
              empty="No verified child tokens yet. A prepared launch stays off this page until chain verification succeeds."
            />
          ) : (
            <p className="text-[15px] leading-[1.7] text-muted-foreground">Verified launches are unavailable.</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
