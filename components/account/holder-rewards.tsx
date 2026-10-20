import Link from "next/link";
import type { ReactNode } from "react";

import { ClaimActions } from "@/components/account/claim-actions";
import type { AccountRewardsView } from "@/lib/rewards/account-view";

function amount(value: string, unit: string): string {
  return value === "0" ? `0 ${unit}` : `${value} ${unit}`;
}

function receipt(signature: string | null): ReactNode {
  if (!signature) return "No signature";
  return (
    <a className="underline" href={`https://solscan.io/tx/${signature}`} rel="noreferrer">
      {signature.slice(0, 8)}…
    </a>
  );
}

export function HolderRewards({
  view,
  wallet,
}: {
  view: AccountRewardsView;
  wallet: string;
}): ReactNode {
  const rehearsal = view.scope === "test";
  const closed = view.symbol === null;
  return (
    <section id="rewards" className="grid gap-6 border-t border-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
            {rehearsal ? "TREST rehearsal" : "Native holder rewards"}
          </span>
          <h2 className="mt-3 font-display text-[32px] leading-[1.15] tracking-[-0.8px] max-[561px]:text-[26px]">
            {rehearsal ? "TREST claimable balances" : "Holder rewards"}
          </h2>
        </div>
        <div className="flex gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
          <Link href="/account">Overview</Link>
          <Link href={rehearsal ? "/account?scope=test#rewards" : "/account#rewards"}>Rewards</Link>
          <Link href={rehearsal ? "/account?scope=test#earnings" : "/account#earnings"}>SDK Earnings</Link>
        </div>
      </div>
      {rehearsal ? (
        <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">
          These figures are TREST rehearsal entitlements for {wallet}. They are separate from production $SDK rewards.
        </p>
      ) : (
        <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">{view.custody}</p>
      )}
      {closed ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          {rehearsal
            ? "No TREST parent is registered, so there is no claimable rehearsal balance."
            : "Production $SDK rewards stay closed until that parent is registered. This page is not showing TREST balances."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Claimable SOL</p>
            <p className="mt-3 text-[22px]">{amount(view.claimableSol, "lamports")}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">Pending {amount(view.pendingSol, "lamports")}. Paid {amount(view.paidSol, "lamports")}.</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Claimable parent tokens</p>
            <p className="mt-3 text-[22px]">{amount(view.claimableToken, "base units")}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">Pending {amount(view.pendingToken, "base units")}. Paid {amount(view.paidToken, "base units")}.</p>
          </div>
        </div>
      )}
      <dl className="grid gap-3 text-[14px] leading-[1.6] text-muted-foreground">
        <div className="flex justify-between gap-4"><dt>Eligibility</dt><dd>{view.eligible === null ? "No snapshot" : view.eligible ? "Eligible at the last snapshot" : "Below the last snapshot minimum"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Snapshot balance</dt><dd>{view.snapshotBalance ?? "None"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Current wallet balance</dt><dd>{view.currentBalance ?? "Not observed from this server"}</dd></div>
        <div className="flex justify-between gap-4"><dt>Minimum holding</dt><dd>{view.minimumWholeTokens.toLocaleString("en-US")} whole tokens</dd></div>
        <div className="flex justify-between gap-4"><dt>Last window</dt><dd>{view.lastWindow ?? "No completed window"}</dd></div>
      </dl>
      <ClaimActions scope={view.scope} disabled={closed || view.ledger === "missing"} />
      <p className="text-[14px] leading-[1.6] text-muted-foreground">{view.executionReason}</p>
      <div className="grid gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.04em] uppercase">Activity</h3>
        {view.activity.length === 0 ? <p className="text-[14px] text-muted-foreground">No reward activity.</p> : null}
        {view.activity.map((item, index) => (
          <p key={`${item.asset}-${item.amount}-${index}`} className="flex flex-wrap justify-between gap-3 text-[14px]">
            <span>{item.status} {item.asset === "sol" ? "SOL" : "parent token"} {item.amount}</span>
            <span>{receipt(item.signature)}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

export function SdkEarnings({ view }: { view: AccountRewardsView }): ReactNode {
  const launcher = view.earnings.filter((row) => row.role === "launcher");
  const developer = view.earnings.filter((row) => row.role === "developer");
  return (
    <section id="earnings" className="grid gap-5 border-t border-border pt-8">
      <span className="font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">SDK Earnings</span>
      <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.8px] max-[561px]:text-[26px]">Child-token fees</h2>
      <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">
        These are quote-token distributions from launched children. They are separate from native holder SOL and parent-token rewards.
        {view.ledger === "missing" ? " The distribution ledger is not available yet." : " No figure below is a holder-reward balance."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Launcher</p>
          {launcher.length === 0 ? <p className="mt-3 text-[14px] text-muted-foreground">No confirmed launcher distributions.</p> : null}
          {launcher.map((row) => (
            <p key={`${row.mint}-${row.amount}`} className="mt-3 text-[14px]">{row.amount} of {row.mint}</p>
          ))}
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Original developer</p>
          {developer.length === 0 ? <p className="mt-3 text-[14px] text-muted-foreground">No confirmed developer distributions.</p> : null}
          {developer.map((row) => (
            <p key={`${row.mint}-${row.amount}-developer`} className="mt-3 text-[14px]">{row.amount} of {row.mint}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
