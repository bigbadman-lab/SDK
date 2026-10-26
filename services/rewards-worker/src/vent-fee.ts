import {
  PLATFORM_FEE_WALLET,
  type Shareholder,
} from "../../../lib/launch/fees.ts";
import { canonicalAddress } from "../../../lib/auth/solana.ts";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../../../lib/rewards/claim.ts";
import {
  matchShareholderReceipts,
  nativeCollectionInstruction,
  pumpCreatorFeeDistribution,
  splitChildFee,
  verifyChildSharing,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
} from "../../../lib/rewards/child-fees.ts";

export const VENT_MINT = "7Rrmq49nP4pFckExFxybJuqFwQbiKeGedbD22w5twvQB";
export const TREST_MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
export const LAUNCH_ID = "9104b3e4-46c9-4f0d-8b91-cb69a1f34a87";
export const LAUNCHER = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
export const PLATFORM = "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC";
export const PAYER = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
export const SHARING_CONFIG = "6Dh3NuoHk2gbF8baEPhJsfoj4YAUszed7r4tM3F7MhE2";
export const VENT_FEE_APPROVAL = "TREST-05B-VENT-CHILD-FEE";
export const ONE_SHOT_KEY = `trest-05b:${VENT_MINT}`;

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;
const UNRESOLVED = new Set([
  "recorded",
  "submitted",
  "uncertain",
  "unreconciled",
]);

export type DistributionRow = {
  idempotencyKey: string;
  status: string;
  signature: string | null;
};

export type DistributionInstruction = {
  programId: string;
  data: readonly number[];
  signers: readonly string[];
};

export type VentSnapshot = {
  launch: {
    id: string;
    mint: string;
    parentMint: string;
    scope: string;
    category: string;
    launcher: string;
    originator: string | null;
    attemptStatus: string;
  } | null;
  parent: {
    symbol: string;
    decimals: number;
    deployer: string;
    scope: string;
  } | null;
  sharing: {
    address: string;
    admin: string;
    adminRevoked: boolean;
    shareholders: Shareholder[];
  } | null;
  vault: {
    creator: string;
    quoteMint: string;
    tokenProgram: string;
    graduated: boolean;
    pumpVault: string;
    ammVault: string;
  } | null;
  payerLamports: string | null;
  feeLamports: string | null;
  rentLamports: string | null;
  missingAtas: readonly string[];
  instructions: readonly DistributionInstruction[] | null;
  inspectOk: boolean;
  rehearsalStatus: string | null;
  signerSuspended: boolean | null;
  distributions: readonly DistributionRow[];
};

export type VaultApproval = { min: string; max: string };

export type ExecuteRequest = {
  approval: string;
  child: string;
  parent: string;
  min: string;
  max: string;
  operator: string;
  reason: string;
};

export type ExecuteResult =
  | {
      ok: true;
      signature: string;
      amount: string;
      receipts: readonly { address: string; amount: string; role: string }[];
    }
  | { ok: false; code: string; signature: string | null };

export type DistributionLedger = {
  list(childMint: string): Promise<readonly DistributionRow[]>;
  reserve(input: {
    key: string;
    childMint: string;
    quoteMint: string;
    signature: string;
  }): Promise<"reserved" | "conflict">;
  mark(
    key: string,
    status: "failed" | "uncertain" | "unreconciled"
  ): Promise<void>;
  receipts(input: {
    key: string;
    quoteMint: string;
    signature: string;
    slot: string | null;
    rows: readonly {
      address: string;
      amount: string;
      role: "launcher" | "developer" | "platform";
    }[];
  }): Promise<void>;
  confirm(key: string, amount: string): Promise<boolean>;
};

type Parsed =
  | { ok: true; mode: "dry-run" }
  | { ok: true; mode: "execute"; request: ExecuteRequest }
  | { ok: false; code: string };

function amount(value: string | null | undefined): bigint | null {
  if (!value || !AMOUNT.test(value)) return null;
  return BigInt(value);
}

function sameAddress(left: string, right: string): boolean {
  const canonical = canonicalAddress(left);
  return canonical !== null && canonical === right;
}

export function priorDistributionBlock(
  rows: readonly DistributionRow[]
): "confirmed" | "unresolved" | "failed" | null {
  if (rows.some((row) => row.status === "confirmed")) return "confirmed";
  if (rows.some((row) => UNRESOLVED.has(row.status))) return "unresolved";
  if (rows.some((row) => row.status === "failed")) return "failed";
  return null;
}

export function allowedDistributionInstructions(
  instructions: readonly DistributionInstruction[]
): boolean {
  if (instructions.length === 0) return false;
  let distributions = 0;
  let payerSigns = false;
  for (const instruction of instructions) {
    if (instruction.signers.some((signer) => !sameAddress(signer, PAYER)))
      return false;
    if (instruction.signers.some((signer) => sameAddress(signer, PAYER)))
      payerSigns = true;
    if (nativeCollectionInstruction(instruction.data)) return false;
    if (pumpCreatorFeeDistribution(instruction.programId, instruction.data)) {
      distributions += 1;
      continue;
    }
    if (
      instruction.programId === PUMP_PROGRAM_ID ||
      instruction.programId === PUMP_AMM_PROGRAM_ID
    )
      return false;
    if (instruction.programId === COMPUTE_BUDGET_PROGRAM_ID) {
      const operation = instruction.data[0];
      if (operation !== 2 && operation !== 3) return false;
      continue;
    }
    if (instruction.programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
      const operation = instruction.data[0];
      if (operation !== 0 && operation !== 1) return false;
      continue;
    }
    if (instruction.programId === SYSTEM_PROGRAM_ID) {
      const operation = instruction.data[0];
      if (operation !== 0 && operation !== 2) return false;
      continue;
    }
    if (
      instruction.programId === TOKEN_PROGRAM_ID ||
      instruction.programId === TOKEN_2022_PROGRAM_ID
    ) {
      const operation = instruction.data[0];
      if (
        operation !== 0 &&
        operation !== 1 &&
        operation !== 16 &&
        operation !== 18
      )
        return false;
      continue;
    }
    return false;
  }
  return distributions === 1 && payerSigns;
}

export function assessVentFee(
  snapshot: VentSnapshot,
  approval: VaultApproval | null
): { ready: boolean; blocks: string[] } {
  const blocks: string[] = [];
  const launch = snapshot.launch;
  if (
    !launch ||
    launch.id !== LAUNCH_ID ||
    !sameAddress(launch.mint, VENT_MINT) ||
    !sameAddress(launch.parentMint, TREST_MINT) ||
    launch.scope !== "test" ||
    launch.category !== "official" ||
    !sameAddress(launch.launcher, LAUNCHER) ||
    launch.attemptStatus !== "verified"
  ) {
    blocks.push("launch");
  }
  const parent = snapshot.parent;
  if (
    !parent ||
    parent.symbol !== "TREST" ||
    parent.decimals !== 6 ||
    parent.scope !== "test" ||
    !sameAddress(parent.deployer, PAYER)
  ) {
    blocks.push("parent");
  }
  const sharing = snapshot.sharing;
  const vault = snapshot.vault;
  if (!sharing || !sameAddress(sharing.address, SHARING_CONFIG)) {
    blocks.push("sharing");
  } else if (!sharing.adminRevoked) {
    blocks.push("revocation");
  } else {
    const verified = verifyChildSharing({
      category: "official",
      launcherWallet: LAUNCHER,
      originatorWallet: launch?.originator ?? null,
      observed: sharing.shareholders,
      adminRevoked: true,
    });
    if (!verified.ok || PLATFORM !== PLATFORM_FEE_WALLET)
      blocks.push("shareholders");
  }
  const pumpVault = amount(vault?.pumpVault);
  if (!vault || pumpVault === null) blocks.push("vault");
  else if (
    !sameAddress(vault.creator, SHARING_CONFIG) &&
    !blocks.includes("sharing")
  )
    blocks.push("sharing");
  if (!vault || !sameAddress(vault.quoteMint, TREST_MINT)) blocks.push("quote");
  if (!vault || vault.tokenProgram !== TOKEN_2022_PROGRAM_ID)
    blocks.push("token_program");
  if (pumpVault === BigInt(0)) blocks.push("vault_empty");
  if (vault && amount(vault.ammVault) !== BigInt(0)) blocks.push("amm_vault");
  if (vault && pumpVault !== null && pumpVault > BigInt(0) && sharing) {
    const split = splitChildFee(vault.pumpVault, expectedShareholders());
    const launcher = split.ok
      ? split.shares.find((share) => share.address === LAUNCHER)
      : undefined;
    const platform = split.ok
      ? split.shares.find((share) => share.address === PLATFORM)
      : undefined;
    if (
      !split.ok ||
      !launcher ||
      launcher.amount === "0" ||
      !platform ||
      platform.amount === "0"
    )
      blocks.push("allocation");
  }
  if (
    !snapshot.instructions ||
    !allowedDistributionInstructions(snapshot.instructions)
  )
    blocks.push("instructions");
  if (!snapshot.inspectOk) blocks.push("inspect");
  const lamports = amount(snapshot.payerLamports);
  const fee = amount(snapshot.feeLamports);
  const rent = amount(snapshot.rentLamports);
  if (lamports === null) blocks.push("payer");
  if (fee === null || rent === null) blocks.push("fee");
  if (
    lamports !== null &&
    fee !== null &&
    rent !== null &&
    lamports < fee + rent
  )
    blocks.push("payer_balance");
  if (snapshot.rehearsalStatus !== "closed") blocks.push("rehearsal");
  if (snapshot.signerSuspended !== true) blocks.push("suspension");
  const prior = priorDistributionBlock(snapshot.distributions);
  if (prior) blocks.push(prior);
  if (approval) {
    const min = amount(approval.min);
    const max = amount(approval.max);
    if (pumpVault === null || min === null || max === null || min > max)
      blocks.push("vault_cap");
    else if (pumpVault > max) blocks.push("vault_cap");
    else if (pumpVault < min) blocks.push("vault_floor");
  }
  return { ready: blocks.length === 0, blocks };
}

export function expectedShareholders(): Shareholder[] {
  return [
    { address: LAUNCHER, shareBps: 6000 },
    { address: PLATFORM, shareBps: 4000 },
  ];
}

export function formatTokens(base: string, decimals: number): string {
  const value = amount(base);
  if (value === null) return base;
  const text = value.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function formatReport(
  snapshot: VentSnapshot,
  decision: { ready: boolean; blocks: readonly string[] }
): string {
  const vault = snapshot.vault;
  const split =
    vault && amount(vault.pumpVault) !== null
      ? splitChildFee(vault.pumpVault, expectedShareholders())
      : null;
  const lines = [
    "TREST-05B dry-run",
    "execution: disabled",
    `status: ${decision.ready ? "ready" : "blocked"}`,
    decision.blocks.length > 0
      ? `blocked: ${decision.blocks.join(",")}`
      : "blocked: none",
    `child: VENT ${VENT_MINT}`,
    `parent: TREST ${TREST_MINT} scope test`,
    `launch: ${snapshot.launch?.id ?? "missing"} ${snapshot.launch?.attemptStatus ?? "missing"}`,
    `launcher: ${LAUNCHER} 6000`,
    `platform: ${PLATFORM} 4000`,
    `originator: ${snapshot.launch?.originator ?? "none"}`,
    `sharing: ${snapshot.sharing?.address ?? "missing"} admin ${snapshot.sharing?.admin ?? "missing"} revoked ${snapshot.sharing?.adminRevoked === true}`,
    `quote: ${vault?.quoteMint ?? "missing"} program ${vault?.tokenProgram ?? "missing"} graduated ${vault?.graduated === true}`,
    `vault: ${vault?.pumpVault ?? "missing"} base units (${vault ? formatTokens(vault.pumpVault, 6) : "missing"} TREST)`,
    `amm vault: ${vault?.ammVault ?? "missing"}`,
    `payer: ${PAYER}`,
    `payer lamports: ${snapshot.payerLamports ?? "missing"}`,
    `signature fee lamports: ${snapshot.feeLamports ?? "missing"}`,
    `account rent lamports: ${snapshot.rentLamports ?? "missing"}`,
    `missing token accounts: ${snapshot.missingAtas.length === 0 ? "none" : snapshot.missingAtas.join(",")}`,
    `instructions: ${snapshot.instructions?.length ?? 0}`,
    `inspect: ${snapshot.inspectOk ? "pass" : "fail"}`,
    `rehearsal: ${snapshot.rehearsalStatus ?? "missing"}`,
    `signer suspended: ${snapshot.signerSuspended === true}`,
    `one-shot key: ${ONE_SHOT_KEY}`,
    `distributions: ${snapshot.distributions.length === 0 ? "none" : snapshot.distributions.map((row) => `${row.status} ${row.idempotencyKey}`).join(",")}`,
  ];
  if (split?.ok) {
    for (const share of split.shares)
      lines.push(
        `allocation: ${share.address} ${share.amount} (${formatTokens(share.amount, 6)} TREST)`
      );
  }
  return `${lines.join("\n")}\n`;
}

export function parseVentFeeArgs(argv: readonly string[]): Parsed {
  const flags = [
    "--execute",
    "--approval",
    "--child",
    "--parent",
    "--max-vault",
    "--min-vault",
    "--operator",
    "--reason",
  ] as const;
  const values = new Map<string, string>();
  let execute = false;
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (!flags.includes(name as (typeof flags)[number]))
      return { ok: false, code: "argument" };
    if (name === "--execute") {
      if (equals !== -1 || execute) return { ok: false, code: "argument" };
      execute = true;
      continue;
    }
    if (values.has(name)) return { ok: false, code: "argument" };
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--"))
      return { ok: false, code: "argument" };
    values.set(name, value);
  }
  if (!execute && values.size === 0) return { ok: true, mode: "dry-run" };
  if (!execute) return { ok: false, code: "argument" };
  const approval = values.get("--approval");
  const child = values.get("--child");
  const parent = values.get("--parent");
  const max = values.get("--max-vault");
  const min = values.get("--min-vault") ?? "1";
  const operator = values.get("--operator");
  const reason = values.get("--reason");
  if (!approval || !child || !parent || !max || !operator || !reason)
    return { ok: false, code: "argument" };
  if (approval !== VENT_FEE_APPROVAL) return { ok: false, code: "approval" };
  if (!sameAddress(child, VENT_MINT) || !sameAddress(parent, TREST_MINT))
    return { ok: false, code: "target" };
  if (amount(min) === null || amount(max) === null)
    return { ok: false, code: "vault" };
  if (
    !OPERATOR.test(operator) ||
    reason.trim().length === 0 ||
    reason.length > 240
  )
    return { ok: false, code: "argument" };
  return {
    ok: true,
    mode: "execute",
    request: {
      approval,
      child: VENT_MINT,
      parent: TREST_MINT,
      min,
      max,
      operator,
      reason: reason.trim(),
    },
  };
}

export function formatExecution(result: ExecuteResult): string {
  if (result.ok) {
    const receipts = result.receipts
      .map((receipt) => `${receipt.role} ${receipt.address} ${receipt.amount}`)
      .join(",");
    return `TREST-05B execute\nstatus: confirmed\nsignature: ${result.signature}\namount: ${result.amount}\nreceipts: ${receipts}\n`;
  }
  const signature = result.signature ? `\nsignature: ${result.signature}` : "";
  return `TREST-05B execute\nstatus: blocked\nblocked: ${result.code}${signature}\n`;
}

export async function executeOneShot(input: {
  snapshot: VentSnapshot;
  approval: VaultApproval;
  ledger: DistributionLedger;
  sign: () => Promise<
    { ok: true; signature: string } | { ok: false; code: string }
  >;
  submit: () => Promise<
    { status: "accepted" } | { status: "failed" | "uncertain" }
  >;
  confirm: (
    signature: string
  ) => Promise<
    | {
        status: "confirmed";
        slot: string | null;
        deltas: readonly {
          owner: string;
          mint: string;
          amount: string;
          sign?: "credit" | "debit";
        }[];
      }
    | { status: "failed" | "unconfirmed" }
  >;
}): Promise<ExecuteResult> {
  const decision = assessVentFee(input.snapshot, input.approval);
  if (!decision.ready)
    return { ok: false, code: decision.blocks.join(","), signature: null };
  const existing = await input.ledger.list(VENT_MINT);
  const prior = priorDistributionBlock(existing);
  if (prior) return { ok: false, code: prior, signature: null };
  const signed = await input.sign();
  if (!signed.ok) return { ok: false, code: signed.code, signature: null };
  const reserved = await input.ledger.reserve({
    key: ONE_SHOT_KEY,
    childMint: VENT_MINT,
    quoteMint: TREST_MINT,
    signature: signed.signature,
  });
  if (reserved === "conflict")
    return { ok: false, code: "overlap", signature: signed.signature };
  const sent = await input.submit();
  if (sent.status !== "accepted") {
    const status = sent.status === "uncertain" ? "uncertain" : "failed";
    await input.ledger.mark(ONE_SHOT_KEY, status);
    return { ok: false, code: status, signature: signed.signature };
  }
  const observed = await input.confirm(signed.signature);
  if (observed.status === "failed") {
    await input.ledger.mark(ONE_SHOT_KEY, "failed");
    return { ok: false, code: "failed", signature: signed.signature };
  }
  if (observed.status !== "confirmed") {
    await input.ledger.mark(ONE_SHOT_KEY, "unreconciled");
    return { ok: false, code: "unreconciled", signature: signed.signature };
  }
  const shareholders = expectedShareholders();
  const distributed = observed.deltas
    .filter((delta) => delta.sign === "credit" && delta.mint === TREST_MINT)
    .reduce(
      (sum, delta) => sum + (amount(delta.amount) ?? BigInt(0)),
      BigInt(0)
    )
    .toString();
  const matched = matchShareholderReceipts({
    quoteMint: TREST_MINT,
    shareholders,
    distributed,
    deltas: observed.deltas,
  });
  if (!matched.ok) {
    await input.ledger.mark(ONE_SHOT_KEY, "unreconciled");
    return { ok: false, code: "unreconciled", signature: signed.signature };
  }
  const originator = input.snapshot.launch?.originator ?? null;
  const rows = matched.receipts.map((receipt) => ({
    address: receipt.address,
    amount: receipt.amount,
    role: (receipt.address === LAUNCHER
      ? "launcher"
      : receipt.address === originator
        ? "developer"
        : "platform") as "launcher" | "developer" | "platform",
  }));
  await input.ledger.receipts({
    key: ONE_SHOT_KEY,
    quoteMint: TREST_MINT,
    signature: signed.signature,
    slot: observed.slot,
    rows,
  });
  const confirmed = await input.ledger.confirm(ONE_SHOT_KEY, distributed);
  if (!confirmed)
    return { ok: false, code: "confirm_lost", signature: signed.signature };
  return {
    ok: true,
    signature: signed.signature,
    amount: distributed,
    receipts: rows,
  };
}
