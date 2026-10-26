import "server-only";

import { decidePublicLaunchGate, type PublicLaunchGate } from "@/lib/launch/public-gate";
import { databaseFailure, getSql } from "@/lib/server/db";

const CLOSED: PublicLaunchGate = {
  open: false,
  availability: "unavailable",
  mint: null,
  rewardsActive: false,
};

export async function readPublicLaunchGate(): Promise<PublicLaunchGate> {
  try {
    const rows = await getSql()<{
      mint: string | null;
      launchesActive: boolean | null;
      rewardsActive: boolean | null;
    }[]>`
      select mint_address as mint,
             launches_active as "launchesActive",
             rewards_active as "rewardsActive"
      from sdk_parent_config
      where id = 1
    `;
    const row = rows[0];
    return decidePublicLaunchGate({
      present: Boolean(row),
      mint: row?.mint ?? null,
      launchesActive: row ? row.launchesActive : null,
      rewardsActive: row?.rewardsActive ?? null,
      schema: "ready",
    });
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") {
      return decidePublicLaunchGate({
        present: false,
        mint: null,
        launchesActive: null,
        rewardsActive: null,
        schema: "ready",
      });
    }
    return CLOSED;
  }
}
