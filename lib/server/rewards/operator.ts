import "server-only";

import { databaseFailure, getSql } from "@/lib/server/db.ts";

export type OperatorRewards = {
  ledger: "missing" | "ready";
  worker: { signer?: string; signing?: boolean; broadcasts?: boolean; loop?: boolean; executionAuthorised?: boolean; runtime?: string; http?: string } | null;
  windows: number;
  pendingClaims: number;
  confirmedClaims: number;
  uncertain: number;
  distributions: number;
  failedDistributions: number;
  sweep: { mode: string; status: string; destination: string; shortfall: boolean; signature: string | null } | null;
};

export async function loadOperatorRewards(): Promise<OperatorRewards> {
  const empty: OperatorRewards = {
    ledger: "missing",
    worker: null,
    windows: 0,
    pendingClaims: 0,
    confirmedClaims: 0,
    uncertain: 0,
    distributions: 0,
    failedDistributions: 0,
    sweep: null,
  };
  const workerUrl = process.env.REWARDS_WORKER_URL?.trim();
  if (workerUrl) {
    try {
      const response = await fetch(new URL("/health", workerUrl), { cache: "no-store" });
      if (response.ok) empty.worker = (await response.json()) as OperatorRewards["worker"];
    } catch {
      empty.worker = null;
    }
  }
  try {
    const sql = getSql();
    const windows = await sql<{ count: string }[]>`select count(*)::text as count from reward_windows`;
    const claims = await sql<{ status: string; count: string }[]>`select status, count(*)::text as count from reward_claims group by status`;
    empty.ledger = "ready";
    empty.windows = Number(windows[0]?.count ?? "0");
    for (const row of claims) {
      if (row.status === "confirmed") empty.confirmedClaims = Number(row.count);
      else if (row.status === "uncertain" || row.status === "unreconciled" || row.status === "failed") empty.uncertain += Number(row.count);
      else empty.pendingClaims += Number(row.count);
    }
    try {
      const distributions = await sql<{ status: string; count: string }[]>`
        select status, count(*)::text as count from child_fee_distributions group by status
      `;
      for (const row of distributions) {
        empty.distributions += Number(row.count);
        if (row.status === "failed" || row.status === "uncertain" || row.status === "unreconciled") empty.failedDistributions += Number(row.count);
      }
      const sweeps = await sql<{ mode: string; status: string; destination_address: string; shortfall: boolean; signature: string | null }[]>`
        select mode, status, destination_address, shortfall, signature
        from emergency_sweeps
        order by created_at desc
        limit 1
      `;
      const sweep = sweeps[0];
      if (sweep) {
        empty.sweep = {
          mode: sweep.mode,
          status: sweep.status,
          destination: sweep.destination_address,
          shortfall: sweep.shortfall,
          signature: sweep.signature,
        };
      }
    } catch (error) {
      if (databaseFailure(error) !== "missing_schema") throw error;
    }
    return empty;
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") return empty;
    return empty;
  }
}
