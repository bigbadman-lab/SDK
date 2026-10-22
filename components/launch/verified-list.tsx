import { explorerUrl, formatVerifiedAt, shortenAddress, type VerifiedLaunch } from "@/lib/launch/verified-launch";
import Link from "next/link";
import type { ReactNode } from "react";

export function VerifiedLaunchList({
  launches,
  empty,
}: {
  launches: readonly VerifiedLaunch[];
  empty: string;
}): ReactNode {
  if (launches.length === 0) {
    return <p className="text-[15px] leading-[1.7] text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="grid gap-4">
      {launches.map((launch) => (
        <li key={launch.childMint}>
          <VerifiedLaunchCard launch={launch} />
        </li>
      ))}
    </ul>
  );
}

export function VerifiedLaunchCard({ launch }: { launch: VerifiedLaunch }): ReactNode {
  return (
    <article className="grid gap-4 border border-solid border-border p-4 min-[561px]:grid-cols-[72px_minmax(0,1fr)] min-[561px]:p-5">
      <TokenImage launch={launch} />
      <div className="min-w-0">
        <h2 className="text-[18px] leading-[1.3]">
          {launch.name} <span className="text-muted-foreground">${launch.symbol}</span>
        </h2>
        <p className="mt-1 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          Paired with {launch.pairLabel}
          {launch.scope === "test" ? " · Test parent" : ""}
        </p>
        <dl className="mt-3 grid gap-2 text-[14px] leading-[1.45]">
          <Fact term="SDK" value={launch.sdkName} />
          <Fact term="Creator" value={shortenAddress(launch.creator)} />
          <Fact term="Verified" value={formatVerifiedAt(launch.verifiedAt)} />
          <Fact term="Mint" value={shortenAddress(launch.childMint)} />
        </dl>
        <LaunchLinks launch={launch} />
      </div>
    </article>
  );
}

export function VerifiedLaunchDetail({ launch }: { launch: VerifiedLaunch }): ReactNode {
  return (
    <article className="grid gap-6">
      <div className="grid items-center gap-4 min-[561px]:grid-cols-[96px_minmax(0,1fr)]">
        <TokenImage launch={launch} large />
        <div className="min-w-0">
          <h1 className="font-display text-[48px] leading-[1.08] tracking-[-1.4px] max-[561px]:text-[36px]">
            {launch.name}
          </h1>
          <p className="mt-2 text-[16px] text-muted-foreground">${launch.symbol}</p>
          <p className="mt-3 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
            Paired with {launch.pairLabel}
            {launch.scope === "test" ? " · Test parent" : ""}
          </p>
        </div>
      </div>
      <dl className="grid gap-3 text-[15px] leading-[1.5]">
        <Fact term="Mint" value={launch.childMint} mono />
        <Fact term="Parent" value={`${launch.pairLabel} · ${launch.parentMint}`} mono />
        <Fact term="SDK" value={launch.sdkName} />
        <Fact term="Creator" value={launch.creator} mono />
        <Fact term="Originator" value={launch.originatorLabel} />
        <Fact term="Verified" value={formatVerifiedAt(launch.verifiedAt)} />
        <Fact term="Slot" value={launch.slot} mono />
        <Fact term="Signature" value={launch.signature} mono />
      </dl>
      <LaunchLinks launch={launch} detail />
    </article>
  );
}

function TokenImage({ launch, large = false }: { launch: VerifiedLaunch; large?: boolean }): ReactNode {
  const size = large ? "h-24 w-24" : "h-16 w-16";
  if (!launch.imageUrl) {
    return <div className={`${size} border border-solid border-border bg-card`} aria-hidden="true" />;
  }
  return (
    // Gateway hosts are chosen at pin time, so this cannot be limited to one Next image domain.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={launch.imageUrl} alt={`${launch.name} artwork`} className={`${size} object-contain`} />
  );
}

function LaunchLinks({ launch, detail = false }: { launch: VerifiedLaunch; detail?: boolean }): ReactNode {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.04em] uppercase">
      {detail ? null : <Link href={`/token/${launch.childMint}`}>Token</Link>}
      {launch.sdkHref ? <Link href={launch.sdkHref}>SDK</Link> : null}
      <a href={explorerUrl(launch.childMint)} rel="noreferrer">
        Explorer
      </a>
      <a href={explorerUrl(launch.signature, "tx")} rel="noreferrer">
        Transaction
      </a>
    </div>
  );
}

function Fact({ term, value, mono = false }: { term: string; value: string; mono?: boolean }): ReactNode {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={`min-w-0 break-all ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}
