import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { EcosystemDiagram } from "@/components/whitepaper/ecosystem-diagram";
import { MarketplaceFlow } from "@/components/whitepaper/marketplace-flow";
import { WHITEPAPER_SECTIONS } from "@/components/whitepaper/sections";
import { TokenomicsChart, TokenomicsMetrics } from "@/components/whitepaper/tokenomics-chart";
import { WhitepaperFrame } from "@/components/whitepaper/whitepaper-contents";
import { createMetadata } from "@/lib/metadata";
import { holderMinimumLabel, nativeRewardSplit, windowLengthLabel } from "@/lib/sdk/rewards-copy";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Whitepaper",
  description:
    "Explore the SDK vision, developer marketplace, business model, native $SDK tokenomics and the ecosystem for building and launching software on Solana.",
  path: "/whitepaper",
});

const frame =
  "mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-12 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-8 max-[561px]:pb-16";

const CAPABILITIES = [
  {
    title: "AI SDK Builder",
    body: "A conversational development environment that turns natural-language instructions into structured, executable SDKs.",
  },
  {
    title: "SDK Library",
    body: "A public marketplace of working, reusable SDKs. Developers can submit creations for review and publication.",
  },
  {
    title: "SDK Remixing",
    body: "Users can customise an existing SDK instead of rebuilding common functionality.",
  },
  {
    title: "Execution infrastructure",
    body: "A shared execution engine, authenticated API access, and a universal SDK client.",
  },
  {
    title: "Token launches",
    body: "Creators can launch a token associated with working software. Production launches use native $SDK as the quote asset.",
  },
  {
    title: "The SDK ecosystem",
    body: "One environment for developers, software publishers, token creators, and native holders.",
  },
] as const;

const RELATION = ["Developers", "Software", "Marketplace", "Token launches", "Native $SDK"] as const;

const FEES = [
  { category: "Official Library SDK", launcher: "60%", developer: "—", protocol: "40%" },
  { category: "Developer's own SDK", launcher: "85%", developer: "—", protocol: "15%" },
  { category: "Third-party community SDK", launcher: "60%", developer: "25%", protocol: "15%" },
] as const;

export default function WhitepaperPage(): ReactNode {
  const split = nativeRewardSplit();
  const balanced = split !== null && split.buyback === "0";
  const minimum = holderMinimumLabel();
  const minutes = windowLengthLabel();

  return (
    <>
      <main id="main-content" className={frame}>
        <WhitepaperFrame>
          <header>
            <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">SDK / Whitepaper</p>
            <p className="mt-3 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Version 1.0</p>
            <h1 className="mt-6 max-w-3xl font-display text-[56px] leading-[1.08] tracking-[-1.6px] text-balance max-[561px]:text-[38px]">
              The developer economy for Solana.
            </h1>
            <p className="mt-5 max-w-150 text-[18px] leading-[1.6] text-muted-foreground max-[561px]:text-[16px]">
              Build, publish and monetise software in an ecosystem powered by $SDK.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Mark>Software first</Mark>
              <Mark>Powered by $SDK</Mark>
            </div>
            <ol aria-label="Developers, software, marketplace, token launches, and native $SDK" className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2">
              {RELATION.map((item, index) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="border border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase">{item}</span>
                  {index < RELATION.length - 1 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </header>

          <Section id="vision" index="01" title="Software should be the starting point.">
            <p>
              The next generation of onchain applications will be built by developers, creators and communities who can turn ideas into working software without starting from zero.
            </p>
            <p>
              Yet the infrastructure surrounding token launches has largely focused on asset creation rather than the software those assets could represent.
            </p>
            <p>SDK takes a different approach.</p>
            <p>
              We are building an ecosystem where anyone can create functional SDKs, test them, publish them to a shared marketplace, integrate them into applications and launch tokens associated with working software.
            </p>
            <p>
              Developers can build reusable tools. Other users can discover, customise and deploy them. Communities can form around software with demonstrable utility.
            </p>
            <p>
              At the centre is $SDK, the native ecosystem token connecting launches, marketplace activity and holder rewards.
            </p>
            <p className="font-display text-[26px] leading-[1.25] tracking-[-0.4px] text-foreground max-[561px]:text-[22px]">
              Make creating, distributing and monetising software on Solana accessible to everyone.
            </p>
          </Section>

          <Section id="platform" index="02" title="One ecosystem. Multiple ways to build.">
            <p>
              SDK connects software creation, publication, reuse, execution and optional token launches. A developer does not need to launch a token in order to publish or use software.
            </p>
            <ul className="grid gap-px border border-border bg-border sm:grid-cols-2">
              {CAPABILITIES.map((item) => (
                <li key={item.title} className="min-w-0 bg-background px-4 py-4">
                  <h3 className="text-[16px] leading-[1.3] text-foreground">{item.title}</h3>
                  <p className="mt-2 text-[14px] leading-[1.6]">{item.body}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="marketplace" index="03" title="Build once. Create opportunities for reuse.">
            <p>
              SDK is building a marketplace where developers publish working software, other people discover and reuse it, and the original developer can earn from a qualifying third-party token launch.
            </p>
            <MarketplaceFlow />
            <p>
              Publishing software is independent of launching a token. An SDK can live in the Library with no associated token. The commercial opportunity is for developers who contribute software other people choose to reuse.
            </p>
          </Section>

          <Section id="business-model" index="04" title="Infrastructure that participates in the economy it enables.">
            <p>Three activities connect the economy: software creation and distribution, token-launch activity, and creator-fee sharing.</p>
            <p>
              SDK supports reusable software and token launches. The allocation of applicable creator fees depends on the launch category. The percentages below are shares of those child-token creator fees. They are not shares of total trading volume.
            </p>
            <FeeTable />
            <p>
              When a developer launches a token for their own SDK, the 85% launcher share is received by that developer in their role as launcher.
            </p>
            <p className="text-[18px] leading-[1.45] text-foreground">
              A developer can publish an SDK and receive 25% of applicable creator fees when a separate launcher uses it in a qualifying community-SDK token launch.
            </p>
            <p>
              The protocol share is retained as part of the operating model. It is not a promise that all protocol income is distributed to native $SDK holders. Child-token creator fees are also separate from native $SDK holder rewards.
            </p>
          </Section>

          <Section id="native-token" index="05" title="One token. An ecosystem of software.">
            <h3 className="text-[18px] text-foreground">Ecosystem pairing</h3>
            <p>Production child-token launches pair with native $SDK, rather than SOL or USDC.</p>
            <h3 className="text-[18px] text-foreground">Holder participation</h3>
            <p>
              Eligible holders participate in native creator-fee SOL allocations under the applicable protocol reward rules. An allocation is an entitlement. It is not, by itself, a completed payment.
            </p>
            <h3 className="text-[18px] text-foreground">Shared ecosystem infrastructure</h3>
            <p>$SDK connects the launch infrastructure and its token economy.</p>
            <h3 className="text-[18px] text-foreground">Onchain transparency</h3>
            <p>Verified launch activity and native reward accounting are represented through supported onchain evidence and platform records.</p>
            <p>Holding $SDK is not required to create, test or submit software.</p>
          </Section>

          <Section id="tokenomics" index="06" title="Utility and revenue allocation by design.">
            <p>
              After applicable collection and reserve treatment, confirmed native creator-fee SOL is allocated between eligible holders and the protocol.
            </p>
            {balanced && split ? <TokenomicsChart holders={split.holders} protocol={split.deployer} /> : null}
            {balanced && split && minutes ? (
              <TokenomicsMetrics holders={split.holders} minimum={minimum} minutes={minutes} />
            ) : null}
            <h3 className="text-[18px] text-foreground">Holder eligibility</h3>
            <p>
              A wallet must hold at least {minimum} whole native $SDK tokens at the relevant eligibility snapshot. Reward allocations are proportional to qualifying holdings under the protocol rules.
            </p>
            <h3 className="text-[18px] text-foreground">Reward windows</h3>
            <p>
              Native accounting operates in {minutes ? `${minutes}-minute` : "periodic"} UTC windows. Windows track qualifying creator-fee collections, reserve treatment and eligible allocations. A completed accounting window does not guarantee an allocation or a payment.
            </p>
            <h3 className="text-[18px] text-foreground">Claimable SOL</h3>
            <p>
              Holder rewards are recorded as claimable SOL entitlements. Allocated, claimable and successfully claimed rewards are distinct statuses. A reward is not paid until the relevant onchain claim is confirmed.
            </p>
            <h3 className="text-[18px] text-foreground">Unassigned allocations</h3>
            <p>
              Where eligible revenue exists but there are no qualifying holders, the holder portion is recorded as unassigned rather than silently retained by the protocol.
            </p>
            <h3 className="text-[18px] text-foreground">No automatic buybacks</h3>
            <p>
              The native {balanced && split ? `${split.holders}/${split.deployer}` : "holder and protocol"} model does not depend on automatic buybacks, new token issuance or token airdrops. Rewards are derived from eligible SOL creator-fee revenue.
            </p>
            <h3 className="text-[18px] text-foreground">Supply and distribution</h3>
            <p className="border border-border bg-card px-4 py-4 text-foreground">
              Full native token supply, distribution and launch parameters will be published following finalisation of the official token configuration.
            </p>
          </Section>

          <Section id="launches" index="07" title="More than a token.">
            <p>
              Creators begin with functioning SDK software, either built through the AI Builder or selected from the Library. A supported token launch associates a token with that software.
            </p>
            <p>Production child-token launches use native $SDK as the quote token. Verified launches become discoverable through Paired and individual token pages.</p>
            <p className="font-display text-[26px] leading-[1.25] tracking-[-0.4px] text-foreground max-[561px]:text-[22px]">
              The software remains the product.
            </p>
            <p>
              A token launch does not replace the SDK. The software can continue to be discovered, tested, remixed and integrated through supported interfaces. Token creation remains optional.
            </p>
          </Section>

          <Section id="infrastructure" index="08" title="Software built to be used.">
            <p>
              Published SDKs run through a shared execution engine. Applications call them with authenticated API requests. The universal SDK client provides one interface for those calls, with a consistent request and result shape.
            </p>
            <p>
              The client is distributed from this repository. It is not a package on the public NPM registry.
            </p>
            <p>
              API execution and blockchain signing are separate. An account-wide API key authorises permitted execution of published SDKs. It does not independently authorise wallet signing, a token launch, publication, or a transfer of funds.
            </p>
          </Section>

          <Section id="flywheel" index="09" title="More builders. More software. More opportunity.">
            <EcosystemDiagram />
            <p>
              Developers contribute useful SDKs. The marketplace attracts creators. Creators use the software and can launch a token with it. Qualifying activity can generate creator-fee opportunities, including a share for the developer who published a community SDK. Native $SDK connects the supported launch ecosystem. A larger catalogue gives the next participant more to build on.
            </p>
            <p>
              This is the intended economic model. It is not a guarantee of future activity, fees or returns.
            </p>
          </Section>

          <Section id="direction" index="10" title="An open economy for working software.">
            <h3 className="text-[18px] text-foreground">A growing developer marketplace</h3>
            <p>Expand the breadth and quality of published SDKs.</p>
            <h3 className="text-[18px] text-foreground">Accessible software creation</h3>
            <p>Make the journey from an idea to a functioning SDK progressively simpler.</p>
            <h3 className="text-[18px] text-foreground">Connected economic infrastructure</h3>
            <p>Connect software publication, integration, token launches, creator-fee sharing and native token participation.</p>
            <p>
              The objective is not simply to increase the number of launches. It is to increase the amount of useful software created, distributed and adopted.
            </p>
          </Section>

          <Section id="transparency" index="11" title="Transparency and risk.">
            <ul className="grid list-disc gap-3 pl-5">
              <li>SDK depends on Solana and on external infrastructure. Either can be unavailable, delayed or changed.</li>
              <li>Smart-contract behaviour and operational processes can fail, and a failure can affect execution, a launch or reward accounting.</li>
              <li>Token prices and liquidity can move sharply. A token can lose some or all of its value.</li>
              <li>Creator fees vary with activity. They are not guaranteed.</li>
              <li>Native holder allocations are not guaranteed payouts. A window can complete with nothing to allocate, and a recorded entitlement is not a confirmed payment.</li>
              <li>Library publication depends on review. API execution is subject to account limits.</li>
              <li>Published platform terms can change.</li>
            </ul>
            <p>
              A native holder allocation is not ownership of SDK&apos;s operating business, and it is not an entitlement to all of the company&apos;s revenue.
            </p>
          </Section>

          <Section id="build" index="12" title="The internet has an enormous number of tokens. What it needs is more useful software.">
            <p>
              SDK brings development, discovery, reuse, distribution and tokenisation together within one ecosystem.
            </p>
            <p>A developer can publish a tool without launching a token. A creator can build on existing software without starting from zero. A community can discover an application and its associated token.</p>
            <p>$SDK connects the native launch infrastructure and the defined fee-allocation model.</p>
            <p className="font-display text-[32px] leading-[1.2] tracking-[-0.6px] text-foreground max-[561px]:text-[26px]">
              Build software. Launch on Solana.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <HomeLink href="/library" tone="secondary">
                Explore the Library
              </HomeLink>
              <HomeLink href="/build" tone="primary">
                Start Building
              </HomeLink>
            </div>
          </Section>
        </WhitepaperFrame>
      </main>
      <Footer />
    </>
  );
}

function Section({
  id,
  index,
  title,
  children,
}: {
  id: (typeof WHITEPAPER_SECTIONS)[number]["id"];
  index: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-16 scroll-mt-32 border-t border-border pt-10 max-[561px]:mt-12">
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">{index}</p>
      <h2 id={`${id}-title`} className="mt-3 max-w-3xl font-display text-[36px] leading-[1.15] tracking-[-0.8px] text-balance max-[561px]:text-[28px]">
        {title}
      </h2>
      <div className="mt-6 grid max-w-180 gap-4 text-[16px] leading-[1.75] text-muted-foreground [&_h3]:mt-2">{children}</div>
    </section>
  );
}

function Mark({ children }: { children: string }): ReactNode {
  return <span className="border border-border px-3 py-2 font-mono text-[10px] tracking-[0.06em] uppercase">{children}</span>;
}

function FeeTable(): ReactNode {
  return (
    <div>
      <div className="hidden overflow-x-auto border border-border min-[561px]:block">
        <table className="w-full text-left">
          <caption className="sr-only">Creator-fee allocation by launch category</caption>
          <thead>
            <tr className="border-b border-border font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              <th className="px-3 py-2 font-normal">Launch category</th>
              <th className="px-3 py-2 text-right font-normal">Launcher</th>
              <th className="px-3 py-2 text-right font-normal">SDK developer</th>
              <th className="px-3 py-2 text-right font-normal">Protocol</th>
            </tr>
          </thead>
          <tbody>
            {FEES.map((row) => (
              <tr key={row.category} className="border-b border-border last:border-b-0">
                <th className="px-3 py-3 text-left text-[14px] font-normal text-foreground">{row.category}</th>
                <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums">{row.launcher}</td>
                <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums">{row.developer}</td>
                <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums">{row.protocol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 min-[561px]:hidden">
        {FEES.map((row) => (
          <li key={row.category} className="border border-border px-3 py-3">
            <p className="text-[15px] text-foreground">{row.category}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div>
                <dt className="text-muted-foreground uppercase">Launcher</dt>
                <dd className="mt-1 text-foreground">{row.launcher}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground uppercase">Developer</dt>
                <dd className="mt-1 text-foreground">{row.developer}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground uppercase">Protocol</dt>
                <dd className="mt-1 text-foreground">{row.protocol}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
