import "server-only";

import { TREST_MINT } from "@/lib/launch/verified-launch";
import { recognizedReserveWithheld } from "@/lib/rewards/ledger";
import {
  composeRehearsalLedger,
  type HistoricalRecoveryView,
  type RehearsalFigures,
} from "@/lib/sdk/rehearsal";
import { getSql } from "@/lib/server/db";

export type RehearsalSdk =
  | {
      ok: true;
      phase: "live";
      mint: string;
      decimals: number;
      figures: RehearsalFigures | null;
      historical: HistoricalRecoveryView | null;
    }
  | { ok: true; phase: "missing" }
  | { ok: false };

export async function loadRehearsalSdk(nowMs = Date.now()): Promise<RehearsalSdk> {
  try {
    const sql = getSql();
    const parents = await sql<{ decimals: number; eligible: boolean; feeMode: string }[]>`
      select decimals, eligible, fee_mode as "feeMode"
      from parent_registrations
      where scope = 'test' and symbol = 'TREST' and mint_address = ${TREST_MINT}
    `;
    const parent = parents[0];
    if (parents.length !== 1 || !parent?.eligible || parent.feeMode !== "single_recipient" || parent.decimals !== 6) {
      return { ok: true, phase: "missing" };
    }
    const collections = await sql<{ netLamports: string; deferred: boolean }[]>`
      select net_lamports::text as "netLamports", allocation_deferred as deferred
      from reward_collections
      where parent_mint_address = ${TREST_MINT} and scope = 'test' and status = 'confirmed'
    `;
    const windows = await sql<{
      id: string;
      start: Date | string;
      collectedLamports: string;
      holderLamports: string;
      protocolLamports: string;
    }[]>`
      select
        id::text,
        window_start as start,
        collected_lamports::text as "collectedLamports",
        holder_lamports::text as "holderLamports",
        deployer_retained_lamports::text as "protocolLamports"
      from reward_windows
      where parent_mint_address = ${TREST_MINT} and scope = 'test' and status = 'allocated'
    `;
    const snapshots = await sql<{ start: Date | string; lamports: string; holders: number }[]>`
      select window_start as start, coalesce(sum(sol_lamports), 0)::text as lamports, count(*)::int as holders
      from reward_snapshots
      where parent_mint_address = ${TREST_MINT} and scope = 'test'
      group by window_start
    `;
    const rehearsal = await sql<{ startMs: string; outcome: "claimed" | "ok" | "stopped" | "skipped" }[]>`
      select w.window_start_ms::text as "startMs", w.outcome
      from reward_rehearsal_windows w
      join reward_rehearsals rehearsal on rehearsal.id = w.rehearsal_id
      where rehearsal.parent_mint_address = ${TREST_MINT}
        and rehearsal.scope = 'test'
        and rehearsal.generation = (
          select generation
          from reward_rehearsals
          where parent_mint_address = ${TREST_MINT} and scope = 'test'
          order by case when status = 'open' then 0 else 1 end, generation desc
          limit 1
        )
    `;
    const claims = await sql<{ amount: string }[]>`
      select coalesce(sum(liability.amount::bigint), 0)::text as amount
      from reward_claims claim
      join reward_liabilities liability on liability.id = claim.liability_id
      where claim.parent_mint_address = ${TREST_MINT}
        and claim.scope = 'test'
        and claim.status = 'confirmed'
        and liability.kind = 'holder_sol'
    `;
    const controls = await sql<{ reserve: string }[]>`
      select reserve_lamports::text as reserve
      from reward_controls
      where parent_mint_address = ${TREST_MINT} and scope = 'test'
    `;
    const allocatedReserves = await sql<{ signature: string; reserveWithheldLamports: string }[]>`
      select signature, reserve_withheld_lamports::text as "reserveWithheldLamports"
      from reward_collections
      where parent_mint_address = ${TREST_MINT} and scope = 'test' and allocated_at is not null
    `;
    const recoveries = await sql<{
      signature: string;
      netLamports: string;
      reserveLamports: string;
      holderLamports: string;
      buybackLamports: string;
      protocolLamports: string;
    }[]>`
      select
        signature,
        net_lamports::text as "netLamports",
        reserve_withheld_lamports::text as "reserveLamports",
        holder_lamports::text as "holderLamports",
        buyback_lamports::text as "buybackLamports",
        deployer_lamports::text as "protocolLamports"
      from reward_collection_recoveries
      where parent_mint_address = ${TREST_MINT} and scope = 'test'
    `;
    const recognized = recognizedReserveWithheld({
      reserveLamports: controls[0]?.reserve ?? "0",
      allocated: allocatedReserves,
      recoveries: recoveries.map((row) => ({ signature: row.signature, reserveWithheldLamports: row.reserveLamports })),
    });
    const snapshotAt = new Map(snapshots.flatMap((row) => {
      const startMs = stamp(row.start);
      return startMs === null ? [] : [[startMs, row] as const];
    }));
    const figures = composeRehearsalLedger({
      collections,
      windows: windows.flatMap((row) => {
        const startMs = stamp(row.start);
        if (startMs === null) return [];
        const snapshot = snapshotAt.get(startMs);
        return [{
          id: row.id,
          startMs,
          collectedLamports: row.collectedLamports,
          holderLamports: row.holderLamports,
          protocolLamports: row.protocolLamports,
          snapshotLamports: snapshot?.lamports ?? "0",
          eligibleHolders: snapshot?.holders ?? 0,
        }];
      }),
      rehearsal: rehearsal.flatMap((row) => {
        const startMs = Number(row.startMs);
        return Number.isInteger(startMs) ? [{ startMs, outcome: row.outcome }] : [];
      }),
      claimedLamports: claims[0]?.amount ?? "0",
      reserveLamports: controls[0]?.reserve ?? null,
      recognizedReserveLamports: recognized.ok ? recognized.withheld : null,
      nowMs,
    });
    const historical = recoveries.length === 1 && recoveries[0]
      ? {
          netLamports: recoveries[0].netLamports,
          reserveLamports: recoveries[0].reserveLamports,
          holderLamports: recoveries[0].holderLamports,
          buybackLamports: recoveries[0].buybackLamports,
          protocolLamports: recoveries[0].protocolLamports,
        }
      : null;
    return { ok: true, phase: "live", mint: TREST_MINT, decimals: parent.decimals, figures, historical };
  } catch {
    return { ok: false };
  }
}

function stamp(value: Date | string): number | null {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isInteger(time) ? time : null;
}
