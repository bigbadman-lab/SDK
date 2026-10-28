"use client";

import {
  formatHolderCount,
  formatTokenPrice,
  formatUsdCompact,
  formatUtcStamp,
  SDK_MARKET_REFRESH_MS,
  type OfficialQuote,
} from "@/lib/sdk/official";
import { explorerUrl } from "@/lib/launch/verified-launch";
import type { SdkRouteScope } from "@/lib/sdk/rehearsal";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

type Phase = "prelaunch" | "registered" | "live" | "unavailable";

const EMPTY_QUOTE: OfficialQuote = { marketCapUsd: null, priceUsd: null, volumeUsd: null, holders: null };
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function SdkBoard({
  phase,
  mint,
  market,
  scope = "production",
  notice = null,
}: {
  phase: Phase;
  mint: string | null;
  market: { updatedAt: number; quote: OfficialQuote } | null;
  scope?: SdkRouteScope;
  notice?: string | null;
}): ReactNode {
  const [quote, setQuote] = useState<OfficialQuote | null>(market?.quote ?? null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(market?.updatedAt ?? null);
  const showMarket = phase === "live" || phase === "registered";
  const [marketOk, setMarketOk] = useState(showMarket ? market !== null : true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (phase !== "live" && phase !== "registered") return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      void fetch(scope === "test" ? "/api/sdk/market?scope=test" : "/api/sdk/market", { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as { ok?: boolean; quote?: OfficialQuote | null; updatedAt?: number | null };
          if (cancelled) return;
          if (!response.ok || body.ok !== true || !body.quote || typeof body.updatedAt !== "number") {
            setQuote(null);
            setUpdatedAt(null);
            setMarketOk(false);
            return;
          }
          setQuote(body.quote);
          setUpdatedAt(body.updatedAt);
          setMarketOk(true);
        })
        .catch(() => {
          if (cancelled) return;
          setQuote(null);
          setUpdatedAt(null);
          setMarketOk(false);
        });
    };
    const timer = window.setInterval(load, SDK_MARKET_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, scope]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyMint(): Promise<void> {
    if (!mint) return;
    const copiedMint = await copyText(mint);
    if (copiedMint) setCopied(true);
  }

  const shown = (phase === "live" || phase === "registered") && marketOk ? (quote ?? EMPTY_QUOTE) : EMPTY_QUOTE;

  return (
    <>
      <section className="mt-8 border border-border bg-card px-4 py-4">
        <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{scope === "test" ? "Rehearsal mint" : "Official mint"}</p>
        {mint ? (
          <button
            type="button"
            className="mt-2 block w-full text-left font-mono text-[13px] break-all hover:text-accent-ink"
            aria-label={`${scope === "test" ? "Copy rehearsal mint" : "Copy official mint"} ${mint}`}
            onClick={() => void copyMint()}
          >
            {copied ? "Copied" : mint}
          </button>
        ) : (
          <p className="mt-2 text-[15px]">Not registered</p>
        )}
        {mint ? (
          <a className="mt-2 inline-block font-mono text-[11px] underline" href={explorerUrl(mint)} rel="noreferrer">
            View on Solana explorer
          </a>
        ) : null}
        {phase === "registered" ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-[1.55] text-muted-foreground">
            The canonical $SDK mint is registered.
          </p>
        ) : null}
        {phase === "prelaunch" ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-[1.55] text-muted-foreground">
            {notice ?? "The official $SDK mint is not registered. Market figures appear here once production is activated."}
          </p>
        ) : null}
        {phase === "unavailable" ? (
          <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">{notice ?? "The official mint could not be read."}</p>
        ) : null}
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.6px] max-[561px]:text-[26px]">Market overview</h2>
          <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            {phase === "prelaunch"
              ? "Not registered"
              : marketOk && updatedAt !== null
                ? `Updated ${formatUtcStamp(updatedAt)}`
                : "Market data unavailable"}
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px border border-border bg-border min-[801px]:grid-cols-4">
          <Metric label="Market cap" value={formatUsdCompact(shown.marketCapUsd)} />
          <Metric label="Price" value={formatTokenPrice(shown.priceUsd)} />
          <Metric label="Vol 24h" value={formatUsdCompact(shown.volumeUsd)} />
          <Metric label="Holders" value={formatHolderCount(shown.holders)} />
        </div>
      </section>

      <SdkChart mint={mint} />
      <p className="sr-only" aria-live="polite">{copied ? "Mint address copied" : ""}</p>
    </>
  );
}

function SdkChart({ mint }: { mint: string | null }): ReactNode {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const src = mint && MINT.test(mint) ? dexscreenerEmbed(mint, theme) : null;
  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.6px] max-[561px]:text-[26px]">Chart</h2>
        {src && mint ? (
          <a className="font-mono text-[10px] tracking-[0.04em] uppercase hover:text-accent-ink" href={dexscreenerPage(mint)} rel="noreferrer">
            Dexscreener
          </a>
        ) : null}
      </div>
      {src ? (
        <iframe
          title="$SDK price chart"
          src={src}
          className="mt-4 h-[560px] w-full border border-border bg-card max-[561px]:h-[420px]"
          loading="lazy"
        />
      ) : (
        <p className="mt-4 text-[14px] leading-[1.55] text-muted-foreground">The $SDK chart appears here once the canonical mint is registered.</p>
      )}
    </section>
  );
}

function dexscreenerPage(mint: string): string {
  return `https://dexscreener.com/solana/${mint}`;
}

function dexscreenerEmbed(mint: string, theme: "dark" | "light"): string {
  const params = new URLSearchParams({
    embed: "1",
    loadChartSettings: "0",
    trades: "0",
    tabs: "0",
    info: "0",
    chartLeftToolbar: "0",
    chartDefaultOnMobile: "1",
    chartTheme: theme,
    theme,
    chartStyle: "1",
    chartType: "usd",
    interval: "15",
  });
  return `${dexscreenerPage(mint)}?${params.toString()}`;
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <p className="min-w-0 bg-background px-3 py-3">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{label}</span>
      <span className="mt-2 block font-mono text-[16px] leading-none tabular-nums max-[561px]:text-[14px]">{value}</span>
    </p>
  );
}

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
