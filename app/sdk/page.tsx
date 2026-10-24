import { Footer } from "@/components/footer";
import { SdkBoard } from "@/components/sdk/sdk-board";
import { createMetadata } from "@/lib/metadata";
import { holderMinimumLabel, nativeRewardLead } from "@/lib/sdk/rewards-copy";
import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadRehearsalSdk } from "@/lib/server/sdk/rehearsal";
import { loadHolderAllocations, loadOfficialSdk } from "@/lib/server/sdk/official";
import { readSdkRouteScope } from "@/lib/sdk/rehearsal";
import { TREST_MINT } from "@/lib/launch/verified-launch";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "$SDK",
  description: "Every token launched through SDK pairs with the native $SDK token, connecting software, developers and launches across the platform.",
  path: "/sdk",
});

export default async function SdkPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const scope = readSdkRouteScope(query.scope);
  if (scope === null) {
    return (
      <>
        <main id="main-content" className="mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-12 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-8">
          <h1 className="font-display text-[48px] leading-[1.12] tracking-[-1.4px] max-[561px]:text-[34px]">This view is not available.</h1>
        </main>
        <Footer />
      </>
    );
  }
  if (scope === "test") return <RehearsalSdkPage />;
  const official = await loadOfficialSdk();
  const live = official.ok && official.phase === "live" ? official : null;
  const market = live ? await loadOfficialMarket(live.mint) : null;
  const allocations = live ? await loadHolderAllocations(live.mint, null) : null;
  const phase = official.ok ? official.phase : "unavailable";

  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-12 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-8"
      >
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Native token</p>
        <h1 className="mt-4 max-w-3xl font-display text-[48px] leading-[1.12] tracking-[-1.4px] text-balance max-[561px]:text-[34px]">
          $SDK powers the ecosystem.
        </h1>
        <div className="mt-6 max-w-2xl text-[16px] leading-[1.7] text-muted-foreground">
          <p>
            Every token launched through SDK pairs with the native $SDK token, connecting software, developers and launches across the platform.
          </p>
          <p className="mt-4">Build, publish and launch working software within one connected Solana ecosystem.</p>
        </div>
        <SdkBoard
          phase={phase}
          mint={live?.mint ?? null}
          decimals={live?.decimals ?? null}
          market={market && market.ok ? { updatedAt: market.updatedAt, quote: market.quote } : null}
          summary={allocations && allocations.ok ? allocations.summary : null}
          rows={allocations && allocations.ok ? allocations.rows : []}
          nextCursor={allocations && allocations.ok ? allocations.nextCursor : null}
          rewardsOk={phase !== "live" || (allocations?.ok ?? false)}
          rewardLead={nativeRewardLead()}
          rewardQualify={`Wallets holding at least ${holderMinimumLabel()} $SDK qualify for SOL rewards, allocated proportionally to their eligible holdings.`}
        />
      </main>
      <Footer />
    </>
  );
}

async function RehearsalSdkPage(): Promise<ReactNode> {
  const rehearsal = await loadRehearsalSdk();
  const live = rehearsal.ok && rehearsal.phase === "live" ? rehearsal : null;
  const market = live ? await loadOfficialMarket(live.mint) : null;
  const allocations = live ? await loadHolderAllocations(live.mint, null, "test") : null;
  const phase = rehearsal.ok ? (live ? "live" : "unavailable") : "unavailable";
  const notice = live
    ? null
    : rehearsal.ok
      ? "The TREST rehearsal parent is not registered."
      : "TREST rehearsal data could not be read.";

  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-12 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-8"
      >
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Mainnet rehearsal</p>
        <h1 className="mt-4 max-w-3xl font-display text-[48px] leading-[1.12] tracking-[-1.4px] text-balance max-[561px]:text-[34px]">
          $TREST — Mainnet Rehearsal
        </h1>
        <div className="mt-6 max-w-2xl text-[16px] leading-[1.7] text-muted-foreground">
          <p>This rehearsal uses the existing $TREST parent on Solana mainnet. It is separate from the official $SDK mint.</p>
          <p className="mt-4 font-mono text-[13px] break-all text-foreground">{live?.mint ?? TREST_MINT}</p>
        </div>
        <SdkBoard
          phase={phase}
          mint={live?.mint ?? null}
          decimals={live?.decimals ?? null}
          market={market && market.ok ? { updatedAt: market.updatedAt, quote: market.quote } : null}
          summary={allocations && allocations.ok ? allocations.summary : null}
          rows={allocations && allocations.ok ? allocations.rows : []}
          nextCursor={allocations && allocations.ok ? allocations.nextCursor : null}
          rewardsOk={phase !== "live" || (allocations?.ok ?? false)}
          tokenSymbol="$TREST"
          rewardLead={nativeRewardLead("$TREST")}
          rewardQualify={`Wallets holding at least ${holderMinimumLabel()} $TREST qualify for SOL rewards, allocated proportionally to their eligible holdings.`}
          scope="test"
          notice={notice}
          figures={live?.figures ?? null}
          historical={live?.historical ?? null}
        />
      </main>
      <Footer />
    </>
  );
}
