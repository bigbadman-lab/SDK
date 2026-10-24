import type { ReactNode } from "react";

const NODES = [
  { index: "01", title: "Developers", place: "left-1/2 top-[6%] -translate-x-1/2" },
  { index: "02", title: "SDK Library", place: "top-[24%] left-[78%] -translate-x-1/2" },
  { index: "03", title: "Creators", place: "top-[58%] left-[78%] -translate-x-1/2" },
  { index: "04", title: "Token launches", place: "top-[78%] left-1/2 -translate-x-1/2" },
  { index: "05", title: "Creator fees", place: "top-[58%] left-[22%] -translate-x-1/2" },
  { index: "06", title: "Incentives", place: "top-[24%] left-[22%] -translate-x-1/2" },
] as const;

export function EcosystemDiagram(): ReactNode {
  return (
    <figure>
      <div className="relative mx-auto hidden h-[520px] max-w-[560px] min-[801px]:block">
        <div className="absolute top-1/2 left-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border" aria-hidden="true" />
        <div className="absolute top-1/2 left-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-accent bg-card text-center">
          <p>
            <span className="block font-display text-[22px] leading-none">$SDK</span>
            <span className="mt-1 block max-w-24 font-mono text-[9px] leading-[1.35] tracking-[0.04em] text-muted-foreground uppercase">
              Launch pairing and holder SOL
            </span>
          </p>
        </div>
        <ol aria-label="Developers, library, creators, token launches, creator fees, and developer incentives">
          {NODES.map((node) => (
            <li key={node.index} className={`absolute w-36 -translate-y-1/2 border border-border bg-background px-3 py-3 ${node.place}`}>
              <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink">{node.index}</p>
              <p className="mt-1 text-[14px] leading-[1.3]">{node.title}</p>
            </li>
          ))}
        </ol>
      </div>
      <ol aria-label="Ecosystem cycle" className="grid gap-2 min-[801px]:hidden">
        {NODES.map((node, index) => (
          <li key={node.index} className="border border-border px-3 py-3">
            <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
              {node.index}
              {index === NODES.length - 1 ? " · returns to developers" : ""}
            </p>
            <p className="mt-1 text-[15px]">{node.title}</p>
          </li>
        ))}
      </ol>
      <figcaption className="mt-4 max-w-150 text-[13px] leading-[1.55] text-muted-foreground">
        Developers contribute SDKs. Creators use that software and can launch tokens. Qualifying creator fees can return an incentive to the developer who published the SDK. $SDK connects production launches and the eligible native SOL reward.
      </figcaption>
    </figure>
  );
}
