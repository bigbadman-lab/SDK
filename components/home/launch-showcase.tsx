import { HomeCopy, HomeEyebrow, HomeHeading, HomeLink, homeFrame } from "@/components/home/chrome";
import type { ReactNode } from "react";

export function LaunchShowcase(): ReactNode {
  return (
    <section id="launches" className={`${homeFrame} my-24 scroll-mt-23 max-[800px]:my-18 max-[561px]:my-14`} aria-labelledby="launches-title">
      <HomeEyebrow>Software meets Solana</HomeEyebrow>
      <HomeHeading id="launches-title">More than a token.</HomeHeading>
      <HomeCopy>
        Every token launched through SDK is connected to a working software product.
      </HomeCopy>
      <p className="mt-3 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
        Choose an SDK from the Library, customise an existing build or launch your own creation. Each
        token pairs with $SDK, while its associated software remains accessible through the platform.
      </p>
      <div className="mt-8 flex max-w-150 flex-col items-start gap-5 border border-solid border-border bg-card px-6 py-7 min-[701px]:px-8">
        <p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
          One token. One working SDK. A product people can use.
        </p>
        <HomeLink href="/launch" tone="primary">
          Launch a Token
        </HomeLink>
      </div>
    </section>
  );
}
