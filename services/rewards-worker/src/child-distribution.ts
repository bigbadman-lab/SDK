import { createRequire } from "node:module";
import {
  Connection,
  PublicKey,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  nativeCollectionInstruction,
  pumpCreatorFeeDistribution,
  type ObservedShare,
} from "../../../lib/rewards/child-fees.ts";
import type { ChildCandidate, ChildInstruction } from "./child-fees.ts";

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk") as {
  OnlinePumpSdk: new (connection: Connection) => {
    buildDistributeCreatorFeesInstructions(
      mint: PublicKey,
      options?: { quoteMint?: PublicKey; payer?: PublicKey }
    ): Promise<{ instructions: TransactionInstruction[] }>;
    fetchBondingCurve(
      mint: PublicKey
    ): Promise<{ creator: PublicKey; quoteMint: PublicKey; complete: boolean }>;
    getCreatorVaultQuoteBalances(
      creator: PublicKey,
      extraQuoteMints?: readonly PublicKey[]
    ): Promise<
      {
        mint: PublicKey;
        pumpVault: { toString(): string };
        ammVault: { toString(): string };
        total: { toString(): string };
      }[]
    >;
  };
  PumpSdk: new () => {
    decodeSharingConfig(account: AccountInfo<Buffer>): {
      admin: PublicKey;
      adminRevoked: boolean;
      shareholders: { address: PublicKey; shareBps: number }[];
    };
  };
  feeSharingConfigPda: (mint: PublicKey) => PublicKey;
};

function connection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

export function quoteDeltaRows(
  quoteMint: string,
  pre: readonly {
    mint: string;
    owner?: string | null;
    uiTokenAmount: { amount: string };
  }[],
  post: readonly {
    mint: string;
    owner?: string | null;
    uiTokenAmount: { amount: string };
  }[]
): { owner: string; mint: string; amount: string; sign: "credit" | "debit" }[] {
  const owners = new Set(
    [...pre, ...post].flatMap((row) =>
      row.mint === quoteMint && row.owner ? [row.owner] : []
    )
  );
  const deltas = [];
  for (const owner of owners) {
    const before = BigInt(
      pre.find((row) => row.mint === quoteMint && row.owner === owner)
        ?.uiTokenAmount.amount ?? "0"
    );
    const after = BigInt(
      post.find((row) => row.mint === quoteMint && row.owner === owner)
        ?.uiTokenAmount.amount ?? "0"
    );
    if (after === before) continue;
    deltas.push({
      owner,
      mint: quoteMint,
      amount: (after > before ? after - before : before - after).toString(),
      sign: after > before ? ("credit" as const) : ("debit" as const),
    });
  }
  return deltas;
}

export async function readQuoteDeltas(
  rpcUrl: string,
  signature: string,
  quoteMint: string
): Promise<
  | { owner: string; mint: string; amount: string; sign: "credit" | "debit" }[]
  | null
> {
  try {
    const tx = await connection(rpcUrl).getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return quoteDeltaRows(
      quoteMint,
      tx?.meta?.preTokenBalances ?? [],
      tx?.meta?.postTokenBalances ?? []
    );
  } catch {
    return null;
  }
}

export async function readSharing(
  rpcUrl: string,
  mint: string
): Promise<{
  address: string;
  admin: string;
  adminRevoked: boolean;
  shareholders: ObservedShare[];
} | null> {
  const mintKey = new PublicKey(mint);
  const address = pump.feeSharingConfigPda(mintKey);
  const account = await connection(rpcUrl).getAccountInfo(address);
  if (!account) return null;
  const decoded = new pump.PumpSdk().decodeSharingConfig(account);
  return {
    address: address.toBase58(),
    admin: decoded.admin.toBase58(),
    adminRevoked: decoded.adminRevoked,
    shareholders: decoded.shareholders.map((row) => ({
      address: row.address.toBase58(),
      shareBps: row.shareBps,
    })),
  };
}

export async function readChildFeeVault(
  rpcUrl: string,
  mint: string,
  quoteMint: string
): Promise<{
  creator: string;
  sharingConfig: string;
  quoteMint: string;
  tokenProgram: string;
  graduated: boolean;
  pumpVault: string;
  ammVault: string;
} | null> {
  try {
    const rpc = connection(rpcUrl);
    const mintKey = new PublicKey(mint);
    const quoteKey = new PublicKey(quoteMint);
    const sdk = new pump.OnlinePumpSdk(rpc);
    const curve = await sdk.fetchBondingCurve(mintKey);
    const quoteAccount = await rpc.getAccountInfo(quoteKey);
    if (!quoteAccount) return null;
    const balances = await sdk.getCreatorVaultQuoteBalances(curve.creator, [
      quoteKey,
    ]);
    const row = balances.find((balance) => balance.mint.equals(quoteKey));
    if (!row) return null;
    return {
      creator: curve.creator.toBase58(),
      sharingConfig: pump.feeSharingConfigPda(mintKey).toBase58(),
      quoteMint: curve.quoteMint.toBase58(),
      tokenProgram: quoteAccount.owner.toBase58(),
      graduated: curve.complete,
      pumpVault: row.pumpVault.toString(),
      ammVault: row.ammVault.toString(),
    };
  } catch {
    return null;
  }
}

export async function buildDistribution(
  rpcUrl: string,
  child: ChildCandidate,
  payer: string
): Promise<ChildInstruction[] | null> {
  try {
    const built = await new pump.OnlinePumpSdk(
      connection(rpcUrl)
    ).buildDistributeCreatorFeesInstructions(new PublicKey(child.mint), {
      quoteMint: new PublicKey(child.quoteMint),
      payer: new PublicKey(payer),
    });
    const instructions = built.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      data: [...instruction.data],
      keys: instruction.keys.map((key) => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
    }));
    if (
      instructions.some((instruction) =>
        nativeCollectionInstruction(instruction.data)
      )
    )
      return null;
    if (
      !instructions.some((instruction) =>
        pumpCreatorFeeDistribution(instruction.programId, instruction.data)
      )
    )
      return null;
    return instructions;
  } catch {
    return null;
  }
}
