import type { ReactNode } from "react";

const LAUNCH_STEPS = [
  "Build a working SDK in the conversational Builder, or start from an approved library SDK.",
  "Test that SDK against the shared engine.",
  "Launch a child token paired with $SDK.",
  "After the launch is verified, the working token-associated product is published automatically.",
] as const;

const COMMUNITY_STEPS = [
  "Build a working reusable SDK.",
  "Test it against the same engine.",
  "Submit it for operator review. No token is required.",
  "After approval, it becomes a library listing other people can launch. That listing is not itself a launched product.",
] as const;

export function Journeys(): ReactNode {
  return (
    <section
      id="journeys"
      className="mx-auto my-32 w-[min(1100px,_calc(100%_-_48px))] max-[800px]:my-22 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:my-16 max-[561px]:w-[calc(100%_-_32px)]"
      aria-labelledby="journeys-title"
    >
      <header className="mb-9 max-w-180 max-[561px]:mb-7">
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          Two paths. One engine.
        </span>
        <h2
          id="journeys-title"
          className="mt-5 text-[clamp(32px,_3.8vw,_44px)] leading-[1.18] tracking-[-1.2px]"
        >
          A launch publishes the product.
          <br />A submission does not.
        </h2>
        <p className="mt-5 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
          Token launchers and community developers share the same future
          runtime. Only a verified token launch creates a public,
          token-associated SDK product.
        </p>
      </header>
      <div className="grid grid-cols-2 border border-solid border-border max-[701px]:grid-cols-1">
        <article className="bg-card px-7 py-8 max-[701px]:border-b max-[701px]:border-b-border max-[561px]:px-5 max-[561px]:py-7 min-[702px]:border-r min-[702px]:border-r-border">
          <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">
            Token creator
          </p>
          <h3 className="mt-3 text-[28px] leading-[1.25] tracking-[-0.6px]">
            Build, test, launch.
          </h3>
          <ol className="mt-6 grid gap-4">
            {LAUNCH_STEPS.map((step, index) => (
              <li key={step} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="font-mono text-[11px] text-muted-foreground">
                  0{index + 1}
                </span>
                <span className="text-[15px] leading-[1.6] text-muted-foreground">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </article>
        <article
          id="community"
          className="scroll-mt-23 bg-card px-7 py-8 max-[561px]:px-5 max-[561px]:py-7"
        >
          <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">
            Community developer
          </p>
          <h3 className="mt-3 text-[28px] leading-[1.25] tracking-[-0.6px]">
            Build, test, submit.
          </h3>
          <ol className="mt-6 grid gap-4">
            {COMMUNITY_STEPS.map((step, index) => (
              <li key={step} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="font-mono text-[11px] text-muted-foreground">
                  0{index + 1}
                </span>
                <span className="text-[15px] leading-[1.6] text-muted-foreground">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}
