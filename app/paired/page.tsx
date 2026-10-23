import { Footer } from "@/components/footer";
import { PairedHeader, PairedRowsSkeleton } from "@/components/launch/page-skeletons";
import { PairedTerminal } from "@/components/launch/paired-terminal";
import { createMetadata } from "@/lib/metadata";
import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import { Suspense, type ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "Paired",
  description: "Verified child tokens paired with their parent. A TREST rehearsal is labelled as a test parent.",
  path: "/paired",
});

const mainClass = "mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-8 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-4";

export default function PairedPage(): ReactNode {
  return (
    <>
      <main id="main-content" className={mainClass}>
        <PairedHeader />
        <div className="mt-3 max-[561px]:mt-2">
          <Suspense fallback={<PairedRowsSkeleton />}>
            <PairedResults />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}

async function PairedResults(): Promise<ReactNode> {
  const loaded = await loadVerifiedLaunches();
  if (!loaded.ok) {
    return <p className="text-[14px] leading-[1.6] text-muted-foreground">Verified launches are unavailable.</p>;
  }
  return (
    <PairedTerminal
      launches={loaded.launches}
      empty="No verified child tokens yet. A prepared launch stays off this page until chain verification succeeds."
    />
  );
}
