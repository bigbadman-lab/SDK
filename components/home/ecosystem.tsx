import { HomeCopy, HomeEyebrow, HomeHeading, HomeLink, homeFrame } from "@/components/home/chrome";
import { holderMinimumLabel, nativeRewardLead } from "@/lib/sdk/rewards-copy";
import type { ReactNode } from "react";

export function Ecosystem(): ReactNode {
  const rewards = nativeRewardLead();
  const qualify = `Wallets holding at least ${holderMinimumLabel()} $SDK qualify.`;
  return (
    <section id="ecosystem" className={`${homeFrame} my-24 scroll-mt-23 max-[800px]:my-18 max-[561px]:my-14`} aria-labelledby="ecosystem-title">
      <HomeEyebrow>Powered by $SDK</HomeEyebrow>
      <HomeHeading id="ecosystem-title">One token. An ecosystem of software.</HomeHeading>
      <HomeCopy>
        $SDK connects every application launched through the platform. It serves as the native pairing
        token for new launches and powers the ecosystem&apos;s holder reward model.
      </HomeCopy>
      <div className="mt-10 grid gap-px border border-solid border-border bg-border min-[701px]:grid-cols-3">
        <article className="bg-background px-6 py-8">
          <h3 className="text-[20px] leading-[1.25] tracking-[-0.4px]">Native Pairing</h3>
          <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">
            Every token launched on SDK pairs directly with $SDK, bringing each new application into the
            same ecosystem.
          </p>
        </article>
        <article className="bg-background px-6 py-8">
          <h3 className="text-[20px] leading-[1.25] tracking-[-0.4px]">SOL Holder Rewards</h3>
          <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">{rewards}</p>
          <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">{qualify}</p>
          <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">
            Rewards accumulate as claimable SOL. They are not transferred automatically.
          </p>
        </article>
        <article className="bg-background px-6 py-8">
          <h3 className="text-[20px] leading-[1.25] tracking-[-0.4px]">Built for Developers</h3>
          <p className="mt-3 text-[14px] leading-[1.65] text-muted-foreground">
            Use published SDKs through API keys and a universal client. Integrate working software into
            your own applications without rebuilding it from scratch.
          </p>
        </article>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <HomeLink href="/sdk" tone="primary">
          Explore $SDK
        </HomeLink>
        <HomeLink href="/code" tone="secondary">
          Developer Docs
        </HomeLink>
      </div>
    </section>
  );
}
