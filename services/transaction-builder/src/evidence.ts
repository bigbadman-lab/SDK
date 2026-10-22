import { createRequire } from "node:module";
import { PublicKey } from "@solana/web3.js";

import type { LaunchEvidence } from "../../../lib/launch/chain-evidence.ts";
import { EXPECTED_PROGRAMS } from "./protocol.ts";

const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk") as {
  PumpSdk: new () => {
    decodeSharingConfig(account: { data: Buffer }): {
      admin: { toBase58(): string };
      adminRevoked: boolean;
      shareholders: { address: { toBase58(): string }; shareBps: number | { toNumber(): number } }[];
    };
    decodeBondingCurve(account: { data: Buffer }): {
      creator: { toBase58(): string };
      quoteMint?: { toBase58(): string };
    };
  };
  feeSharingConfigPda: (mint: PublicKey) => PublicKey;
  bondingCurvePda: (mint: PublicKey) => PublicKey;
};

export function transactionFromRpc(result: {
  slot?: number | string;
  meta?: {
    err?: unknown;
    preTokenBalances?: { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }[] | null;
    postTokenBalances?: { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }[] | null;
  } | null;
} | null): ChainTransaction {
  const balances = (rows: { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }[] | null | undefined) =>
    (rows ?? []).map((row) => ({
      mint: row.mint ?? "",
      owner: row.owner ?? "",
      amount: row.uiTokenAmount?.amount ?? "0",
    }));
  if (!result) return { status: "missing", error: false, slot: null, preTokenBalances: [], postTokenBalances: [] };
  if (!result.meta) {
    return {
      status: "uncertain",
      error: false,
      slot: result.slot === undefined ? null : String(result.slot),
      preTokenBalances: [],
      postTokenBalances: [],
    };
  }
  return {
    status: result.meta.err ? "failed" : "confirmed",
    error: result.meta.err != null,
    slot: result.slot === undefined ? null : String(result.slot),
    preTokenBalances: balances(result.meta.preTokenBalances),
    postTokenBalances: balances(result.meta.postTokenBalances),
  };
}

const decoder = new pump.PumpSdk();

export type AccountSnapshot = { owner: string; data: Uint8Array } | null;

export type ChainTransaction = {
  status: "confirmed" | "failed" | "missing" | "uncertain";
  error: boolean;
  slot: string | null;
  preTokenBalances: { mint: string; owner: string; amount: string }[];
  postTokenBalances: { mint: string; owner: string; amount: string }[];
};

export type EvidenceReader = {
  account(address: string): Promise<AccountSnapshot>;
  transaction(signature: string): Promise<ChainTransaction | null>;
};

function amount(rows: { mint: string; owner: string; amount: string }[], mint: string, owner: string): bigint {
  return rows
    .filter((row) => row.mint === mint && row.owner === owner)
    .reduce((sum, row) => sum + BigInt(row.amount), BigInt(0));
}

function uriFromAccount(account: AccountSnapshot): string | null {
  if (!account) return null;
  const text = Buffer.from(account.data).toString("utf8");
  const match = text.match(/https:\/\/[^\s\0"]+/);
  return match ? match[0] : null;
}

function bps(value: number | { toNumber(): number }): number {
  return typeof value === "number" ? value : value.toNumber();
}

export function evidenceFromAccounts(input: {
  childMint: string;
  launcher: string;
  mintAccount: AccountSnapshot;
  curveAccount: AccountSnapshot;
  sharingAccount: AccountSnapshot;
  metadataAccount: AccountSnapshot;
  transaction: ChainTransaction | null;
}): LaunchEvidence {
  const transaction = input.transaction;
  const confirmed = transaction?.status === "confirmed";
  let tokenProgram: string | null = null;
  if (input.mintAccount && TOKEN_PROGRAMS.has(input.mintAccount.owner)) tokenProgram = input.mintAccount.owner;
  let quoteMint: string | null = null;
  let launcher: string | null = null;
  if (input.curveAccount?.owner === EXPECTED_PROGRAMS.pump) {
    try {
      const curve = decoder.decodeBondingCurve({ data: Buffer.from(input.curveAccount.data) });
      quoteMint = curve.quoteMint?.toBase58() ?? null;
      launcher = curve.creator.toBase58();
    } catch {
      quoteMint = null;
      launcher = null;
    }
  }
  let shareholders: { address: string; shareBps: number }[] | null = null;
  let adminRevoked: boolean | null = null;
  let sharingAdmin: string | null = null;
  if (input.sharingAccount?.owner === EXPECTED_PROGRAMS.fee) {
    try {
      const sharing = decoder.decodeSharingConfig({ data: Buffer.from(input.sharingAccount.data) });
      adminRevoked = sharing.adminRevoked === true;
      sharingAdmin = sharing.admin.toBase58();
      shareholders = sharing.shareholders.map((row) => ({ address: row.address.toBase58(), shareBps: bps(row.shareBps) }));
    } catch {
      shareholders = null;
      adminRevoked = null;
      sharingAdmin = null;
    }
  }
  if (launcher && sharingAdmin) {
    try {
      const sharingConfig = pump.feeSharingConfigPda(new PublicKey(input.childMint)).toBase58();
      if (launcher === sharingConfig) launcher = sharingAdmin;
    } catch {
      // Keep the curve creator when the mint address cannot derive a sharing config.
    }
  }
  let buyExecuted: boolean | null = null;
  const balanceOwner = launcher ?? input.launcher;
  if (transaction && balanceOwner && transaction.status !== "uncertain" && transaction.status !== "missing") {
    const before = amount(transaction.preTokenBalances, input.childMint, balanceOwner);
    const after = amount(transaction.postTokenBalances, input.childMint, balanceOwner);
    buyExecuted = after > before;
  }
  return {
    transactionStatus: transaction?.status ?? "uncertain",
    transactionError: transaction ? transaction.error : null,
    slot: transaction?.slot ?? null,
    mintExists: confirmed ? input.mintAccount !== null : input.mintAccount ? true : null,
    tokenProgram,
    quoteMint,
    launcher,
    metadataUri: uriFromAccount(input.metadataAccount) ?? uriFromAccount(input.mintAccount),
    shareholders,
    adminRevoked,
    buyExecuted,
  };
}

export async function loadLaunchEvidence(
  reader: EvidenceReader,
  input: { signature: string; childMint: string; launcher: string },
): Promise<LaunchEvidence> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(input.childMint);
  } catch {
    return evidenceFromAccounts({
      childMint: input.childMint,
      launcher: input.launcher,
      mintAccount: null,
      curveAccount: null,
      sharingAccount: null,
      metadataAccount: null,
      transaction: { status: "uncertain", error: false, slot: null, preTokenBalances: [], postTokenBalances: [] },
    });
  }
  const sharing = pump.feeSharingConfigPda(mint).toBase58();
  const curve = pump.bondingCurvePda(mint).toBase58();
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), new PublicKey(METADATA_PROGRAM).toBuffer(), mint.toBuffer()],
    new PublicKey(METADATA_PROGRAM),
  );
  const [transaction, mintAccount, curveAccount, sharingAccount, metadataAccount] = await Promise.all([
    reader.transaction(input.signature).catch(() => null),
    reader.account(mint.toBase58()).catch(() => null),
    reader.account(curve).catch(() => null),
    reader.account(sharing).catch(() => null),
    reader.account(metadata.toBase58()).catch(() => null),
  ]);
  return evidenceFromAccounts({
    childMint: input.childMint,
    launcher: input.launcher,
    mintAccount,
    curveAccount,
    sharingAccount,
    metadataAccount,
    transaction: transaction ?? {
      status: "missing",
      error: false,
      slot: null,
      preTokenBalances: [],
      postTokenBalances: [],
    },
  });
}
