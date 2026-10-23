import { Footer } from "@/components/footer";
import type { ReactNode } from "react";

function Bar({ className }: { className: string }): ReactNode {
  return <span className={`block motion-safe:animate-pulse bg-muted ${className}`} />;
}

export function PairedHeader(): ReactNode {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Paired</p>
        <h1 className="mt-1 text-[28px] leading-none tracking-[-0.6px] max-[561px]:text-[22px]">Verified pairs</h1>
      </div>
      <p className="hidden max-w-80 text-right text-[12px] leading-[1.45] text-muted-foreground min-[561px]:block">
        Click a mint to copy it. FDV, 24h volume, and holders refresh every 2 seconds.
      </p>
    </div>
  );
}

export function PairedRowsSkeleton(): ReactNode {
  return (
    <div aria-busy="true">
      <p className="sr-only">Loading verified pairs</p>
      <ul className="border-t border-border">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="flex items-center gap-3 border-b border-border py-2.5">
            <Bar className="h-8 w-8 shrink-0" />
            <Bar className="h-3.5 w-36" />
            <Bar className="ml-auto h-3 w-14" />
            <Bar className="h-3 w-12" />
            <Bar className="hidden h-3 w-8 min-[801px]:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

const LAUNCH_STEPS = [
  {
    index: "01",
    title: "Choose your SDK",
    body: "Select one of your tested SDKs or start with a published SDK from the Library.",
  },
  {
    index: "02",
    title: "Create your token",
    body: "Add your token's name, ticker, description and artwork.",
  },
  {
    index: "03",
    title: "Review and launch",
    body: "Check your token details, $SDK pairing and applicable fees before approving the transaction in your wallet.",
  },
] as const;

export function LaunchIntro(): ReactNode {
  return (
    <>
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Token launchpad</p>
      <h1 className="mt-3 font-display text-[48px] leading-[1.08] tracking-[-1.4px] max-[561px]:text-[36px]">
        Launch your next token.
      </h1>
      <p className="mt-4 max-w-150 text-[16px] leading-[1.6] text-muted-foreground">
        Turn a working SDK into a token-powered application on Solana. Choose your software, customise your token and launch it paired with $SDK.
      </p>
      <ol className="mt-8 grid gap-3">
        {LAUNCH_STEPS.map((step) => (
          <li key={step.index} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border border-solid border-border bg-card px-4 py-4">
            <span className="font-mono text-[10px] text-accent-ink">{step.index}</span>
            <div className="min-w-0">
              <h2 className="text-[16px] leading-[1.3]">{step.title}</h2>
              <p className="mt-1 text-[14px] leading-[1.55] text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

export function LaunchBodySkeleton(): ReactNode {
  return (
    <div className="mt-3" aria-busy="true">
      <p className="sr-only">Preparing your launch options</p>
      <Bar className="h-4 w-full max-w-120" />
      <Bar className="mt-8 h-3 w-16" />
      <Bar className="mt-3 h-24 w-full" />
      <Bar className="mt-8 h-3 w-20" />
      <Bar className="mt-3 h-10 w-full" />
      <Bar className="mt-3 h-20 w-full" />
    </div>
  );
}

export function TokenPageSkeleton(): ReactNode {
  return (
    <div className="grid gap-8 min-[801px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[801px]:gap-10" aria-busy="true">
      <p className="sr-only">Loading token</p>
      <div>
        <div className="flex items-center gap-3">
          <Bar className="h-14 w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <Bar className="h-7 w-40" />
            <Bar className="mt-2 h-3 w-28" />
          </div>
        </div>
        <Bar className="mt-4 h-3 w-full" />
        <div className="mt-4 grid grid-cols-3 gap-2 border-y border-border py-3">
          <Bar className="h-8" />
          <Bar className="h-8" />
          <Bar className="h-8" />
        </div>
        <Bar className="mt-4 h-[280px] w-full max-[561px]:h-[220px]" />
      </div>
      <div>
        <Bar className="h-3 w-24" />
        <Bar className="mt-3 h-6 w-48" />
        <Bar className="mt-4 h-16 w-full" />
        <Bar className="mt-4 h-28 w-full" />
      </div>
    </div>
  );
}

const pairedMain = "mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-8 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-4";
const launchMain = "mx-auto w-[min(680px,calc(100%-48px))] scroll-mt-23 pt-12 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-8";
const tokenMain = "mx-auto w-[min(980px,calc(100%-48px))] scroll-mt-23 pt-10 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-24px)] max-[561px]:pt-6";

export function PairedLoading(): ReactNode {
  return (
    <>
      <main id="main-content" className={pairedMain}>
        <PairedHeader />
        <div className="mt-3 max-[561px]:mt-2">
          <PairedRowsSkeleton />
        </div>
      </main>
      <Footer />
    </>
  );
}

export function LaunchLoading(): ReactNode {
  return (
    <>
      <main id="main-content" className={launchMain}>
        <LaunchIntro />
        <LaunchBodySkeleton />
      </main>
      <Footer />
    </>
  );
}

export function TokenLoading(): ReactNode {
  return (
    <>
      <main id="main-content" className={tokenMain}>
        <TokenPageSkeleton />
      </main>
      <Footer />
    </>
  );
}
