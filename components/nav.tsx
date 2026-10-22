"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trapDialogFocus } from "@/lib/dialog";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet/wallet-button";

const LINKS = [
  { label: "Journeys", href: "/#journeys" },
  { label: "Builder", href: "/build" },
  { label: "Library", href: "/library" },
  { label: "Launch", href: "/launch" },
  { label: "Paired", href: "/paired" },
  { label: "Feed", href: "/feed" },
  { label: "Code", href: "/code" },
  { label: "Scope", href: "/#scope" },
  { label: "About", href: "/about" },
  { label: "Account", href: "/account" },
];

export function Nav(): ReactNode {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const scroll = (): void => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", scroll, { passive: true });
    scroll();
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const dialog = panel.current;
    const triggerElement = trigger.current;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    const media = window.matchMedia("(min-width: 800px)");
    const resize = (): void => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", resize);
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      media.removeEventListener("change", resize);
      if (media.matches)
        document
          .querySelector<HTMLAnchorElement>('[data-ui~="desktop-nav"] a')
          ?.focus({ preventScroll: true });
      else triggerElement?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <header
      className="sticky top-0 z-60 h-16 overflow-x-clip bg-[color-mix(in_srgb,_var(--background)_96%,_transparent)] [backdrop-filter:blur(12px)] [&[data-ui~='is-scrolled']]:shadow-[0_1px_0_var(--border)]"
      data-ui={scrolled ? "is-scrolled" : ""}
    >
      <div className="relative mx-auto flex h-16 w-[min(1100px,_calc(100%_-_48px))] items-center justify-between max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)] min-[801px]:grid min-[801px]:grid-cols-[auto_minmax(0,1fr)_12.25rem] min-[801px]:gap-6">
        <Link
          href="/#top"
          aria-label="SDK home"
          className="relative z-10 inline-flex"
        >
          <Logo />
        </Link>
        <nav
          className="z-10 flex min-w-0 items-center justify-center gap-7 overflow-hidden max-[1051px]:gap-4 max-[900px]:gap-3 max-[800px]:hidden [&_a]:relative [&_a]:py-3 [&_a]:font-mono [&_a]:text-[11px] [&_a]:[line-height:normal] [&_a]:font-medium [&_a]:whitespace-nowrap [&_a]:uppercase [&_a]:not-italic [&_a]:transition-opacity [&_a]:duration-[180ms] [&_a]:ease-[ease] [&_a::after]:absolute [&_a::after]:right-0 [&_a::after]:bottom-1.25 [&_a::after]:left-0 [&_a::after]:h-0.5 [&_a::after]:[transform-origin:left] [&_a::after]:[transform:scaleX(0)] [&_a::after]:bg-accent [&_a::after]:transition-transform [&_a::after]:duration-[250ms] [&_a::after]:ease-[ease] [&_a::after]:[content:''] [&_a:hover]:opacity-100 [&_a:hover::after]:[transform:scaleX(1)]"
          data-ui="desktop-nav"
          aria-label="Main navigation"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                link.href === "/launch" ? "text-accent-ink" : undefined
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="relative z-10 flex w-[12.25rem] items-center justify-end max-[800px]:hidden">
          <WalletButton />
        </div>
        <button
          ref={trigger}
          className="hidden max-[800px]:grid max-[800px]:h-8 max-[800px]:w-8 max-[800px]:place-items-center"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} />
        </button>
      </div>
      <dialog
        onKeyDown={trapDialogFocus}
        className="m-auto max-h-[calc(100svh_-_32px)] w-[min(500px,_calc(100%_-_32px))] overflow-auto rounded-xl border border-solid border-border bg-card p-6 text-foreground backdrop:bg-[#00000055] backdrop:[backdrop-filter:blur(5px)] [&_>_p]:mt-4 [&_>_p]:text-[12px] [&_>_p]:text-muted-foreground [&_nav]:mx-0 [&_nav]:mt-4 [&_nav]:mb-7 [&_nav_a]:flex [&_nav_a]:items-center [&_nav_a]:gap-3.5 [&_nav_a]:border-b [&_nav_a]:border-b-border [&_nav_a]:px-0 [&_nav_a]:py-5 [&_nav_a]:text-[22px] [&_nav_a_>_span]:font-mono [&_nav_a_>_span]:text-[10px] [&_nav_a_>_span]:[line-height:normal] [&_nav_a_>_span]:font-normal [&_nav_a_>_span]:text-muted-foreground [&_nav_a_>_span]:not-italic [&_nav_a_>_svg]:ml-auto"
        id="mobile-navigation"
        ref={panel}
        aria-label="Site navigation"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <button
            className="grid h-10 w-10 place-items-center rounded-lg border border-solid border-border transition-colors duration-[200ms] ease-[ease] hover:bg-muted"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={22} />
          </button>
        </div>
        <div className="mt-9 font-mono text-[9px] [line-height:normal] font-normal text-muted-foreground not-italic">
          FIND YOUR WAY
        </div>
        <nav aria-label="Mobile navigation">
          {LINKS.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
            >
              <span>0{index + 1}</span>
              {link.label}
              <ArrowUpRight size={22} />
            </Link>
          ))}
        </nav>
        <WalletButton compact />
        <p>
          Connect your wallet, then approve the sign-in there. On-chain
          launching is not available yet.
        </p>
      </dialog>
    </header>
  );
}
