import { HomeLink } from "@/components/home/chrome";
import { HomePrompt } from "@/components/builder/home-prompt";
import { LandscapeCanvas } from "@/components/landscape-canvas";
import type { ReactNode } from "react";

export function BuilderIntro(): ReactNode {
  return (
    <section
      id="builder"
      className="mx-auto w-[min(1100px,_calc(100%_-_48px))] scroll-mt-23 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]"
      aria-labelledby="builder-title"
    >
      <header className="mb-8 max-w-180 max-[561px]:mb-6">
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          AI SDK Builder
        </span>
        <h2
          id="builder-title"
          className="mt-5 text-[clamp(32px,_3.8vw,_44px)] leading-[1.18] tracking-[-1.2px]"
        >
          An idea is enough to start.
        </h2>
        <p className="mt-5 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
          Describe what you want to build. SDK turns your instructions into a working, testable
          application using a conversational AI builder.
        </p>
        <p className="mt-3 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
          Refine the logic, test real inputs, and prepare your SDK for publishing or token launch.
        </p>
      </header>
      <div className="relative isolate overflow-hidden bg-scene px-6 pt-10 pb-28 max-[561px]:px-4 max-[561px]:pt-8 max-[561px]:pb-20">
        <LandscapeCanvas />
        <div className="relative z-10 mx-auto w-[min(720px,100%)]">
          <HomePrompt />
        </div>
      </div>
      <div className="mt-6">
        <HomeLink href="/build" tone="primary">
          Open Builder
        </HomeLink>
      </div>
    </section>
  );
}
