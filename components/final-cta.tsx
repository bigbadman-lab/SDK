import Link from "next/link";
import type { ReactNode } from "react";

export function FinalCta(): ReactNode {
  return (
    <section
      className="relative isolate mx-auto mt-14 mb-20 w-[min(1100px,_calc(100%_-_48px))] overflow-hidden bg-accent px-6 py-22 text-center text-accent-foreground before:absolute before:-top-25 before:-left-35 before:-z-1 before:h-70 before:w-70 before:[rotate:-25deg] before:border before:border-solid before:border-[#ffffff30] before:[content:''] before:[transition:rotate_1s] after:absolute after:-right-35 after:-bottom-30 after:-z-1 after:h-70 after:w-70 after:[rotate:-25deg] after:border after:border-solid after:border-[#ffffff30] after:[content:''] after:[transition:rotate_1s] max-[800px]:w-[calc(100%_-_40px)] max-[800px]:py-18 max-[561px]:mt-6 max-[561px]:mb-12 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:px-5 max-[561px]:py-14 [&_:focus-visible]:[outline-color:#ffffff] [&_>_div]:mt-8 [&_>_div]:flex [&_>_div]:justify-center [&_>_div]:gap-3 max-[561px]:[&_>_div]:flex-wrap [&_[data-ui~='button-primary']]:border-[#ffffff] [&_[data-ui~='button-primary']]:bg-[#ffffff] [&_[data-ui~='button-primary']]:text-[#2447ca] [&_[data-ui~='button-secondary']]:border-[#ffffff66] [&_[data-ui~='button-secondary']]:bg-transparent [&_[data-ui~='button-secondary']]:text-[#ffffff] [&_[data-ui~='button-secondary']:hover]:bg-[#ffffff18] [&_h2]:text-[44px] [&_h2]:leading-[1.2] max-[800px]:[&_h2]:text-[38px] max-[561px]:[&_h2]:text-[32px] [&_p]:mx-auto [&_p]:mt-5 [&_p]:max-w-130 [&_p]:text-[16px] [&_p]:text-[#ffffffe6] max-[561px]:[&_p]:max-w-none max-[561px]:[&_p]:text-[15px] max-[561px]:[&_p]:leading-[1.6] [&:hover::after]:[rotate:-15deg] [&:hover::before]:[rotate:-15deg]"
      aria-labelledby="cta-heading"
    >
      <h2
        id="cta-heading"
        className="text-[40px] leading-[1.2] tracking-[-1px]"
      >
        Test a private draft.
        <br />
        Do not expect a launch.
      </h2>
      <p>
        Signed-in Builder tests use the shared engine. Token launch and rewards
        are not available. A test does not publish a product.
      </p>
      <div>
        <Link
          className="inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap uppercase not-italic [transition:background_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]"
          data-ui="button button-primary"
          href="/#scope"
        >
          Current scope
        </Link>
        <Link
          className="inline-flex min-h-8.5 items-center justify-center gap-2.5 rounded-lg border border-solid px-4 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] whitespace-nowrap uppercase not-italic [transition:background_0.18s,_transform_0.18s] hover:[transform:translateY(-2px)] active:[transform:translateY(1px)] max-[561px]:px-3 max-[561px]:text-[10px]"
          data-ui="button button-secondary"
          href="/about"
        >
          About this site
        </Link>
      </div>
    </section>
  );
}
