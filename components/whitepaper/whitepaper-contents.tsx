"use client";

import { useEffect, useState, type ReactNode } from "react";

import { WHITEPAPER_SECTIONS, type WhitepaperSectionId } from "@/components/whitepaper/sections";

export function WhitepaperFrame({ children }: { children: ReactNode }): ReactNode {
  const [active, setActive] = useState<WhitepaperSectionId>(WHITEPAPER_SECTIONS[0].id);

  useEffect(() => {
    const fromHash = (): void => {
      const hash = window.location.hash.replace("#", "");
      if (WHITEPAPER_SECTIONS.some((section) => section.id === hash)) setActive(hash as WhitepaperSectionId);
    };
    window.addEventListener("hashchange", fromHash);

    const nodes = WHITEPAPER_SECTIONS.flatMap((section) => {
      const node = document.getElementById(section.id);
      return node ? [node] : [];
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const id = visible?.target.id;
        if (WHITEPAPER_SECTIONS.some((section) => section.id === id)) setActive(id as WhitepaperSectionId);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.15, 0.4] },
    );
    for (const node of nodes) observer.observe(node);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="grid items-start gap-10 min-[801px]:grid-cols-[13.5rem_minmax(0,1fr)] min-[801px]:gap-14">
      <aside className="hidden min-[801px]:block">
        <ContentsNav active={active} onSelect={setActive} />
      </aside>
      <div className="min-w-0">
        <details className="sticky top-16 z-30 mb-8 border border-border bg-background px-3 py-2 min-[801px]:hidden">
          <summary className="cursor-pointer font-mono text-[10px] tracking-[0.06em] uppercase">
            Contents · {labelFor(active)}
          </summary>
          <ContentsList
            active={active}
            onSelect={(id, anchor) => {
              setActive(id);
              anchor.closest("details")?.removeAttribute("open");
            }}
          />
        </details>
        {children}
      </div>
    </div>
  );
}

function ContentsNav({
  active,
  onSelect,
}: {
  active: WhitepaperSectionId;
  onSelect: (id: WhitepaperSectionId) => void;
}): ReactNode {
  return (
    <nav aria-label="Whitepaper contents" className="sticky top-23 max-h-[calc(100svh-7rem)] overflow-y-auto pr-2">
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">SDK / Whitepaper</p>
      <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Version 1.0</p>
      <ContentsList active={active} onSelect={(id) => onSelect(id)} />
    </nav>
  );
}

function ContentsList({
  active,
  onSelect,
}: {
  active: WhitepaperSectionId;
  onSelect: (id: WhitepaperSectionId, anchor: HTMLAnchorElement) => void;
}): ReactNode {
  return (
    <ol className="mt-4 grid gap-0.5">
      {WHITEPAPER_SECTIONS.map((section) => {
        const current = active === section.id;
        return (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={current ? "true" : undefined}
              onClick={(event) => onSelect(section.id, event.currentTarget)}
              className={`flex gap-3 border-l py-1.5 pl-3 font-mono text-[10px] leading-[1.4] tracking-[0.04em] uppercase ${
                current ? "border-accent text-accent-ink" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="shrink-0">{section.index}</span>
              <span>{section.label}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function labelFor(id: WhitepaperSectionId): string {
  const section = WHITEPAPER_SECTIONS.find((item) => item.id === id);
  return section ? `${section.index} ${section.label}` : "";
}
