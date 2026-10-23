"use client";

import { formatAge, formatCount, formatUsd, type MarketQuote } from "@/lib/market/quote";
import {
  explorerUrl,
  formatVerifiedAt,
  shortenAddress,
  type VerifiedLaunch,
} from "@/lib/launch/verified-launch";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

type MarketBody = { ok?: boolean; quotes?: Record<string, MarketQuote> };

const EMPTY: MarketQuote = { fdv: null, volumeUsd: null, holders: null };

async function copyText(value: string): Promise<boolean> {
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

export function TokenExperience({ launch }: { launch: VerifiedLaunch }): ReactNode {
  const [quote, setQuote] = useState<MarketQuote>(EMPTY);
  const [live, setLive] = useState(false);
  const [pending, setPending] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const clock = window.setInterval(tick, 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const url = `/api/paired/markets?mint=${encodeURIComponent(launch.childMint)}`;
      void fetch(url, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as MarketBody;
          if (cancelled) return;
          setPending(false);
          setLive(response.ok && body.ok === true);
          setQuote(body.quotes?.[launch.childMint] ?? EMPTY);
        })
        .catch(() => {
          if (cancelled) return;
          setPending(false);
          setLive(false);
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, 2_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [launch.childMint]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function copy(value: string) {
    void copyText(value).then((ok) => {
      if (ok) setCopied(value);
    });
  }

  return (
      <section className="min-w-0">
        <div className="flex items-center gap-3">
          <TokenMark launch={launch} />
          <div className="min-w-0">
            <h1 className="truncate text-[28px] leading-none tracking-[-0.6px] max-[561px]:text-[22px]">{launch.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] tracking-[0.04em] uppercase">
              <span className="text-muted-foreground">${launch.symbol}</span>
              <span className="text-muted-foreground">{now === null ? "" : formatAge(launch.verifiedAt, now)}</span>
              <span className="text-accent-ink">
                {launch.pairLabel}
                {launch.scope === "test" ? " · Test" : ""}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mt-3 text-left font-mono text-[12px] break-all text-muted-foreground hover:text-foreground"
          aria-label={`Copy mint address ${launch.childMint}`}
          onClick={() => copy(launch.childMint)}
        >
          {copied === launch.childMint ? "Copied" : launch.childMint}
        </button>
        <div className="mt-4 grid grid-cols-3 gap-2 border-y border-border py-3">
          <Stat label="FDV" value={formatUsd(quote.fdv)} pending={pending} />
          <Stat label="Vol 24h" value={formatUsd(quote.volumeUsd)} pending={pending} />
          <Stat label="Holders" value={formatCount(quote.holders)} pending={pending} />
        </div>
        <p className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted-foreground"}`} aria-hidden="true" />
          {pending ? "Loading market" : live ? "Live · 2s" : "Market data delayed"}
        </p>
        <TokenChart mint={launch.childMint} symbol={launch.symbol} />
        <dl className="mt-6 grid gap-2 text-[13px]">
          <Fact term="Creator" value={shortenAddress(launch.creator)} />
          <Fact term="Verified" value={formatVerifiedAt(launch.verifiedAt)} />
          <Fact
            term="Parent"
            value={copied === launch.parentMint ? "Copied" : shortenAddress(launch.parentMint)}
            onCopy={() => copy(launch.parentMint)}
          />
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Tx</dt>
            <dd>
              <a className="font-mono text-[12px] underline" href={explorerUrl(launch.signature, "tx")} rel="noreferrer">
                View transaction
              </a>
            </dd>
          </div>
        </dl>
        <p className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</p>
      </section>
  );
}

function TokenChart({ mint, symbol }: { mint: string; symbol: string }): ReactNode {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const src = `https://dexscreener.com/solana/${encodeURIComponent(mint)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${theme}&theme=${theme}&chartStyle=1&chartType=usd&interval=15`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const start = () => setReady(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(start, { timeout: 1_200 });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 400);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Chart</p>
        <a
          className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase hover:text-accent-ink"
          href={`https://dexscreener.com/solana/${encodeURIComponent(mint)}`}
          rel="noreferrer"
        >
          DexScreener
        </a>
      </div>
      {ready ? (
        <iframe
          title={`${symbol} chart`}
          src={src}
          className="h-[280px] w-full border border-border bg-card max-[561px]:h-[220px]"
          loading="lazy"
        />
      ) : (
        <div className="h-[280px] w-full border border-border bg-card motion-safe:animate-pulse max-[561px]:h-[220px]" aria-hidden="true" />
      )}
    </div>
  );
}

function Stat({ label, value, pending }: { label: string; value: string; pending: boolean }): ReactNode {
  return (
    <p className="min-w-0">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{label}</span>
      {pending ? (
        <span className="mt-1 block h-4 w-14 motion-safe:animate-pulse bg-muted" />
      ) : (
        <span className="mt-1 block font-mono text-[16px] leading-none tabular-nums max-[561px]:text-[14px]">{value}</span>
      )}
    </p>
  );
}

function Fact({ term, value, onCopy }: { term: string; value: string; onCopy?: () => void }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{term}</dt>
      <dd className="min-w-0 text-right">
        {onCopy ? (
          <button type="button" className="font-mono text-[11px] hover:text-accent-ink" onClick={onCopy}>
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function TokenMark({ launch }: { launch: VerifiedLaunch }): ReactNode {
  if (!launch.imageUrl) {
    return <span className="h-14 w-14 shrink-0 rounded-md border border-solid border-border bg-card" aria-hidden="true" />;
  }
  return (
    // Gateway hosts are chosen at pin time, so this cannot be limited to one Next image domain.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={launch.imageUrl} alt="" width={56} height={56} decoding="async" fetchPriority="high" className="h-14 w-14 shrink-0 rounded-md bg-card object-cover" />
  );
}
