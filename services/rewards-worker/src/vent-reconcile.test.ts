import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PUMP_PROGRAM_ID } from "../../../lib/rewards/child-fees.ts";
import { cliMain } from "./vent-reconcile-cli.ts";
import {
  VENT_DISTRIBUTED,
  VENT_LAUNCHER_AMOUNT,
  VENT_PLATFORM_AMOUNT,
  VENT_RECONCILE_APPROVAL,
  VENT_SIGNATURE,
  assessReconciliation,
  soleCreatorFeeDistribution,
  type ReconciliationEvidence,
} from "./vent-reconcile.ts";
import {
  LAUNCHER,
  ONE_SHOT_KEY,
  PLATFORM,
  TREST_MINT,
  VENT_MINT,
} from "./vent-fee.ts";

function evidence(
  patch: Partial<ReconciliationEvidence> = {}
): ReconciliationEvidence {
  return {
    finalized: true,
    succeeded: true,
    slot: "461649938",
    childInTransaction: true,
    parentInTransaction: true,
    instructionOk: true,
    sharingOk: true,
    deltas: [
      {
        owner: "9NXoqw9svrX4kD3bRkxQuyV5bkxeQugLgkJr2z5EnXjw",
        mint: TREST_MINT,
        amount: VENT_DISTRIBUTED,
        sign: "debit",
      },
      {
        owner: LAUNCHER,
        mint: TREST_MINT,
        amount: VENT_LAUNCHER_AMOUNT,
        sign: "credit",
      },
      {
        owner: PLATFORM,
        mint: TREST_MINT,
        amount: VENT_PLATFORM_AMOUNT,
        sign: "credit",
      },
    ],
    row: {
      idempotencyKey: ONE_SHOT_KEY,
      status: "unreconciled",
      signature: VENT_SIGNATURE,
      amount: null,
      childMint: VENT_MINT,
      quoteMint: TREST_MINT,
      scope: "test",
    },
    receipts: [],
    ...patch,
  };
}

test("a dry-run reports the finalized VENT credits and does not write", async () => {
  let writes = 0;
  const result = await cliMain(
    ["node", "vent-reconcile-cli.ts"],
    {},
    {
      load: async () => evidence(),
      apply: async () => {
        writes += 1;
        return "applied";
      },
    }
  );
  assert.equal(result.code, 0);
  assert.match(result.out, /status: ready/);
  assert.match(result.out, /writes: none/);
  assert.match(result.out, new RegExp(VENT_DISTRIBUTED));
  assert.equal(writes, 0);
});

test("execution is refused without approval and does not write a second distribution", async () => {
  let writes = 0;
  const refused = await cliMain(
    [
      "node",
      "vent-reconcile-cli.ts",
      "--execute",
      "--approval",
      VENT_RECONCILE_APPROVAL,
      "--operator",
      "operator-1",
      "--reason",
      "record the finalized VENT credits",
    ],
    {},
    {
      load: async () => evidence(),
      apply: async () => {
        writes += 1;
        return "applied";
      },
    }
  );
  assert.equal(refused.code, 2);
  assert.match(refused.out, /authorisation/);
  assert.equal(writes, 0);
  const decision = assessReconciliation(
    evidence({
      receipts: [
        {
          address: LAUNCHER,
          amount: VENT_LAUNCHER_AMOUNT,
          role: "launcher",
          signature: VENT_SIGNATURE,
        },
      ],
    })
  );
  assert.equal(decision.ready, false);
  if (!decision.ready) assert.ok(decision.blocks.includes("receipts"));
});

test("only Pump's distribute-creator-fees instruction is accepted", () => {
  assert.equal(
    soleCreatorFeeDistribution({
      accountKeys: [PUMP_PROGRAM_ID],
      instructions: [
        { programIdIndex: 0, data: [255, 203, 19, 79, 244, 68, 8, 159, 1] },
      ],
    }),
    true
  );
  assert.equal(
    soleCreatorFeeDistribution({
      accountKeys: [PUMP_PROGRAM_ID],
      instructions: [
        { programIdIndex: 0, data: [207, 17, 138, 242, 4, 34, 19, 56] },
      ],
    }),
    false
  );
  const blocked = assessReconciliation(evidence({ instructionOk: false }));
  assert.equal(blocked.ready, false);
  if (!blocked.ready) assert.ok(blocked.blocks.includes("instruction"));
});

test("the reconciler does not sign or open the rehearsal", async () => {
  const cli = await readFile(
    new URL("./vent-reconcile-cli.ts", import.meta.url),
    "utf8"
  );
  const logic = await readFile(
    new URL("./vent-reconcile.ts", import.meta.url),
    "utf8"
  );
  assert.equal(cli.includes("signInspected"), false);
  assert.equal(cli.includes("chain.submit"), false);
  assert.equal(logic.includes("insert into child_fee_distributions"), false);
  assert.equal(cli.includes("update reward_rehearsals"), false);
  assert.equal(cli.includes("signer_suspended"), false);
});
