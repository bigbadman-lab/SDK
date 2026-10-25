import { ContractBadge } from "@/components/contract-badge";
import { HomeLink } from "@/components/home/chrome";
import { loadOfficialSdk } from "@/lib/server/sdk/official";
import { Suspense, type ReactNode } from "react";

export function Hero(): ReactNode {
  return (
    <section
      className="mx-auto w-[min(1100px,_calc(100%_-_48px))] pt-[clamp(24px,_calc(12svh_-_64px),_112px)] pb-[clamp(32px,_calc(10svh_-_40px),_96px)] text-center max-[800px]:w-[calc(100%_-_40px)] max-[800px]:pt-[clamp(24px,_calc(12svh_-_64px),_76px)] max-[800px]:pb-[clamp(32px,_calc(10svh_-_40px),_64px)] max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-[clamp(16px,_calc(12svh_-_64px),_56px)] max-[561px]:pb-[clamp(16px,_calc(10svh_-_40px),_48px)] [&_h1]:mx-auto [&_h1]:mt-[clamp(20px,_3svh,_36px)] [&_h1]:mb-[clamp(16px,_2.4svh,_24px)] [&_h1]:max-w-205 [&_h1]:font-display [&_h1]:text-[80px] [&_h1]:leading-[1.13] [&_h1]:tracking-[-2.8px] [&_h1]:text-balance max-[800px]:[&_h1]:mt-[clamp(20px,_3svh,_32px)] max-[800px]:[&_h1]:text-[62px] max-[800px]:[&_h1]:leading-[1.15] max-[800px]:[&_h1]:tracking-[-2px] max-[561px]:[&_h1]:mt-[clamp(16px,_2.8svh,_28px)] max-[561px]:[&_h1]:max-w-110 max-[561px]:[&_h1]:text-[clamp(34px,_9.9vw,_55px)] max-[561px]:[&_h1]:leading-[1.18] max-[561px]:[&_h1]:tracking-[-1.5px] [&_h1_em]:font-normal [&_h1_em]:text-accent-ink"
      aria-labelledby="hero-title"
    >
      <div>
        <Suspense fallback={<ContractBadgeFallback />}>
          <OfficialContract />
        </Suspense>
      </div>
      <h1 id="hero-title">
        Build software.
        <br />
        <em>Launch on Solana.</em>
      </h1>
      <p className="mx-auto max-w-185 text-[20px] leading-[30px] text-muted-foreground max-[800px]:text-[17px] max-[800px]:leading-[27px] max-[561px]:max-w-87.5 max-[561px]:text-[15px] max-[561px]:leading-[24px]">
        Create working SDKs with AI, remix existing tools, or bring your own code. Turn software into
        token-powered applications on Solana, all paired <span className="whitespace-nowrap">with $SDK.</span>
      </p>
      <div className="mt-[clamp(20px,_2.8svh,_42px)] flex flex-wrap justify-center gap-4 max-[800px]:mt-[clamp(20px,_2.8svh,_32px)] max-[561px]:mt-[clamp(16px,_2.8svh,_28px)] max-[561px]:gap-2.5">
        <HomeLink href="/build" tone="primary">
          Start Building
        </HomeLink>
        <HomeLink href="/library" tone="secondary">
          Explore Library
        </HomeLink>
      </div>
    </section>
  );
}

async function OfficialContract(): Promise<ReactNode> {
  const official = await loadOfficialSdk();
  const mint = official.ok && official.phase === "live" ? official.mint : null;
  return <ContractBadge mint={mint} />;
}

function ContractBadgeFallback(): ReactNode {
  return <span className="inline-block h-8 w-44 motion-safe:animate-pulse bg-muted" aria-hidden="true" />;
}
