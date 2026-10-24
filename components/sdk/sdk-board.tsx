"use client";

import {
  formatHolderCount,
  formatSol,
  formatTokenBalance,
  formatTokenPrice,
  formatUsdCompact,
  formatUtcStamp,
  formatWindow,
  SDK_MARKET_REFRESH_MS,
  type OfficialQuote,
  type SdkAllocation,
  type SdkSummary,
} from "@/lib/sdk/official";
import { explorerUrl, shortenAddress } from "@/lib/launch/verified-launch";
import type { HistoricalRecoveryView, RehearsalFigures, RehearsalWindowStatus, SdkRouteScope } from "@/lib/sdk/rehearsal";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type Phase = "prelaunch" | "live" | "unavailable";

const EMPTY_QUOTE: OfficialQuote = { marketCapUsd: null, priceUsd: null, volumeUsd: null, holders: null };

export function SdkBoard({
  phase,
  mint,
  decimals,
  market,
  summary,
  rows,
  nextCursor,
  rewardsOk,
  rewardLead,
  rewardQualify,
  scope = "production",
  tokenSymbol = "$SDK",
  notice = null,
  figures = null,
  historical = null,
}: {
  phase: Phase;
  mint: string | null;
  decimals: number | null;
  market: { updatedAt: number; quote: OfficialQuote } | null;
  summary: SdkSummary | null;
  rows: SdkAllocation[];
  nextCursor: string | null;
  rewardsOk: boolean;
  rewardLead: string;
  rewardQualify: string;
  scope?: SdkRouteScope;
  tokenSymbol?: string;
  notice?: string | null;
  figures?: RehearsalFigures | null;
  historical?: HistoricalRecoveryView | null;
}): ReactNode {
  const [quote, setQuote] = useState<OfficialQuote | null>(market?.quote ?? null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(market?.updatedAt ?? null);
  const [marketOk, setMarketOk] = useState(phase !== "live" || market !== null);
  const [copied, setCopied] = useState(false);
  const [allocations, setAllocations] = useState(rows);
  const [cursor, setCursor] = useState(nextCursor);
  const [more, setMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    if (phase !== "live") return;
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

  async function loadMore(): Promise<void> {
    if (!cursor || more) return;
    setMore(true);
    setMoreFailed(false);
    try {
      const scopeQuery = scope === "test" ? "&scope=test" : "";
      const response = await fetch(`/api/sdk/allocations?cursor=${encodeURIComponent(cursor)}${scopeQuery}`, { cache: "no-store" });
      const body = (await response.json()) as { ok?: boolean; rows?: SdkAllocation[]; nextCursor?: string | null };
      if (!response.ok || body.ok !== true || !Array.isArray(body.rows)) {
        setMoreFailed(true);
        return;
      }
      const next = body.rows.filter(isAllocation);
      setAllocations((current) => [...current, ...next]);
      setCursor(typeof body.nextCursor === "string" ? body.nextCursor : null);
    } catch {
      setMoreFailed(true);
    } finally {
      setMore(false);
    }
  }

  const shown = phase === "live" && marketOk ? (quote ?? EMPTY_QUOTE) : EMPTY_QUOTE;
  const rewardSummary = phase === "live" && rewardsOk ? summary : null;

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
        {scope === "test" && mint ? (
          <a className="mt-2 inline-block font-mono text-[11px] underline" href={explorerUrl(mint)} rel="noreferrer">
            View on Solana explorer
          </a>
        ) : null}
        {phase === "prelaunch" ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-[1.55] text-muted-foreground">
            {notice ?? "The official $SDK mint is not registered. Market figures and holder allocations appear here once production is activated."}
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

      <section className="mt-12">
        <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.6px] max-[561px]:text-[26px]">Native SOL Rewards</h2>
        <div className="mt-4 max-w-2xl text-[14px] leading-[1.65] text-muted-foreground">
          <p>{rewardLead}</p>
          <p className="mt-3">{rewardQualify}</p>
          <p className="mt-3">Rewards accumulate as claimable SOL. They are not transferred automatically.</p>
          {scope === "test" ? (
            <p className="mt-3">
              <Link className="underline" href="/account?scope=test#holder-rewards-title">Open TREST holder rewards</Link>
            </p>
          ) : null}
        </div>
        {scope === "test" ? <RehearsalFiguresPanel figures={figures} historical={historical} /> : (
          <div className="mt-4 grid gap-px border border-border bg-border min-[801px]:grid-cols-3">
            <Metric label="Allocated to holders" value={rewardSummary ? formatSol(rewardSummary.totalLamports) : "—"} />
            <Metric label="Last 24 hours" value={rewardSummary ? formatSol(rewardSummary.dayLamports) : "—"} />
            <Metric
              label="Latest window"
              value={
                rewardSummary?.latestWindowStart && rewardSummary.latestWindowEnd
                  ? formatWindow(rewardSummary.latestWindowStart, rewardSummary.latestWindowEnd)
                  : "—"
              }
            />
          </div>
        )}
        <AllocationTable
          phase={phase}
          decimals={decimals}
          rows={allocations}
          rewardsOk={rewardsOk}
          tokenSymbol={tokenSymbol}
        />
        {cursor ? (
          <button
            type="button"
            className="mt-3 font-mono text-[10px] tracking-[0.04em] uppercase hover:text-accent-ink disabled:text-muted-foreground"
            disabled={more}
            onClick={() => void loadMore()}
          >
            {more ? "Loading" : "Load more"}
          </button>
        ) : null}
        {moreFailed ? <p className="mt-2 text-[13px] text-muted-foreground">More allocations could not be loaded.</p> : null}
      </section>
      <p className="sr-only" aria-live="polite">{copied ? "Mint address copied" : ""}</p>
    </>
  );
}

function AllocationTable({
  phase,
  decimals,
  rows,
  rewardsOk,
  tokenSymbol,
}: {
  phase: Phase;
  decimals: number | null;
  rows: SdkAllocation[];
  rewardsOk: boolean;
  tokenSymbol: string;
}): ReactNode {
  if (phase !== "live" || !rewardsOk) {
    return (
      <p className="mt-4 text-[14px] leading-[1.55] text-muted-foreground">
        {phase === "prelaunch" ? "No holder allocations yet." : "Holder allocations are unavailable."}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="mt-4 text-[14px] leading-[1.55] text-muted-foreground">No holder allocations have been recorded.</p>;
  }
  return (
    <>
      <p className="mt-4 text-[13px] leading-[1.5] text-muted-foreground">
        These rows are SOL allocated to holders. They are not claims or transfers.
      </p>
      <ul className="mt-3 divide-y divide-border border border-border min-[801px]:hidden">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-2 px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <time className="font-mono text-[11px]">{formatUtcStamp(Date.parse(row.windowStart))}</time>
              <a className="font-mono text-[12px] underline" href={explorerUrl(row.owner)} rel="noreferrer">
                {shortenAddress(row.owner)}
              </a>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Mini label="Balance" value={formatTokenBalance(row.balance, decimals)} />
              <Mini label="SOL" value={formatSol(row.solLamports)} />
              <Mini label="Window" value={formatWindow(row.windowStart, row.windowEnd)} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden overflow-x-auto border border-border min-[801px]:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              <th className="px-3 py-2 font-normal">Time (UTC)</th>
              <th className="px-3 py-2 font-normal">Holder</th>
              <th className="px-3 py-2 text-right font-normal">{tokenSymbol} balance</th>
              <th className="px-3 py-2 text-right font-normal">SOL allocated</th>
              <th className="px-3 py-2 font-normal">Window</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap">{formatUtcStamp(Date.parse(row.windowStart))}</td>
                <td className="px-3 py-2.5">
                  <a className="font-mono text-[12px] underline" href={explorerUrl(row.owner)} rel="noreferrer">
                    {shortenAddress(row.owner)}
                  </a>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{formatTokenBalance(row.balance, decimals)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{formatSol(row.solLamports)}</td>
                <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap">{formatWindow(row.windowStart, row.windowEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RehearsalFiguresPanel({
  figures,
  historical,
}: {
  figures: RehearsalFigures | null;
  historical: HistoricalRecoveryView | null;
}): ReactNode {
  const figure = (value: string | null | undefined) => value ? formatSol(value) : "—";
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-px border border-border bg-border min-[801px]:grid-cols-4">
        <Metric label="Collected" value={figure(figures?.collectedLamports)} />
        <Metric label="Distributable" value={figure(figures?.distributableLamports)} />
        <Metric label="Holder 50%" value={figure(figures?.holderLamports)} />
        <Metric label="Protocol 50%" value={figure(figures?.protocolLamports)} />
        <Metric label="Reserve" value={figures?.reserveLamports ? `${figure(figures.reserveLamports)}${figures.reserveSatisfied ? " held" : ""}` : "—"} />
        <Metric label="Allocated" value={figure(figures?.allocatedLamports)} />
        <Metric label="Claimable" value={figure(figures?.claimableLamports)} />
        <Metric label="Claimed" value={figure(figures?.claimedLamports)} />
        <Metric label="Unassigned" value={figure(figures?.unassignedLamports)} />
        <Metric label="Last 24 hours" value={figure(figures?.dayLamports)} />
        <Metric label="Latest window" value={figures?.latestStart ? formatUtcStamp(Date.parse(figures.latestStart)) : "—"} />
      </div>
      <WindowHistory rows={figures?.windows ?? []} />
      {historical ? (
        <div className="mt-4 border border-border px-4 py-4">
          <p className="font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Historical TREST activity</p>
          <p className="mt-2 max-w-2xl text-[13px] leading-[1.55] text-muted-foreground">
            Previous 30/30/40 recovery. These amounts stay outside the current 50/50 rehearsal.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-px border border-border bg-border min-[801px]:grid-cols-5">
            <Metric label="Net collected" value={formatSol(historical.netLamports)} />
            <Metric label="Reserve" value={formatSol(historical.reserveLamports)} />
            <Metric label="Deferred holders" value={formatSol(historical.holderLamports)} />
            <Metric label="Buyback" value={formatSol(historical.buybackLamports)} />
            <Metric label="Protocol" value={formatSol(historical.protocolLamports)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function WindowHistory({ rows }: { rows: RehearsalFigures["windows"] }): ReactNode {
  if (rows.length === 0) {
    return <p className="mt-4 text-[14px] leading-[1.55] text-muted-foreground">No reward windows recorded.</p>;
  }
  return (
    <div className="mt-4 max-h-96 overflow-auto border border-border">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">Five-minute reward windows</caption>
        <thead className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-normal">UTC window</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 text-right font-normal">Collected</th>
            <th className="px-3 py-2 text-right font-normal">Holders</th>
            <th className="px-3 py-2 text-right font-normal">Protocol</th>
            <th className="px-3 py-2 text-right font-normal">Eligible</th>
            <th className="px-3 py-2 text-right font-normal">Unassigned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap">{formatUtcStamp(Date.parse(row.start))}</td>
              <td className="px-3 py-2 font-mono text-[12px]">{windowStatus(row.status)}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{row.collectedLamports === null ? "—" : formatSol(row.collectedLamports)}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{row.holderLamports === null ? "—" : formatSol(row.holderLamports)}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{row.protocolLamports === null ? "—" : formatSol(row.protocolLamports)}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{row.eligibleHolders === null ? "—" : String(row.eligibleHolders)}</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{row.unassignedLamports === null ? "—" : formatSol(row.unassignedLamports)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function windowStatus(status: RehearsalWindowStatus): string {
  if (status === "empty") return "Empty";
  if (status === "allocated") return "Allocated";
  if (status === "skipped") return "Skipped";
  if (status === "pending") return "Pending";
  return "Stopped";
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <p className="min-w-0 bg-background px-3 py-3">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{label}</span>
      <span className="mt-2 block font-mono text-[16px] leading-none tabular-nums max-[561px]:text-[14px]">{value}</span>
    </p>
  );
}

function Mini({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <p className="min-w-0">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{label}</span>
      <span className="mt-1 block font-mono text-[11px] leading-[1.35] tabular-nums">{value}</span>
    </p>
  );
}

function isAllocation(value: unknown): value is SdkAllocation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.windowStart === "string" &&
    typeof row.windowEnd === "string" &&
    typeof row.owner === "string" &&
    typeof row.balance === "string" &&
    typeof row.solLamports === "string"
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
