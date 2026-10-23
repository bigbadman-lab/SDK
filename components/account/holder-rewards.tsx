import Link from "next/link";
import type { ReactNode } from "react";

import { AccountSectionHeading } from "@/components/account/account-skeleton";
import { ClaimActions } from "@/components/account/claim-actions";
import type { AccountRewardsView, RewardActivity } from "@/lib/rewards/account-view";
import { formatSol } from "@/lib/sdk/official";

function add(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function activityLabel(status: RewardActivity["status"]): string {
  if (status === "paid") return "Confirmed transfer";
  if (status === "pending") return "Awaiting confirmation";
  if (status === "uncertain") return "Unresolved";
  if (status === "failed") return "Failed";
  return "Allocated";
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
  const allocatedSol = add(add(view.claimableSol, view.pendingSol), view.paidSol);
  const noAllocation = allocatedSol === "0" && view.activity.length === 0;
  return (
    <section id="rewards" className="grid gap-6 border-t border-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {rehearsal ? (
            <p className="mb-3 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">TREST rehearsal</p>
          ) : null}
          <AccountSectionHeading index="04" title={rehearsal ? "TREST claimable balances" : "Holder Rewards"} titleId="holder-rewards-title">
            {rehearsal
              ? `These figures are TREST rehearsal entitlements for ${wallet}. They are separate from production $SDK rewards.`
              : "Track your native $SDK SOL allocations, claimable rewards and claim history."}
          </AccountSectionHeading>
        </div>
        <div className="flex gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
          <Link href="/account">Overview</Link>
          <Link href={rehearsal ? "/account?scope=test#rewards" : "/account#rewards"}>Rewards</Link>
          <Link href={rehearsal ? "/account?scope=test#earnings" : "/account#earnings"}>Creator Earnings</Link>
        </div>
      </div>
      {rehearsal ? null : (
        <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">{view.custody}</p>
      )}
      {view.ledger === "missing" ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          {view.executionReason === "Rewards could not be read."
            ? "Rewards could not be read."
            : "The rewards ledger is unavailable."}
        </p>
      ) : closed ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          {rehearsal
            ? "No TREST parent is registered, so there is no claimable rehearsal balance."
            : "Production $SDK rewards stay closed until that parent is registered. This page is not showing TREST balances."}
        </p>
      ) : noAllocation ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">No holder rewards allocated yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SolFigure label="SOL allocated" lamports={allocatedSol} detail="Ledger entitlement for this wallet." />
          <SolFigure label="Claimable SOL" lamports={view.claimableSol} detail="Available to claim. This is not a wallet balance." />
          <SolFigure label="SOL claimed" lamports={view.paidSol} detail="Confirmed transfers already recorded." />
          <SolFigure label="Awaiting confirmation" lamports={view.pendingSol} detail="Submitted claims that are not confirmed transfers." />
          <div className="rounded-lg border border-border p-4 sm:col-span-2">
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Parent-token rewards</p>
            <p className="mt-3 text-[22px]">{view.claimableToken} base units claimable</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {view.pendingToken} base units awaiting confirmation. {view.paidToken} base units confirmed.
            </p>
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
            <span>
              {activityLabel(item.status)}{" "}
              {item.asset === "sol" ? formatSol(item.amount) : `${item.amount} parent-token base units`}
            </span>
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
    <section id="earnings" className="grid gap-5 border-t border-border pt-8" aria-labelledby="creator-earnings-title">
      <AccountSectionHeading index="05" title="Creator Earnings" titleId="creator-earnings-title">
        Track fees earned from tokens launched through SDK.
      </AccountSectionHeading>
      <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">
        Creator earnings are separate from native holder rewards. A confirmed receipt is a fee that was actually received.
      </p>
      {view.ledger === "missing" ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">The distribution ledger is not available yet.</p>
      ) : launcher.length === 0 && developer.length === 0 ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">No creator earnings recorded yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Launcher</p>
            {launcher.length === 0 ? <p className="mt-3 text-[14px] text-muted-foreground">No confirmed launcher receipts.</p> : null}
            {launcher.map((row) => (
              <p key={`${row.mint}-${row.amount}`} className="mt-3 text-[14px] break-all">
                {row.signature ? `Received ${row.amount} of ${row.mint}` : `${row.amount} of ${row.mint} is recorded and awaiting settlement.`}
              </p>
            ))}
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Original developer</p>
            {developer.length === 0 ? <p className="mt-3 text-[14px] text-muted-foreground">No confirmed developer receipts.</p> : null}
            {developer.map((row) => (
              <p key={`${row.mint}-${row.amount}-developer`} className="mt-3 text-[14px] break-all">
                {row.signature ? `Received ${row.amount} of ${row.mint}` : `${row.amount} of ${row.mint} is recorded and awaiting settlement.`}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SolFigure({ label, lamports, detail }: { label: string; lamports: string; detail: string }): ReactNode {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">{label}</p>
      <p className="mt-3 text-[22px]">{formatSol(lamports)}</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{lamports} lamports</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{detail}</p>
    </div>
  );
}
