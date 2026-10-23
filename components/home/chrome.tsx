import Link from "next/link";
import type { ReactNode } from "react";

export const homeFrame =
  "mx-auto w-[min(1100px,_calc(100%_-_48px))] max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]";

const primary =
  "inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid border-accent bg-accent px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap text-accent-foreground uppercase not-italic [transition:background_0.18s,_box-shadow_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] hover:bg-[color-mix(in_srgb,_var(--accent)_88%,_#111111)] hover:shadow-[0_2px_5px_#00000010] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]";

const secondary =
  "inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid border-border bg-card px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap uppercase not-italic [transition:background_0.18s,_box-shadow_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] hover:bg-muted hover:shadow-[0_2px_5px_#00000010] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]";

export function HomeEyebrow({ children }: { children: string }): ReactNode {
  return (
    <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
      {children}
    </span>
  );
}

export function HomeHeading({ id, children }: { id: string; children: ReactNode }): ReactNode {
  return (
    <h2 id={id} className="mt-5 max-w-180 text-[clamp(32px,_3.8vw,_44px)] leading-[1.18] tracking-[-1.2px]">
      {children}
    </h2>
  );
}

export function HomeCopy({ children }: { children: ReactNode }): ReactNode {
  return <p className="mt-5 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">{children}</p>;
}

export function HomeLink({
  href,
  tone,
  children,
}: {
  href: string;
  tone: "primary" | "secondary";
  children: string;
}): ReactNode {
  const className = tone === "primary" ? primary : secondary;
  const ui = tone === "primary" ? "button button-primary" : "button button-secondary";
  if (href.startsWith("#")) {
    return (
      <a className={className} data-ui={ui} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={className} data-ui={ui} href={href}>
      {children}
    </Link>
  );
}
