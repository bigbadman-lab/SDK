import "server-only";

import { createHash } from "node:crypto";

import type { TestParentRegistration } from "@/lib/launch/parent";
import { databaseFailure, getSql } from "@/lib/server/db";

function evidence(registration: TestParentRegistration): string {
  return createHash("sha256").update(JSON.stringify(registration)).digest("hex");
}

export async function storeTestParent(input: {
  registration: TestParentRegistration;
  operator: string;
}): Promise<{ ok: true; registration: "stored" } | { ok: false; code: "conflict" | "missing_schema" | "unavailable" }> {
  const registration = input.registration;
  if (registration.scope !== "test" || registration.symbol !== "TREST") {
    return { ok: false, code: "conflict" };
  }
  try {
    await getSql()`
      insert into parent_registrations (
        scope,
        symbol,
        mint_address,
        deployer_address,
        fee_recipient_address,
        fee_mode,
        token_program,
        decimals,
        bonding_curve_address,
        graduated,
        pool_address,
        quote_mint_address,
        eligible,
        eligibility_reason,
        verified_at,
        registered_by,
        evidence_hash
      ) values (
        'test',
        'TREST',
        ${registration.mint},
        ${registration.deployer},
        ${registration.feeRecipient},
        ${registration.feeMode},
        ${registration.tokenProgram},
        ${registration.decimals},
        ${registration.bondingCurve},
        ${registration.graduated},
        ${registration.pool},
        ${registration.quoteMint},
        ${registration.eligible},
        ${registration.eligibilityReason},
        now(),
        ${input.operator},
        ${evidence(registration)}
      )
    `;
    return { ok: true, registration: "stored" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "23505") {
      try {
        const rows = await getSql()<{
          mint_address: string;
          deployer_address: string;
          scope: string;
          symbol: string;
          fee_mode: string;
        }[]>`
          select mint_address, deployer_address, scope, symbol, fee_mode
          from parent_registrations
          where mint_address = ${registration.mint}
             or symbol = 'TREST'
        `;
        const row = rows.find((item) => item.mint_address === registration.mint) ?? rows[0];
        if (
          row &&
          row.mint_address === registration.mint &&
          row.deployer_address === registration.deployer &&
          row.scope === "test" &&
          row.symbol === "TREST" &&
          row.fee_mode === "single_recipient"
        ) {
          return { ok: true, registration: "stored" };
        }
      } catch (lookup) {
        return { ok: false, code: databaseFailure(lookup) === "missing_schema" ? "missing_schema" : "unavailable" };
      }
      return { ok: false, code: "conflict" };
    }
    return { ok: false, code: databaseFailure(error) === "missing_schema" ? "missing_schema" : "unavailable" };
  }
}
