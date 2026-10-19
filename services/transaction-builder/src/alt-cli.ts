import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { ALT_AUTHORITY, lookupTableBytes } from "../../../lib/launch/alt.ts";
import { measureFixtures } from "./fixtures.ts";

export type AltPlan = {
  cluster: "mainnet-beta";
  payer: string;
  authority: string;
  addresses: string[];
  addressCount: number;
  accountBytes: number;
  sent: false;
  reason: "dry_run" | "refused";
  balanceLamports?: number;
  rentLamports?: number;
  predictedAlt?: string;
  rpc: "read" | "unavailable";
};

export function refuseExecution(execute: boolean, approval: string | undefined): boolean {
  return execute && approval !== "approved";
}

export async function dryRunPlan(rpcUrl: string | null): Promise<AltPlan> {
  const { staticMembers } = await measureFixtures();
  const plan: AltPlan = {
    cluster: "mainnet-beta",
    payer: ALT_AUTHORITY,
    authority: ALT_AUTHORITY,
    addresses: staticMembers,
    addressCount: staticMembers.length,
    accountBytes: lookupTableBytes(staticMembers.length),
    sent: false,
    reason: "dry_run",
    rpc: "unavailable",
  };
  if (!rpcUrl) return plan;
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const payer = new PublicKey(ALT_AUTHORITY);
    const slot = await connection.getSlot("finalized");
    const [, predicted] = AddressLookupTableProgram.createLookupTable({
      authority: payer,
      payer,
      recentSlot: slot,
    });
    plan.balanceLamports = await connection.getBalance(payer, "confirmed");
    plan.rentLamports = await connection.getMinimumBalanceForRentExemption(plan.accountBytes);
    plan.predictedAlt = predicted.toBase58();
    plan.rpc = "read";
  } catch {
    plan.rpc = "unavailable";
  }
  return plan;
}

export function checkSignerPubkey(path: string): string {
  return execFileSync("solana-keygen", ["pubkey", path], { encoding: "utf8" }).trim();
}

export async function executeAlt(input: {
  execute: boolean;
  approval: string | undefined;
  signerPath: string;
  rpcUrl: string | null;
}): Promise<{ sent: false; reason: "refused" | "dry_run" } | { sent: true; alt: string }> {
  if (!input.execute || input.approval !== "approved" || !input.rpcUrl) {
    return { sent: false, reason: input.execute ? "refused" : "dry_run" };
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(input.signerPath, "utf8")) as number[]);
  const payer = Keypair.fromSecretKey(secret);
  if (payer.publicKey.toBase58() !== ALT_AUTHORITY) {
    throw new Error("Local signer is not the platform deployer");
  }
  const plan = await dryRunPlan(input.rpcUrl);
  const connection = new Connection(input.rpcUrl, "confirmed");
  const slot = await connection.getSlot("finalized");
  const [createIx, table] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: table,
    addresses: plan.addresses.map((address) => new PublicKey(address)),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(createIx, extendIx), [payer], {
    commitment: "confirmed",
  });
  return { sent: true, alt: table.toBase58() };
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  if (refuseExecution(execute, process.env.SDK_ALT_EXECUTE)) {
    process.stderr.write("ALT execution refused. No transaction was signed or sent.\n");
    process.exitCode = 2;
    return;
  }
  if (process.argv.includes("--check-signer")) {
    const path = process.env.SDK_ALT_SIGNER_PATH ?? `${process.env.HOME}/.config/sdk/keys/deployer.json`;
    const pubkey = checkSignerPubkey(path);
    process.stdout.write(`${JSON.stringify({ signer: pubkey, matchesDeployer: pubkey === ALT_AUTHORITY })}\n`);
    if (pubkey !== ALT_AUTHORITY) process.exitCode = 1;
    return;
  }
  if (execute) {
    const signerPath = process.env.SDK_ALT_SIGNER_PATH ?? `${process.env.HOME}/.config/sdk/keys/deployer.json`;
    const result = await executeAlt({
      execute: true,
      approval: process.env.SDK_ALT_EXECUTE,
      signerPath,
      rpcUrl: process.env.HELIUS_RPC_URL?.trim() || null,
    });
    process.stdout.write(`${JSON.stringify({ sent: result.sent, alt: "alt" in result ? result.alt : null })}\n`);
    if (!result.sent) process.exitCode = 2;
    return;
  }
  const plan = await dryRunPlan(process.env.HELIUS_RPC_URL?.trim() || null);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("alt-cli.ts")) {
  main().catch(() => {
    process.stderr.write("ALT dry-run failed. No transaction was signed or sent.\n");
    process.exitCode = 1;
  });
}
