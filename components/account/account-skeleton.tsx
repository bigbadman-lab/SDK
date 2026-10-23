import { Footer } from "@/components/footer";
import type { ReactNode } from "react";

function Bar({ className }: { className: string }): ReactNode {
  return <span className={`block motion-safe:animate-pulse bg-muted ${className}`} />;
}

export const accountMainClass =
  "mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10";

export function AccountIntro(): ReactNode {
  return (
    <header>
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Your workspace</p>
      <h1 className="mt-4 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
        Your SDK account.
      </h1>
      <p className="mt-4 max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
        Manage your SDKs, launched tokens, API keys and ecosystem rewards in one place.
      </p>
    </header>
  );
}

export function AccountSectionHeading({
  index,
  title,
  titleId,
  children,
}: {
  index: string;
  title: string;
  titleId?: string;
  children: string;
}): ReactNode {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">{index}</p>
      <h2 id={titleId} className="mt-2 font-display text-[32px] leading-[1.15] tracking-[-0.8px] max-[561px]:text-[26px]">
        {title}
      </h2>
      <p className="mt-3 max-w-130 text-[15px] leading-[1.7] text-muted-foreground">{children}</p>
    </div>
  );
}

export function AccountBodySkeleton(): ReactNode {
  return (
    <div className="mt-6" aria-busy="true">
      <p className="sr-only">Loading account</p>
      <Bar className="h-14 w-64 max-[561px]:h-10" />
      <Bar className="mt-8 h-5 w-full max-w-130" />
      <Bar className="mt-3 h-5 w-4/5 max-w-100" />
      <Bar className="mt-8 h-28 w-full" />
      <Bar className="mt-5 h-28 w-full" />
    </div>
  );
}

export function AccountSectionSkeleton({ label }: { label: string }): ReactNode {
  return (
    <div aria-busy="true">
      <p className="sr-only">{label}</p>
      <Bar className="h-3 w-28" />
      <Bar className="mt-4 h-20 w-full" />
    </div>
  );
}

export function AccountLoading(): ReactNode {
  return (
    <>
      <main id="main-content" className={accountMainClass}>
        <AccountIntro />
        <AccountBodySkeleton />
      </main>
      <Footer />
    </>
  );
}
