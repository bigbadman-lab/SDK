import { Footer } from "@/components/footer";
import type { ReactNode } from "react";

function Bar({ className }: { className: string }): ReactNode {
  return <span className={`block motion-safe:animate-pulse bg-muted ${className}`} />;
}

export const accountMainClass =
  "mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10";

export function AccountIntro(): ReactNode {
  return (
    <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
      Account
    </span>
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
