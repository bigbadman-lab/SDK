"use client";

import { formatAge, formatCount, formatUsd, type MarketQuote } from "@/lib/market/quote";
import {
  explorerUrl,
  formatVerifiedAt,
  shortenAddress,
  type PublishedTokenSdk,
  type VerifiedLaunch,
} from "@/lib/launch/verified-launch";
import Link from "next/link";
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

export function TokenExperience({
  launch,
  sdk,
  baseUrl,
}: {
  launch: VerifiedLaunch;
  sdk: PublishedTokenSdk | null;
  baseUrl: string;
}): ReactNode {
  const [quote, setQuote] = useState<MarketQuote>(EMPTY);
  const [live, setLive] = useState(false);
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
      if (document.hidden) return;
      const url = `/api/paired/markets?mint=${encodeURIComponent(launch.childMint)}`;
      void fetch(url, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as MarketBody;
          if (cancelled) return;
          setLive(response.ok && body.ok === true);
          setQuote(body.quotes?.[launch.childMint] ?? EMPTY);
        })
        .catch(() => {
          if (!cancelled) setLive(false);
        });
    };
    load();
    const timer = window.setInterval(load, 2_000);
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

  const snippet = sdk ? clientSnippet(sdk, baseUrl) : "";

  return (
    <div className="grid gap-8 min-[801px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[801px]:gap-10">
      <section>
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
          <Stat label="FDV" value={formatUsd(quote.fdv)} />
          <Stat label="Vol 24h" value={formatUsd(quote.volumeUsd)} />
          <Stat label="Holders" value={formatCount(quote.holders)} />
        </div>
        <p className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted-foreground"}`} aria-hidden="true" />
          {live ? "Live · 2s" : "Market data delayed"}
        </p>
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
      </section>
      <section>
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">This token&apos;s SDK</p>
        <h2 className="mt-2 text-[24px] leading-none tracking-[-0.4px]">{sdk?.name ?? launch.sdkName}</h2>
        {sdk ? (
          <>
            <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              {sdk.origin === "official" ? "Official" : "Community"} · {sdk.originatorLabel} · Version {sdk.versionNumber}
            </p>
            <p className="mt-3 text-[14px] leading-[1.55] text-muted-foreground">{sdk.description}</p>
            <p className="mt-3 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              {sdk.inputs.length === 0
                ? "No inputs"
                : `Asks for ${sdk.inputs.map((field) => field.key).join(", ")}`}
            </p>
            <ul className="mt-4 border-y border-border">
              <Access
                label="Library"
                title={sdk.name}
                href={`/library/${sdk.id}`}
                body="Read what it accepts, test it while signed in, or remix it."
              />
              <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 border-b border-border py-3">
                <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">API</span>
                <div className="min-w-0">
                  <button
                    type="button"
                    className="font-mono text-[12px] break-all text-left hover:text-accent-ink"
                    aria-label={`Copy SDK id ${sdk.id}`}
                    onClick={() => copy(sdk.id)}
                  >
                    {copied === sdk.id ? "Copied" : sdk.id}
                  </button>
                  <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">
                    POST /api/v1/sdk/execute with an Account API key. Version {sdk.versionNumber} is current. Omit version to run the latest.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 py-3">
                <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Client</span>
                <div className="min-w-0">
                  <p className="text-[12px] leading-[1.45] text-muted-foreground">
                    The universal client is in this repository and is not on NPM.{" "}
                    <Link href="/account" className="underline">Create a key</Link>
                    {" · "}
                    <Link href="/code" className="underline">Client guide</Link>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Run this SDK</p>
                    <button type="button" className="font-mono text-[10px] tracking-[0.04em] uppercase" onClick={() => copy(snippet)}>
                      {copied === snippet ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="mt-2 overflow-x-auto border border-border bg-card p-3 font-mono text-[11px] leading-[1.55]">{snippet}</pre>
                </div>
              </li>
            </ul>
          </>
        ) : (
          <p className="mt-3 text-[14px] leading-[1.55] text-muted-foreground">
            {launch.sdkName} is private to its launcher. It is not in the Library, and an API key cannot run it.
          </p>
        )}
      </section>
      <p className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</p>
    </div>
  );
}

function clientSnippet(sdk: PublishedTokenSdk, baseUrl: string): string {
  const fields = sdk.inputs.map((field) => `    ${field.key}: ""`).join(",\n");
  const input = fields.length === 0 ? "  input: {}," : `  input: {\n${fields},\n  },`;
  return `import { SDKClient } from "sdk-universal-client";

const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: ${JSON.stringify(baseUrl)},
});

const result = await client.run({
  sdkId: ${JSON.stringify(sdk.id)},
  version: ${sdk.versionNumber},
${input}
});`;
}

function Access({ label, title, href, body }: { label: string; title: string; href: string; body: string }): ReactNode {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 border-b border-border py-3">
      <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">{label}</span>
      <div>
        <Link href={href} className="text-[14px] hover:text-accent-ink">{title}</Link>
        <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <p className="min-w-0">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{label}</span>
      <span className="mt-1 block font-mono text-[16px] leading-none tabular-nums max-[561px]:text-[14px]">{value}</span>
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
    <img src={launch.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-md bg-card object-cover" />
  );
}
