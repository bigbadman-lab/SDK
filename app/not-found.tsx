import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import type { ReactNode } from "react";

export default function NotFound(): ReactNode {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[100svh] w-[min(1100px,_calc(100%_-_48px))] scroll-mt-23 flex-col items-center justify-center gap-7 text-center max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)] [&_>_p]:max-w-110 [&_>_p]:leading-[1.6] [&_>_p]:text-muted-foreground max-[561px]:[&_>_p]:text-[14px] [&_h1]:font-display [&_h1]:text-[64px] [&_h1]:leading-[1.1] [&_h1]:font-normal [&_h1]:not-italic max-[561px]:[&_h1]:text-[44px]"
    >
      <Logo />
      <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink">
        404
      </span>
      <h1>
        This page
        <br />
        <em>is not here.</em>
      </h1>
      <p>There is no SDK page at this address.</p>
      <Link
        className="inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid border-accent bg-accent px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap text-accent-foreground uppercase not-italic [transition:background_0.18s,_box-shadow_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] hover:bg-[color-mix(in_srgb,_var(--accent)_88%,_#111111)] hover:shadow-[0_2px_5px_#00000010] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px] [&_svg]:transition-transform [&_svg]:duration-[180ms] [&_svg]:ease-[ease] [&:hover_svg]:[transform:translate(2px,_-2px)]"
        data-ui="button button-primary"
        href="/"
      >
        Back to SDK <ArrowUpRight size={16} />
      </Link>
    </main>
  );
}
