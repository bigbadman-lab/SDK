"use client";

import { formatAge, formatCount, formatUsd, type MarketQuote } from "@/lib/market/quote";
import { shortenAddress, type VerifiedLaunch } from "@/lib/launch/verified-launch";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const COLUMNS =
  "grid-cols-[minmax(0,1fr)_3.6rem_3.25rem_2.4rem] gap-x-1.5 min-[801px]:grid-cols-[minmax(0,1.7fr)_96px_88px_96px_72px_108px] min-[801px]:gap-2";

async function copyMint(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

type MarketBody = {
  ok?: boolean;
  quotes?: Record<string, MarketQuote>;
};

export function PairedTerminal({
  launches,
  empty,
}: {
  launches: readonly VerifiedLaunch[];
  empty: string;
}): ReactNode {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [live, setLive] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const clock = window.setInterval(tick, 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = () => {
      if (document.hidden) return;
      void fetch("/api/paired/markets", { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as MarketBody;
          if (cancelled) return;
          setLive(response.ok && body.ok === true);
          if (body.quotes) setQuotes(body.quotes);
        })
        .catch(() => {
          if (!cancelled) setLive(false);
        });
    };
    load();
    timer = window.setInterval(load, 2_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (launches.length === 0) {
    return <p className="text-[14px] leading-[1.6] text-muted-foreground">{empty}</p>;
  }

  return (
    <div>
      <p className="mb-2 flex items-center justify-end gap-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted-foreground"}`} aria-hidden="true" />
        {live ? "Live · 2s" : "Market data delayed"}
      </p>
      <div className={`sticky top-16 z-10 grid border-b border-border bg-background/95 py-1.5 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase backdrop-blur min-[801px]:py-2 ${COLUMNS}`}>
        <span>Token</span>
        <span className="hidden min-[801px]:block">Mint</span>
        <span className="text-right">FDV</span>
        <span className="text-right">{`Vol`}<span className="hidden min-[801px]:inline"> 24h</span></span>
        <span className="text-right">{`Hld`}<span className="hidden min-[801px]:inline">rs</span></span>
        <span className="hidden text-right min-[801px]:block">Pair</span>
      </div>
      <ul>
        {launches.map((launch) => {
          const quote = quotes[launch.childMint] ?? { fdv: null, volumeUsd: null, holders: null };
          return (
            <li key={launch.childMint} className={`grid items-center border-b border-border py-1.5 min-[801px]:py-2 ${COLUMNS}`}>
              <div className="flex min-w-0 items-center gap-1.5 min-[801px]:gap-2.5">
                <TokenMark launch={launch} />
                <p className="flex min-w-0 items-baseline gap-1.5 leading-none">
                  <Link href={`/token/${launch.childMint}`} className="min-w-0 truncate text-[13px] hover:text-accent-ink min-[801px]:text-[14px]">
                    {launch.name}
                  </Link>
                  <span className="hidden shrink-0 text-[12px] text-muted-foreground min-[801px]:inline">{launch.symbol}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{now === null ? "" : formatAge(launch.verifiedAt, now)}</span>
                  <span className="shrink-0 font-mono text-[9px] tracking-[0.04em] text-accent-ink uppercase min-[801px]:hidden">
                    {launch.scope === "test" ? "Test" : launch.pairLabel}
                  </span>
                  <CopyMint launch={launch} copied={copied === launch.childMint} compact onCopy={() => {
                    void copyMint(launch.childMint).then((ok) => {
                      if (ok) setCopied(launch.childMint);
                    });
                  }} />
                </p>
              </div>
              <CopyMint launch={launch} copied={copied === launch.childMint} onCopy={() => {
                void copyMint(launch.childMint).then((ok) => {
                  if (ok) setCopied(launch.childMint);
                });
              }} />
              <Metric value={formatUsd(quote.fdv)} />
              <Metric value={formatUsd(quote.volumeUsd)} />
              <Metric value={formatCount(quote.holders)} />
              <p className="hidden text-right font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase min-[801px]:block">
                {launch.pairLabel}
                {launch.scope === "test" ? " · Test" : ""}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {copied ? "Mint address copied" : ""}
      </p>
    </div>
  );
}

function CopyMint({
  launch,
  copied,
  compact = false,
  onCopy,
}: {
  launch: VerifiedLaunch;
  copied: boolean;
  compact?: boolean;
  onCopy: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`shrink-0 font-mono text-muted-foreground hover:text-foreground ${compact ? "text-[10px] min-[801px]:hidden" : "hidden text-[12px] min-[801px]:block"}`}
      aria-label={`Copy mint address ${launch.childMint}`}
      onClick={onCopy}
    >
      {copied ? "Copied" : shortenAddress(launch.childMint)}
    </button>
  );
}

function Metric({ value }: { value: string }): ReactNode {
  return <p className="text-right font-mono text-[11px] leading-none tabular-nums min-[801px]:text-[13px]">{value}</p>;
}

function TokenMark({ launch }: { launch: VerifiedLaunch }): ReactNode {
  if (!launch.imageUrl) {
    return <span className="h-6 w-6 shrink-0 rounded-md border border-solid border-border bg-card min-[801px]:h-8 min-[801px]:w-8" aria-hidden="true" />;
  }
  return (
    // Gateway hosts are chosen at pin time, so this cannot be limited to one Next image domain.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={launch.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded-md bg-card object-cover min-[801px]:h-8 min-[801px]:w-8" />
  );
}
