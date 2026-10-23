import { Footer } from "@/components/footer";
import { SdkBoard } from "@/components/sdk/sdk-board";
import { createMetadata } from "@/lib/metadata";
import { holderMinimumLabel, nativeRewardSplit, windowLengthLabel } from "@/lib/sdk/rewards-copy";
import { loadOfficialMarket } from "@/lib/server/market/official";
import { loadHolderAllocations, loadOfficialSdk } from "@/lib/server/sdk/official";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "$SDK",
  description: "The native $SDK token, its live market figures, and SOL allocated to eligible holders.",
  path: "/sdk",
});

export default async function SdkPage(): Promise<ReactNode> {
  const official = await loadOfficialSdk();
  const live = official.ok && official.phase === "live" ? official : null;
  const market = live ? await loadOfficialMarket(live.mint) : null;
  const allocations = live ? await loadHolderAllocations(live.mint, null) : null;
  const split = nativeRewardSplit();
  const minutes = windowLengthLabel();
  const phase = official.ok ? official.phase : "unavailable";

  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-12 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-8"
      >
        <p className="font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Native token</p>
        <h1 className="mt-4 max-w-3xl font-display text-[48px] leading-[1.12] tracking-[-1.4px] text-balance max-[561px]:text-[34px]">
          $SDK — The Token Behind the SDK Ecosystem
        </h1>
        <div className="mt-6 max-w-2xl text-[16px] leading-[1.7] text-muted-foreground">
          <p>
            SDK is a platform for building, customising and launching working software as tokens on Solana. Developers can create SDKs using AI, remix existing tools or launch directly from our library.
          </p>
          <p className="mt-4">
            Every launched token is paired with $SDK, connecting developers, creators and applications through one native ecosystem.
          </p>
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
          rewardLead={
            (minutes
              ? `Every ${minutes} minutes, confirmed native $SDK creator fees are split.`
              : "Confirmed native $SDK creator fees are split on each allocation window.") +
            (split
              ? ` ${split.holders}% is allocated to eligible holders as claimable SOL, ${split.buyback}% is reserved for buyback, and ${split.deployer}% is retained by the protocol.`
              : "")
          }
          rewardQualify={`Wallets holding at least ${holderMinimumLabel()} $SDK qualify for SOL rewards, allocated proportionally to their eligible holdings.`}
        />
      </main>
      <Footer />
    </>
  );
}
