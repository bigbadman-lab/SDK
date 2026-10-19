import type { ReactNode } from "react";

export function Hero(): ReactNode {
  return (
    <section
      className="mx-auto w-[min(1100px,_calc(100%_-_48px))] pt-[clamp(24px,_calc(12svh_-_64px),_112px)] pb-[clamp(32px,_calc(10svh_-_40px),_112px)] text-center max-[800px]:w-[calc(100%_-_40px)] max-[800px]:pt-[clamp(24px,_calc(12svh_-_64px),_76px)] max-[800px]:pb-[clamp(32px,_calc(10svh_-_40px),_76px)] max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-[clamp(16px,_calc(12svh_-_64px),_56px)] max-[561px]:pb-[clamp(16px,_calc(10svh_-_40px),_56px)] [&_[data-ui~='announcement']]:animate-[hero-arrive_0.65s_both] [&_h1]:mx-auto [&_h1]:mt-[clamp(20px,_3svh,_36px)] [&_h1]:mb-[clamp(16px,_2.4svh,_24px)] [&_h1]:max-w-205 [&_h1]:animate-[hero-arrive_0.8s_0.08s_both] [&_h1]:font-display [&_h1]:text-[80px] [&_h1]:leading-[1.13] [&_h1]:tracking-[-2.8px] [&_h1]:text-balance max-[800px]:[&_h1]:mt-[clamp(20px,_3svh,_32px)] max-[800px]:[&_h1]:text-[62px] max-[800px]:[&_h1]:leading-[1.15] max-[800px]:[&_h1]:tracking-[-2px] max-[561px]:[&_h1]:mt-[clamp(16px,_2.8svh,_28px)] max-[561px]:[&_h1]:max-w-110 max-[561px]:[&_h1]:text-[clamp(34px,_9.9vw,_55px)] max-[561px]:[&_h1]:leading-[1.18] max-[561px]:[&_h1]:tracking-[-1.5px] [&_h1_em]:font-normal [&_h1_em:last-child]:text-accent-ink"
      aria-labelledby="hero-title"
    >
      <a
        href="#builder"
        className="inline-flex items-center overflow-hidden rounded-[6px] border border-solid border-[color-mix(in_srgb,_var(--accent)_25%,_var(--border))] bg-card text-[12px] leading-[30px] max-[800px]:text-[11px] max-[561px]:max-w-full max-[561px]:text-[9px] max-[561px]:leading-[28px] [&_>_span:last-child]:px-3 [&_>_span:last-child]:py-0 max-[561px]:[&_>_span:last-child]:px-2"
        data-ui="announcement"
      >
        <span className="bg-accent px-3.5 py-0 font-mono text-[10px] leading-[30px] font-normal text-accent-foreground not-italic max-[561px]:px-2.5 max-[561px]:text-[8px] max-[561px]:leading-[28px]">
          STATUS
        </span>
        <span>Private drafts. A test is not a launch.</span>
      </a>
      <h1 id="hero-title">
        Build a real SDK.
        <br />
        <em>Launch</em> it with <em>$SDK.</em>
      </h1>
      <p className="mx-auto max-w-170 animate-[hero-arrive_0.8s_0.16s_both] text-[20px] leading-[30px] text-muted-foreground max-[800px]:text-[17px] max-[800px]:leading-[27px] max-[561px]:max-w-87.5 max-[561px]:text-[15px] max-[561px]:leading-[24px]">
        Test the SDK, then launch a token paired with $SDK. A verified launch
        publishes the working product. Community developers can submit reusable
        SDKs without minting.
      </p>
      <div className="mt-[clamp(20px,_2.8svh,_42px)] flex animate-[hero-arrive_0.8s_0.24s_both] justify-center gap-4 max-[800px]:mt-[clamp(20px,_2.8svh,_32px)] max-[561px]:mt-[clamp(16px,_2.8svh,_28px)] max-[561px]:gap-2.5">
        <a
          className="inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid border-border bg-card px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap uppercase not-italic [transition:background_0.18s,_box-shadow_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] hover:bg-muted hover:shadow-[0_2px_5px_#00000010] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]"
          data-ui="button button-secondary"
          href="#journeys"
        >
          How launch works
        </a>
        <a
          className="inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid border-accent bg-accent px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap text-accent-foreground uppercase not-italic [transition:background_0.18s,_box-shadow_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] hover:bg-[color-mix(in_srgb,_var(--accent)_88%,_#111111)] hover:shadow-[0_2px_5px_#00000010] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]"
          data-ui="button button-primary"
          href="/build"
        >
          Open Builder
        </a>
      </div>
    </section>
  );
}
