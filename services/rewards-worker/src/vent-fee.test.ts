import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import {
  DISTRIBUTE_CREATOR_FEES_V2,
  PUMP_PROGRAM_ID,
} from "../../../lib/rewards/child-fees.ts";
import { accountingWindow } from "../../../lib/rewards/ledger.ts";
import { rewardsView } from "../../../lib/rewards/account-view.ts";
import { cliMain } from "./vent-fee-cli.ts";
import {
  LAUNCH_ID,
  LAUNCHER,
  ONE_SHOT_KEY,
  PAYER,
  PLATFORM,
  TREST_MINT,
  VENT_FEE_APPROVAL,
  VENT_MINT,
  allowedDistributionInstructions,
  assessVentFee,
  executeOneShot,
  formatReport,
  parseVentFeeArgs,
  type DistributionLedger,
  type DistributionRow,
  type VentSnapshot,
} from "./vent-fee.ts";

const DNA = "7FsscnVKPLJxHpncZvG3nT9vzoeKKYULKTwrxvtF36gP";
const SECRET = "do-not-print-this-private-key";

function readySnapshot(patch: Partial<VentSnapshot> = {}): VentSnapshot {
  return {
    launch: {
      id: LAUNCH_ID,
      mint: VENT_MINT,
      parentMint: TREST_MINT,
      scope: "test",
      category: "official",
      launcher: LAUNCHER,
      originator: "2ZrpSo3SmuKnFG69XMEYv2Ew54oKGB2DXPVBAJHBGYx2",
      attemptStatus: "verified",
    },
    parent: { symbol: "TREST", decimals: 6, deployer: PAYER, scope: "test" },
    sharing: {
      address: "6Dh3NuoHk2gbF8baEPhJsfoj4YAUszed7r4tM3F7MhE2",
      admin: LAUNCHER,
      adminRevoked: true,
      shareholders: [
        { address: PLATFORM, shareBps: 4000 },
        { address: LAUNCHER, shareBps: 6000 },
      ],
    },
    vault: {
      creator: "6Dh3NuoHk2gbF8baEPhJsfoj4YAUszed7r4tM3F7MhE2",
      quoteMint: TREST_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      graduated: false,
      pumpVault: "10000",
      ammVault: "0",
    },
    payerLamports: "1000000000",
    feeLamports: "5000",
    rentLamports: "2039280",
    missingAtas: ["platform-ata"],
    instructions: [
      {
        programId: PUMP_PROGRAM_ID,
        data: [...DISTRIBUTE_CREATOR_FEES_V2, 1],
        signers: [PAYER],
      },
    ],
    inspectOk: true,
    rehearsalStatus: "closed",
    signerSuspended: true,
    distributions: [],
    ...patch,
  };
}

function executeArgs(child = VENT_MINT, parent = TREST_MINT): string[] {
  return [
    "node",
    "vent-fee-cli.ts",
    "--execute",
    "--approval",
    VENT_FEE_APPROVAL,
    "--child",
    child,
    "--parent",
    parent,
    "--max-vault",
    "10000",
    "--min-vault",
    "10000",
    "--operator",
    "operator-1",
    "--reason",
    "TREST-05B one-shot VENT distribution",
  ];
}

function memoryLedger(initial: DistributionRow[] = []): {
  rows: DistributionRow[];
  ledger: DistributionLedger;
  receipts: number;
} {
  const rows = initial.map((row) => ({ ...row }));
  let receipts = 0;
  return {
    rows,
    get receipts() {
      return receipts;
    },
    ledger: {
      async list() {
        return rows.map((row) => ({ ...row }));
      },
      async reserve(input) {
        if (rows.some((row) => row.idempotencyKey === input.key))
          return "conflict";
        rows.push({
          idempotencyKey: input.key,
          status: "submitted",
          signature: input.signature,
        });
        return "reserved";
      },
      async mark(key, status) {
        const row = rows.find((item) => item.idempotencyKey === key);
        if (row) row.status = status;
      },
      async receipts() {
        receipts += 1;
      },
      async confirm(key) {
        const row = rows.find(
          (item) => item.idempotencyKey === key && item.status === "submitted"
        );
        if (!row) return false;
        row.status = "confirmed";
        return true;
      },
    },
  };
}

test("the dry-run is the default and does not execute", async () => {
  let executed = 0;
  const result = await cliMain(
    ["node", "vent-fee-cli.ts"],
    { TREST_DEPLOYER_PRIVATE_KEY: SECRET },
    {
      load: async () => readySnapshot(),
      execute: async () => {
        executed += 1;
        return { ok: false, code: "executed", signature: null };
      },
    }
  );
  assert.equal(result.code, 0);
  assert.match(result.out, /status: ready/);
  assert.match(result.out, /execution: disabled/);
  assert.match(result.out, new RegExp(`allocation: ${LAUNCHER} 6000`));
  assert.match(result.out, new RegExp(`allocation: ${PLATFORM} 4000`));
  assert.equal(result.out.includes(SECRET), false);
  assert.equal(executed, 0);
});

test("execution requires the operator gate, the exact mints, and a vault interval", async () => {
  assert.equal(parseVentFeeArgs(["node", "vent-fee-cli.ts"]).ok, true);
  const otherChild = parseVentFeeArgs(executeArgs(DNA));
  assert.equal(otherChild.ok, false);
  if (!otherChild.ok) assert.equal(otherChild.code, "target");
  const unauthorised = await cliMain(
    executeArgs(),
    { TREST_DEPLOYER_ADDRESS: PAYER, TREST_DEPLOYER_PRIVATE_KEY: SECRET },
    {
      execute: async () => {
        throw new Error("executed");
      },
    }
  );
  assert.equal(unauthorised.code, 2);
  assert.match(unauthorised.out, /authorisation/);
  const above = assessVentFee(readySnapshot(), { min: "10000", max: "9999" });
  assert.equal(above.ready, false);
  assert.ok(above.blocks.includes("vault_cap"));
});

test("a one-shot key is not a five-minute window key", () => {
  const window = accountingWindow(Date.UTC(2026, 9, 26, 11, 19));
  assert.ok(window);
  assert.equal(ONE_SHOT_KEY, `trest-05b:${VENT_MINT}`);
  assert.equal(ONE_SHOT_KEY.includes(String(window.startMs)), false);
  assert.equal(
    `child:test:${VENT_MINT}:${window.startMs}` === ONE_SHOT_KEY,
    false
  );
});

test("only the distribute instruction and token-account setup are accepted", () => {
  const distribute = {
    programId: PUMP_PROGRAM_ID,
    data: [...DISTRIBUTE_CREATOR_FEES_V2, 1],
    signers: [PAYER],
  };
  assert.equal(allowedDistributionInstructions([distribute]), true);
  assert.equal(
    allowedDistributionInstructions([{ ...distribute, signers: [LAUNCHER] }]),
    false
  );
  assert.equal(
    allowedDistributionInstructions([
      distribute,
      {
        programId: PUMP_PROGRAM_ID,
        data: [1, 2, 3, 4, 5, 6, 7, 8],
        signers: [],
      },
    ]),
    false
  );
  assert.equal(
    allowedDistributionInstructions([
      {
        programId: PUMP_PROGRAM_ID,
        data: [207, 17, 138, 242, 4, 34, 19, 56],
        signers: [PAYER],
      },
    ]),
    false
  );
});

test("an existing confirmed, unresolved, or failed distribution blocks another broadcast", async () => {
  for (const status of [
    "confirmed",
    "uncertain",
    "submitted",
    "unreconciled",
    "failed",
  ]) {
    let signed = 0;
    const store = memoryLedger([
      { idempotencyKey: "earlier", status, signature: "sig" },
    ]);
    const result = await executeOneShot({
      snapshot: readySnapshot(),
      approval: { min: "10000", max: "10000" },
      ledger: store.ledger,
      sign: async () => {
        signed += 1;
        return { ok: true, signature: "signed" };
      },
      submit: async () => {
        throw new Error("submitted");
      },
      confirm: async () => {
        throw new Error("confirmed");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(signed, 0);
  }
});

test("a reservation conflict or an uncertain submit does not broadcast again", async () => {
  let submitted = 0;
  const conflict = await executeOneShot({
    snapshot: readySnapshot(),
    approval: { min: "10000", max: "10000" },
    ledger: {
      ...memoryLedger().ledger,
      async reserve() {
        return "conflict";
      },
    },
    sign: async () => ({ ok: true, signature: "signed" }),
    submit: async () => {
      submitted += 1;
      return { status: "accepted" };
    },
    confirm: async () => {
      throw new Error("confirmed");
    },
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "overlap");
  assert.equal(submitted, 0);

  const store = memoryLedger();
  let confirms = 0;
  const uncertain = await executeOneShot({
    snapshot: readySnapshot(),
    approval: { min: "10000", max: "10000" },
    ledger: store.ledger,
    sign: async () => ({ ok: true, signature: "signed" }),
    submit: async () => ({ status: "uncertain" }),
    confirm: async () => {
      confirms += 1;
      return { status: "unconfirmed" };
    },
  });
  assert.equal(uncertain.ok, false);
  if (!uncertain.ok) assert.equal(uncertain.code, "uncertain");
  assert.equal(confirms, 0);
  assert.equal(store.rows[0]?.status, "uncertain");
  const retry = await executeOneShot({
    snapshot: readySnapshot({ distributions: store.rows }),
    approval: { min: "10000", max: "10000" },
    ledger: store.ledger,
    sign: async () => {
      throw new Error("signed again");
    },
    submit: async () => {
      throw new Error("submitted again");
    },
    confirm: async () => {
      throw new Error("confirmed again");
    },
  });
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.code, "unresolved");
});

test("receipts are written only after the confirmed shareholder credits match", async () => {
  const store = memoryLedger();
  const missing = await executeOneShot({
    snapshot: readySnapshot(),
    approval: { min: "10000", max: "10000" },
    ledger: store.ledger,
    sign: async () => ({ ok: true, signature: "signed" }),
    submit: async () => ({ status: "accepted" }),
    confirm: async () => ({ status: "unconfirmed" }),
  });
  assert.equal(missing.ok, false);
  assert.equal(store.receipts, 0);
  assert.equal(store.rows[0]?.status, "unreconciled");

  const paid = memoryLedger();
  const result = await executeOneShot({
    snapshot: readySnapshot(),
    approval: { min: "10000", max: "10000" },
    ledger: paid.ledger,
    sign: async () => ({ ok: true, signature: "signed" }),
    submit: async () => ({ status: "accepted" }),
    confirm: async () => ({
      status: "confirmed",
      slot: "1",
      deltas: [
        { owner: "vault", mint: TREST_MINT, amount: "10000", sign: "debit" },
        { owner: LAUNCHER, mint: TREST_MINT, amount: "6000", sign: "credit" },
        { owner: PLATFORM, mint: TREST_MINT, amount: "4000", sign: "credit" },
      ],
    }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.amount, "10000");
    assert.deepEqual(
      result.receipts.map((receipt) => receipt.role),
      ["launcher", "platform"]
    );
  }
  assert.equal(paid.receipts, 1);
  assert.equal(paid.rows[0]?.status, "confirmed");
  assert.equal(paid.rows[0]?.idempotencyKey, ONE_SHOT_KEY);
});

test("the test account view keeps the launcher receipt for the signed-in wallet", () => {
  const earnings = [
    {
      role: "launcher" as const,
      scope: "test" as const,
      mint: TREST_MINT,
      amount: "6000",
      signature: "signature",
    },
  ];
  const view = rewardsView({
    scope: "test",
    symbol: "TREST",
    ledger: "ready",
    worker: "suspended",
    snapshots: [],
    claims: [],
    windows: [],
    wallet: LAUNCHER,
    threshold: null,
    currentBalance: null,
    earnings,
  });
  assert.equal(view.earnings[0]?.amount, "6000");
  assert.equal(view.earnings[0]?.signature, "signature");
  const production = rewardsView({
    scope: "production",
    symbol: "TREST",
    ledger: "ready",
    snapshots: [],
    claims: [],
    windows: [],
    wallet: LAUNCHER,
    threshold: null,
    currentBalance: null,
    earnings,
  });
  assert.equal(production.earnings.length, 0);
});

test("the one-shot command does not change the worker or the rehearsal fence", async () => {
  const cli = await readFile(
    new URL("./vent-fee-cli.ts", import.meta.url),
    "utf8"
  );
  const logic = await readFile(
    new URL("./vent-fee.ts", import.meta.url),
    "utf8"
  );
  const server = await readFile(
    new URL("./server.ts", import.meta.url),
    "utf8"
  );
  const loop = await readFile(new URL("./loop.ts", import.meta.url), "utf8");
  const display = await readFile(
    new URL("../../../components/account/holder-rewards.tsx", import.meta.url),
    "utf8"
  );
  assert.equal(cli.includes(DNA), false);
  assert.equal(logic.includes(DNA), false);
  assert.equal(cli.includes("blocksSideWork"), false);
  assert.equal(logic.includes("startRewardsLoop"), false);
  assert.equal(cli.includes("update reward_rehearsals"), false);
  assert.equal(cli.includes("signer_suspended ="), false);
  assert.equal(server.includes("vent-fee"), false);
  assert.equal(loop.includes("vent-fee"), false);
  assert.equal(display.includes("Received ${row.amount} of ${row.mint}"), false);
  assert.match(display, /presentCreatorReceipt/);
  const report = formatReport(readySnapshot(), { ready: true, blocks: [] });
  assert.equal(report.includes(SECRET), false);
});
