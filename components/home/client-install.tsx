import {
  HomeCopy,
  HomeEyebrow,
  HomeHeading,
  HomeLink,
  homeFrame,
} from "@/components/home/chrome";
import type { ReactNode } from "react";

const INSTALL = "npm install sdk-universal-client";
const IMPORT = `import { SDKClient } from "sdk-universal-client";`;

export function ClientInstall(): ReactNode {
  return (
    <section
      id="install"
      className={`${homeFrame} my-24 scroll-mt-23 max-[800px]:my-18 max-[561px]:my-14`}
      aria-labelledby="install-title"
    >
      <HomeEyebrow>Install with npm</HomeEyebrow>
      <HomeHeading id="install-title">One package runs every SDK.</HomeHeading>
      <HomeCopy>
        Install{" "}
        <code className="font-mono text-[0.92em] text-foreground">
          sdk-universal-client
        </code>{" "}
        and use it for every published SDK. There is no separate npm package for
        each SDK.
      </HomeCopy>
      <p className="mt-3 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
        Choose an SDK from the Library and pass its ID to the client. The same
        install runs Prompt Architect, Wallet DNA, a community SDK, or one you
        publish later.
      </p>
      <div className="mt-8 flex max-w-150 flex-col items-start gap-5 border border-solid border-border bg-card px-6 py-7 min-[701px]:px-8">
        <p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
          One install. Every published SDK.
        </p>
        <pre className="w-full overflow-x-auto border border-solid border-border bg-background p-4 font-mono text-[13px] leading-[1.6] text-foreground">
          <code>{INSTALL}</code>
        </pre>
        <pre className="w-full overflow-x-auto border border-solid border-border bg-background p-4 font-mono text-[13px] leading-[1.6] text-foreground">
          <code>{IMPORT}</code>
        </pre>
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          Create an API key, point the client at{" "}
          <code className="font-mono text-[0.92em] text-foreground">
            https://sdk.fund
          </code>
          {", and call "}
          <code className="font-mono text-[0.92em] text-foreground">run</code>{" "}
          with the SDK you want.
        </p>
        <HomeLink href="/code" tone="primary">
          View the client guide
        </HomeLink>
      </div>
    </section>
  );
}
