import type { ReactNode } from "react";

const LIVE = [
  "This website explains the product in a dark-first layout.",
  "Theme and motion preferences stay in this browser.",
  "A Solana wallet can connect, then sign in with a server-verified signature.",
  "The Builder panel shows inert examples. It does not accept a request.",
] as const;

const LATER = [
  "SDK execution, tests, and the conversational Builder.",
  "Token minting, verified launch, and automatic publication.",
  "The library, community submission, and operator review.",
  "Rewards, trading statistics, the Feed, and an NPM client.",
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
          A public description.
          <br />
          Not a live service.
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
