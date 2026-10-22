import type { ReactNode } from "react";

const LIVE = [
  "This website explains the product in a dark-first layout.",
  "Theme and motion preferences stay in this browser.",
  "A Solana wallet can connect, then sign in with a server-verified signature.",
  "A signed-in wallet can describe an SDK on the homepage, then test it in the Builder. It is listed only after a name is saved, and a test is not a launch.",
  "The public Library lists published SDKs. Saving a private draft does not publish it.",
  "A saved, tested SDK can be submitted for operator review. Approval lists that revision. A submission is not a token launch.",
  "A signed-in wallet can create API keys and call published SDKs. The client package is in this repository and is not on NPM.",
  "A tested private SDK, or a published Library version, can be prepared for launch. Preparation stores artwork and metadata. It does not mint a token.",
  "Paired and a child-token page list launches only after on-chain verification. A rehearsal parent is labelled $TREST.",
] as const;

const LATER = [
  "Public token minting. It stays closed until the production $SDK parent is activated.",
  "Rewards, trading statistics, and fee distribution.",
] as const;

export function Scope(): ReactNode {
  return (
    <section
      id="scope"
      className="mx-auto mb-28 w-[min(1100px,_calc(100%_-_48px))] border border-solid border-border max-[800px]:mb-20 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:mb-16 max-[561px]:w-[calc(100%_-_32px)]"
      aria-labelledby="scope-title"
    >
      <header className="border-b border-b-border px-7 py-8 max-[561px]:px-5 max-[561px]:py-6">
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          What is actually here
        </span>
        <h2
          id="scope-title"
          className="mt-4 max-w-160 text-[clamp(32px,_3.8vw,_44px)] leading-[1.18] tracking-[-1.2px]"
        >
          A private draft.
          <br />
          Not a launch.
        </h2>
      </header>
      <div className="grid grid-cols-2 max-[701px]:grid-cols-1">
        <div className="px-7 py-8 max-[701px]:border-b max-[701px]:border-b-border max-[561px]:px-5 min-[702px]:border-r min-[702px]:border-r-border">
          <h3 className="font-mono text-[11px] tracking-[0.08em] uppercase">
            Available
          </h3>
          <ul className="mt-5 grid gap-4">
            {LIVE.map((item) => (
              <li
                key={item}
                className="text-[15px] leading-[1.65] text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="px-7 py-8 max-[561px]:px-5">
          <h3 className="font-mono text-[11px] tracking-[0.08em] uppercase">
            Not operative
          </h3>
          <ul className="mt-5 grid gap-4">
            {LATER.map((item) => (
              <li
                key={item}
                className="text-[15px] leading-[1.65] text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
