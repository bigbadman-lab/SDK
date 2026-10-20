import type { ReactNode } from "react";

import type { OperatorRewards } from "@/lib/server/rewards/operator";

function line(label: string, value: string): ReactNode {
  return (
    <div className="flex justify-between gap-4 text-[14px] leading-[1.6]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function RewardsMonitor({ status }: { status: OperatorRewards }): ReactNode {
  const worker = status.worker;
  return (
    <section className="mt-10 grid gap-5 border-t border-border pt-8">
      <h2 className="font-display text-[32px] leading-[1.15]">Rewards status</h2>
      <dl className="grid gap-2">
        {line("Ledger", status.ledger === "ready" ? "Readable" : "Schema not available")}
        {line("HTTP", worker ? "ok" : "Not reported")}
        {line("Financial runtime", worker && "runtime" in worker && typeof worker.runtime === "string" ? worker.runtime : "Not reported")}
        {line("Worker signer", worker?.signer ?? "Not reported")}
        {line("Signing", worker ? String(worker.signing === true) : "Not reported")}
        {line("Broadcasts", worker ? String(worker.broadcasts === true) : "Not reported")}
        {line("Loop", worker ? String(worker.loop === true) : "Not reported")}
        {line("Execution authorised", worker ? String(worker.executionAuthorised === true) : "Not reported")}
        {line("Accounting windows", String(status.windows))}
        {line("Pending claims", String(status.pendingClaims))}
        {line("Confirmed claims", String(status.confirmedClaims))}
        {line("Failed or uncertain claims", String(status.uncertain))}
        {line("Child distributions", String(status.distributions))}
        {line("Failed or uncertain distributions", String(status.failedDistributions))}
      </dl>
      <div className="grid gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.04em] uppercase">Emergency control</h3>
        {status.sweep ? (
          <dl className="grid gap-2">
            {line("Last record", status.sweep.mode)}
            {line("Status", status.sweep.status)}
            {line("Destination", status.sweep.destination)}
            {line("Holder-liability shortfall", status.sweep.shortfall ? "Recorded" : "None recorded")}
            {line("Signature", status.sweep.signature ?? "None")}
          </dl>
        ) : (
          <p className="text-[14px] leading-[1.6] text-muted-foreground">
            No dry-run has been recorded. The emergency destination is configured only on the rewards worker, and this page does not store it.
          </p>
        )}
      </div>
    </section>
  );
}
