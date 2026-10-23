import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { createMetadata } from "@/lib/metadata";
import { nativeRewardLead } from "@/lib/sdk/rewards-copy";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "About",
  description:
    "SDK brings software development and token creation together on Solana. Build, publish, and launch working software paired with $SDK.",
  path: "/about",
});

const frame =
  "mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 max-[561px]:w-[calc(100%_-_32px)]";

export default function AboutPage(): ReactNode {
  return (
    <>
      <main id="main-content" className={`${frame} pt-16 pb-22 max-[561px]:pt-10 max-[561px]:pb-16`}>
        <header>
          <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
            About the platform
          </span>
          <h1 className="mt-6 font-display text-[56px] leading-[1.12] tracking-[-1.6px] text-balance max-[561px]:text-[38px] max-[561px]:leading-[1.16] [&_em]:font-normal [&_em]:text-accent-ink">
            Software first.
            <br />
            <em>Tokens second.</em>
          </h1>
          <div className="mt-6 grid max-w-150 gap-4 text-[17px] leading-[1.7] text-muted-foreground max-[561px]:text-[16px]">
            <p>SDK brings software development and token creation together on Solana.</p>
            <p>
              Build working SDKs with AI, remix existing tools, publish reusable software or launch tokens
              connected to real applications.
            </p>
            <p>We believe launching software should be as accessible as launching a token.</p>
          </div>
        </header>

        <section className="mt-16 border-t border-border pt-10 max-[561px]:mt-12">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            From idea to application.
          </h2>
          <div className="mt-5 grid max-w-150 gap-4 text-[16px] leading-[1.7] text-muted-foreground">
            <p>
              An idea is where it starts. SDK provides the tools to turn it into working software, test it
              against real inputs and make it available to others.
            </p>
            <p>
              Developers can build from scratch using the conversational AI Builder or start with an existing
              SDK from the Library.
            </p>
            <p>
              Every SDK runs through a shared execution engine, giving developers a consistent way to create,
              test and integrate software.
            </p>
          </div>
        </section>

        <section className="mt-16 border-t border-border pt-10 max-[561px]:mt-12">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            Built to be reused.
          </h2>
          <div className="mt-5 grid max-w-150 gap-4 text-[16px] leading-[1.7] text-muted-foreground">
            <p>Software becomes more valuable when others can build on it.</p>
            <p>
              The SDK Library is home to reusable applications created by the platform and its developer
              community.
            </p>
            <p>
              Explore working SDKs, test their capabilities and remix them into something new. Developers can
              also submit their own creations for publication.
            </p>
          </div>
          <div className="mt-6">
            <HomeLink href="/library" tone="primary">
              Explore the Library
            </HomeLink>
          </div>
        </section>

        <section className="mt-16 border-t border-border pt-10 max-[561px]:mt-12">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            Launch software, not just tokens.
          </h2>
          <div className="mt-5 grid max-w-150 gap-4 text-[16px] leading-[1.7] text-muted-foreground">
            <p>SDK connects functional software with token creation.</p>
            <p>
              Launch an application with a token paired directly to $SDK. Every verified launch receives its
              own token page, connected to the underlying software.
            </p>
            <p>
              The result is an ecosystem where tokens represent more than a name and a ticker. They connect to
              applications people can actually use.
            </p>
          </div>
          <div className="mt-6">
            <HomeLink href="/paired" tone="primary">
              Explore Paired Tokens
            </HomeLink>
          </div>
        </section>

        <section className="mt-16 border-t border-border pt-10 max-[561px]:mt-12">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            One ecosystem. Powered by $SDK.
          </h2>
          <div className="mt-5 grid max-w-150 gap-4 text-[16px] leading-[1.7] text-muted-foreground">
            <p>$SDK is the native token connecting launches across the platform.</p>
            <p>Every new token pairs with $SDK. {nativeRewardLead()}</p>
          </div>
          <div className="mt-6">
            <HomeLink href="/sdk" tone="primary">
              Explore $SDK
            </HomeLink>
          </div>
        </section>

        <section className="mt-16 border border-solid border-border bg-card px-6 py-8 max-[561px]:mt-12 max-[561px]:px-5">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            Build what&apos;s next.
          </h2>
          <p className="mt-4 max-w-130 text-[16px] leading-[1.7] text-muted-foreground">
            The tools are here. What you create is up to you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <HomeLink href="/build" tone="primary">
              Open Builder
            </HomeLink>
            <HomeLink href="/library" tone="secondary">
              Explore Library
            </HomeLink>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
