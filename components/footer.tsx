import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import type { ReactNode } from "react";

const GROUPS = [
  {
    title: "PRODUCT",
    links: [
      { label: "Journeys", href: "/#journeys" },
      { label: "Builder status", href: "/#builder" },
      { label: "Account", href: "/account" },
      { label: "Current scope", href: "/#scope" },
    ],
  },
  {
    title: "FOR DEVELOPERS",
    links: [
      { label: "Submit without a token", href: "/#community" },
      { label: "About this site", href: "/about" },
    ],
  },
  {
    title: "NOT LIVE YET",
    links: [
      { label: "What this site cannot do", href: "/#scope" },
      { label: "Local setup", href: "/about#setup" },
    ],
  },
];

export function Footer(): ReactNode {
  return (
    <footer className="mx-auto w-[min(1100px,_calc(100%_-_48px))] border-t border-t-border max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]">
      <div className="grid grid-cols-[1.4fr_repeat(3,_1fr)] gap-10 px-0 pt-12 pb-16 max-[1051px]:gap-6 max-[800px]:grid-cols-[repeat(3,_1fr)] max-[561px]:grid-cols-[1fr_1fr] max-[561px]:gap-[36px_16px] max-[561px]:pt-8">
        <div className="max-[800px]:col-span-full [&_p]:mt-4 [&_p]:max-w-70 [&_p]:text-[12px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground">
          <Link href="/#top" aria-label="SDK home">
            <Logo />
          </Link>
          <p>
            Build a working SDK, test it, and publish it by launching a token
            paired with $SDK.
          </p>
        </div>
        {GROUPS.map((group) => (
          <div
            className="[&_a]:mt-4.5 [&_a]:flex [&_a]:w-[fit-content] [&_a]:items-center [&_a]:gap-1.5 [&_a]:font-mono [&_a]:text-[10px] [&_a]:[line-height:normal] [&_a]:font-normal [&_a]:uppercase [&_a]:not-italic max-[561px]:[&_a]:text-[9px] max-[561px]:[&_a]:leading-[1.5] [&_a_svg]:opacity-0 [&_a_svg]:transition-opacity [&_a_svg]:duration-[180ms] [&_a_svg]:ease-[ease] [&_a:hover_svg]:opacity-100 [&_h3]:mx-0 [&_h3]:mt-1 [&_h3]:mb-6 [&_h3]:font-mono [&_h3]:text-[10px] [&_h3]:[line-height:normal] [&_h3]:font-normal [&_h3]:text-muted-foreground [&_h3]:not-italic max-[561px]:[&_h3]:text-[9px]"
            key={group.title}
          >
            <h3>{group.title}</h3>
            {group.links.map((link) => (
              <a href={link.href} key={link.label}>
                {link.label}
                <ArrowUpRight size={12} />
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-t-border px-0 pt-6 pb-8 font-mono text-[9px] [line-height:normal] font-normal text-muted-foreground not-italic max-[800px]:flex-wrap max-[800px]:leading-[1.7] max-[561px]:pb-19 max-[561px]:text-[8px] max-[561px]:[&_>_span:nth-child(2)]:[order:3] max-[561px]:[&_>_span:nth-child(2)]:w-full [&_a]:inline-flex [&_a]:items-center [&_a]:gap-0.75">
        <span>© {new Date().getFullYear()} SDK</span>
        <Link href="/#top">BACK TO THE TOP ↑</Link>
      </div>
    </footer>
  );
}
