"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Blocks, CircleUser, Coins, Library, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const TABS: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
  main?: boolean;
}> = [
  { label: "Build", href: "/build", icon: Blocks },
  { label: "Library", href: "/library", icon: Library },
  { label: "Launch", href: "/launch", icon: Rocket, main: true },
  { label: "Paired", href: "/paired", icon: Coins },
  { label: "Account", href: "/account", icon: CircleUser },
];

export function MobileTabBar(): ReactNode {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-60 hidden border-t border-solid border-border bg-[color-mix(in_srgb,_var(--background)_96%,_transparent)] pb-[env(safe-area-inset-bottom)] [backdrop-filter:blur(12px)] max-[800px]:block"
    >
      <ul className="grid h-16 grid-cols-5 items-end">
        {TABS.map((tab) => {
          const current = currentTab(pathname, tab.href);
          const Icon = tab.icon;
          if (tab.main) {
            return (
              <li key={tab.href} className="flex justify-center">
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className="flex -mt-4 w-full flex-col items-center gap-1 pb-1.5 text-foreground"
                >
                  <span
                    className={
                      "grid h-14 w-14 place-items-center rounded-full border border-solid border-accent bg-accent text-accent-foreground shadow-[0_8px_18px_#00000033] " +
                      (current ? "ring-2 ring-accent-ink ring-offset-2 ring-offset-background" : "")
                    }
                  >
                    <Icon size={22} strokeWidth={1.75} />
                  </span>
                  <span className="font-mono text-[9px] leading-none tracking-[0.06em] uppercase">{tab.label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={
                  "flex h-16 flex-col items-center justify-center gap-1 " +
                  (current ? "text-accent-ink" : "text-muted-foreground")
                }
              >
                <Icon size={20} strokeWidth={1.75} />
                <span className="font-mono text-[9px] leading-none tracking-[0.06em] uppercase">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function currentTab(pathname: string, href: string): boolean {
  if (href === "/library") return pathname === "/library" || pathname.startsWith("/library/");
  if (href === "/account") return pathname === "/account" || pathname.startsWith("/account/");
  return pathname === href;
}
