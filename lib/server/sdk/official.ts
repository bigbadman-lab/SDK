import "server-only";

import {
  acceptOfficialMint,
  allocationCursor,
  SDK_ALLOCATION_PAGE,
  type SdkAllocation,
  type SdkSummary,
} from "@/lib/sdk/official";
import { getSql } from "@/lib/server/db";

export type OfficialSdk =
  | { ok: true; phase: "prelaunch" }
  | { ok: true; phase: "live"; mint: string; decimals: number | null }
  | { ok: false };

export async function loadOfficialSdk(): Promise<OfficialSdk> {
  try {
    const rows = await getSql()<{ mint: string | null; decimals: number | null }[]>`
      select mint_address as mint, decimals
      from sdk_parent_config
      where id = 1
    `;
    const decimals = rows[0]?.decimals;
    const scale = typeof decimals === "number" ? decimals : null;
    const accepted = acceptOfficialMint(rows[0]?.mint ?? null, scale);
    if (!accepted) return { ok: true, phase: "prelaunch" };
    return { ok: true, phase: "live", mint: accepted.mint, decimals: accepted.decimals };
  } catch {
    return { ok: false };
  }
}

export async function loadHolderAllocations(
  mint: string,
  cursor: { start: string; id: string } | null,
): Promise<{ ok: true; summary: SdkSummary; rows: SdkAllocation[]; nextCursor: string | null } | { ok: false }> {
  try {
    const sql = getSql();
    const summaryRows = await sql<{
      totalLamports: string;
      dayLamports: string;
      latestWindowStart: Date | string | null;
      latestWindowEnd: Date | string | null;
    }[]>`
      with completed as (
        select window_start, window_end
        from reward_windows
        where parent_mint_address = ${mint}
          and scope = 'production'
          and status = 'allocated'
      )
      select
        coalesce((
          select sum(snapshot.sol_lamports)::text
          from reward_snapshots snapshot
          join completed
            on completed.window_start = snapshot.window_start
          where snapshot.parent_mint_address = ${mint}
            and snapshot.scope = 'production'
        ), '0') as "totalLamports",
        coalesce((
          select sum(snapshot.sol_lamports)::text
          from reward_snapshots snapshot
          join completed
            on completed.window_start = snapshot.window_start
          where snapshot.parent_mint_address = ${mint}
            and snapshot.scope = 'production'
            and snapshot.window_start >= now() - interval '24 hours'
        ), '0') as "dayLamports",
        (select window_start from completed order by window_start desc limit 1) as "latestWindowStart",
        (select window_end from completed order by window_start desc limit 1) as "latestWindowEnd"
    `;
    const summaryRow = summaryRows[0];
    const page = cursor
      ? await allocationPage(sql, mint, cursor)
      : await allocationPage(sql, mint, null);
    const visible = page.slice(0, SDK_ALLOCATION_PAGE);
    const rows = visible.flatMap((row) => {
      const windowStart = stamp(row.windowStart);
      const windowEnd = stamp(row.windowEnd);
      const cursorValue = windowStart ? allocationCursor(windowStart, row.id) : null;
      if (!windowStart || !windowEnd || !cursorValue) return [];
      return [{
        id: row.id,
        windowStart,
        windowEnd,
        owner: row.owner,
        balance: row.balance,
        solLamports: row.solLamports,
      }];
    });
    const last = rows.at(-1);
    const nextCursor = page.length > SDK_ALLOCATION_PAGE && last ? allocationCursor(last.windowStart, last.id) : null;
    return {
      ok: true,
      summary: {
        totalLamports: summaryRow?.totalLamports ?? "0",
        dayLamports: summaryRow?.dayLamports ?? "0",
        latestWindowStart: stamp(summaryRow?.latestWindowStart ?? null),
        latestWindowEnd: stamp(summaryRow?.latestWindowEnd ?? null),
      },
      rows,
      nextCursor,
    };
  } catch {
    return { ok: false };
  }
}

type AllocationRow = {
  id: string;
  windowStart: Date | string;
  windowEnd: Date | string;
  owner: string;
  balance: string;
  solLamports: string;
};

function allocationPage(
  sql: ReturnType<typeof getSql>,
  mint: string,
  cursor: { start: string; id: string } | null,
): Promise<AllocationRow[]> {
  if (!cursor) {
    return sql<AllocationRow[]>`
      select
        snapshot.id::text as id,
        window.window_start as "windowStart",
        window.window_end as "windowEnd",
        snapshot.owner_address as owner,
        snapshot.balance,
        snapshot.sol_lamports::text as "solLamports"
      from reward_snapshots snapshot
      join reward_windows window
        on window.parent_mint_address = snapshot.parent_mint_address
       and window.scope = snapshot.scope
       and window.window_start = snapshot.window_start
      where snapshot.parent_mint_address = ${mint}
        and snapshot.scope = 'production'
        and window.status = 'allocated'
      order by window.window_start desc, snapshot.id desc
      limit ${SDK_ALLOCATION_PAGE + 1}
    `;
  }
  return sql<AllocationRow[]>`
    select
      snapshot.id::text as id,
      window.window_start as "windowStart",
      window.window_end as "windowEnd",
      snapshot.owner_address as owner,
      snapshot.balance,
      snapshot.sol_lamports::text as "solLamports"
    from reward_snapshots snapshot
    join reward_windows window
      on window.parent_mint_address = snapshot.parent_mint_address
     and window.scope = snapshot.scope
     and window.window_start = snapshot.window_start
    where snapshot.parent_mint_address = ${mint}
      and snapshot.scope = 'production'
      and window.status = 'allocated'
      and (window.window_start, snapshot.id) < (${cursor.start}::timestamptz, ${cursor.id}::uuid)
    order by window.window_start desc, snapshot.id desc
    limit ${SDK_ALLOCATION_PAGE + 1}
  `;
}

function stamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
