import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { selectStaticAltMembers } from "../../../lib/launch/alt.ts";
import { PLATFORM_FEE_WALLET, allocateCreatorFees, type FeeCategory } from "../../../lib/launch/fees.ts";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { assembleChildLaunch, fixtureCurve, type AssembleLaunchInput } from "./assemble.ts";
import { knownStaticAddresses } from "./protocol.ts";

export function seeded(byte: number): PublicKey {
  return Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
}

export const FIXTURE_MINT = seeded(3);
export const FIXTURE_LAUNCHER = seeded(4);
export const FIXTURE_ORIGINATOR = seeded(5);
export const FIXTURE_PARENT = seeded(6);
export const FIXTURE_BLOCKHASH = seeded(7).toBase58();

const SCENARIOS: { category: FeeCategory; buy: boolean; migrated: boolean }[] = [
  { category: "community_split", buy: false, migrated: false },
  { category: "community_split", buy: true, migrated: false },
  { category: "originator_launch", buy: false, migrated: false },
  { category: "originator_launch", buy: true, migrated: false },
  { category: "official", buy: false, migrated: false },
  { category: "official", buy: true, migrated: false },
  { category: "community_split", buy: false, migrated: true },
  { category: "community_split", buy: true, migrated: true },
];

const REALISTIC = { name: "SDK FixtureX", symbol: "PAIR", uri: "h".repeat(98) };
const WORST = { name: "N".repeat(32), symbol: "S".repeat(13), uri: "h".repeat(200) };

function inputFor(
  scenario: { category: FeeCategory; buy: boolean; migrated: boolean },
  text: { name: string; symbol: string; uri: string },
): AssembleLaunchInput {
  const fees = allocateCreatorFees({
    category: scenario.category,
    launcherWallet: FIXTURE_LAUNCHER.toBase58(),
    originatorWallet: scenario.category === "community_split" ? FIXTURE_ORIGINATOR.toBase58() : null,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  if (!fees.ok) throw new Error(fees.code);
  const pool = scenario.migrated
    ? { pool: seeded(8), baseVault: seeded(9), quoteVault: seeded(10) }
    : undefined;
  return {
    name: text.name,
    symbol: text.symbol,
    uri: text.uri,
    mint: FIXTURE_MINT,
    launcher: FIXTURE_LAUNCHER,
    parentMint: FIXTURE_PARENT,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    shareholders: fees.shareholders,
    blockhash: FIXTURE_BLOCKHASH,
    lastValidBlockHeight: 1n,
    coverage: "fixture",
    pumpQuote: pool ? { pool, chain: [] } : { chain: [] },
    buy: scenario.buy
      ? {
          quoteBaseUnits: new BN(1_000_000),
          tokenAmount: new BN(1_000_000),
          slippagePercent: 1,
          bondingCurve: fixtureCurve(FIXTURE_PARENT, FIXTURE_LAUNCHER),
        }
      : null,
  };
}

export async function measureFixtures() {
  const known = knownStaticAddresses(PLATFORM_FEE_WALLET);
  const referenced = new Set<string>();
  const measured = [];
  for (const scenario of SCENARIOS) {
    const assembled = await assembleChildLaunch(inputFor(scenario, REALISTIC));
    for (const account of assembled.referencedAccounts) referenced.add(account);
    measured.push({
      category: scenario.category,
      buy: scenario.buy,
      migrated: scenario.migrated,
      bytes: assembled.byteLength,
      accounts: assembled.accountCount,
      signers: assembled.signers.length,
      signerAddresses: assembled.signers,
      fitsPacket: assembled.fitsPacket,
      roles: assembled.roles,
      lookupTables: assembled.lookupTables,
      staticAccountKeys: assembled.staticAccountKeys,
      coverage: assembled.coverage,
      transactionVersion: assembled.transactionVersion,
      configMask: assembled.configMask,
    });
  }
  const signers = [FIXTURE_MINT.toBase58(), FIXTURE_LAUNCHER.toBase58()];
  const staticMembers = selectStaticAltMembers({
    referenced: [...referenced],
    signers,
    knownStatic: known,
  });
  const worstInput = inputFor(
    { category: "community_split", buy: true, migrated: true },
    WORST,
  );
  const worst = await assembleChildLaunch(worstInput);
  return {
    staticMembers,
    measured,
    signers,
    worst: {
      bytes: worst.byteLength,
      accounts: worst.accountCount,
      signers: worst.signers.length,
      fitsPacket: worst.fitsPacket,
      lookupTables: worst.lookupTables,
    },
  };
}
