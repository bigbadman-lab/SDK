import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import type { Shareholder } from "../../../lib/launch/fees.ts";
import type { ParentFeeMode, ParentObservation } from "../../../lib/launch/parent.ts";
import { quoteBaseUnits } from "../../../lib/launch/quote-units.ts";
import { slippagePercent } from "../../../lib/launch/slippage.ts";
import { AssembleError, assembleChildLaunch, type AssembledLaunch } from "./assemble.ts";
import { pump } from "./protocol.ts";

const TOKEN_PROGRAMS = new Set([
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
]);

export function assessParent(input: {
  source: string;
  mayhem: boolean;
  cashback: boolean;
  parentDepth: number;
  maxCurveDepth: number;
  graduated: boolean;
  hasPool: boolean;
  decimals: number;
  quoteTokenProgram: string;
  registeredTokenProgram: string | null;
}): "ok" | "parent_ineligible" {
  if (input.source !== "pumpCoin") return "parent_ineligible";
  if (input.mayhem || input.cashback) return "parent_ineligible";
  if (!Number.isInteger(input.maxCurveDepth) || input.maxCurveDepth <= 0) {
    return "parent_ineligible";
  }
  const limit = Math.min(input.maxCurveDepth, pump.MAX_CURVE_DEPTH);
  if (!Number.isInteger(input.parentDepth) || input.parentDepth < 0 || input.parentDepth + 1 > limit) {
    return "parent_ineligible";
  }
  if (input.graduated && !input.hasPool) return "parent_ineligible";
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) {
    return "parent_ineligible";
  }
  if (!TOKEN_PROGRAMS.has(input.quoteTokenProgram)) return "parent_ineligible";
  if (input.registeredTokenProgram && input.registeredTokenProgram !== input.quoteTokenProgram) {
    return "parent_ineligible";
  }
  return "ok";
}

type Resolved = {
  source: string;
  decimals: number;
  quoteTokenProgram: PublicKey;
  pumpQuote?: {
    curve: {
      bondingCurve: {
        isMayhemMode: boolean;
        isCashbackCoin: boolean;
        depth: number;
        complete: boolean;
      };
      quoteControl?: unknown;
    };
    accounts: {
      pool?: { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey };
      chain?: { mint: PublicKey; pool?: { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey } }[];
    };
  };
};

type Online = {
  resolveQuoteMint(mint: PublicKey): Promise<Resolved>;
  fetchGlobal(): Promise<{ maxCurveDepth: number; tokenTotalSupply: BN; initialRealTokenReserves: BN }>;
  fetchFeeConfig(): Promise<unknown>;
  fetchQuoteTransferFee(mint: PublicKey): Promise<unknown>;
};

type LiveSdk = {
  OnlinePumpSdk: new (connection: Connection) => Online;
  newBondingCurve: (
    global: unknown,
    quoteMint: PublicKey,
    quoteControl: unknown,
    creatorFeeBps: BN,
    isHolderReward: boolean,
    pumpQuote: unknown,
  ) => AssembledLaunch extends never ? never : {
    virtualTokenReserves: BN;
    virtualQuoteReserves: BN;
    realTokenReserves: BN;
    realQuoteReserves: BN;
    tokenTotalSupply: BN;
    complete: boolean;
    creator: PublicKey;
    isMayhemMode: boolean;
    isCashbackCoin: boolean;
    quoteMint: PublicKey;
    creatorFeeBps: BN;
    canEditCreatorFee: boolean;
    isHolderReward: boolean;
    creatorFee: BN;
    protocolFees: BN;
    depth: number;
    initialVirtualQuoteReserves: BN;
    postCompleteBaseOut: BN;
    postCompleteQuoteIn: BN;
  };
  getBuyV3TokenAmountFromQuoteAmount(input: Record<string, unknown>): BN;
};

function liveSdk(): LiveSdk {
  return pump as unknown as LiveSdk;
}

export async function readLiveParent(
  connection: Connection,
  mintAddress: string,
  registeredTokenProgram: string | null,
): Promise<
  | { ok: false; code: "parent_ineligible" }
  | {
      ok: true;
      mint: PublicKey;
      quoteTokenProgram: PublicKey;
      decimals: number;
      graduated: boolean;
      accounts: NonNullable<Resolved["pumpQuote"]>["accounts"];
      curve: NonNullable<Resolved["pumpQuote"]>["curve"];
      global: unknown;
      feeConfig: unknown;
      quoteTransferFee: unknown;
    }
> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintAddress);
  } catch {
    return { ok: false, code: "parent_ineligible" };
  }
  const Online = liveSdk().OnlinePumpSdk;
  const online = new Online(connection);
  let resolved: Resolved;
  try {
    resolved = await online.resolveQuoteMint(mint);
  } catch {
    return { ok: false, code: "parent_ineligible" };
  }
  const quote = resolved.pumpQuote;
  if (!quote) return { ok: false, code: "parent_ineligible" };
  const global = await online.fetchGlobal();
  const verdict = assessParent({
    source: resolved.source,
    mayhem: quote.curve.bondingCurve.isMayhemMode,
    cashback: quote.curve.bondingCurve.isCashbackCoin,
    parentDepth: quote.curve.bondingCurve.depth,
    maxCurveDepth: global.maxCurveDepth,
    graduated: quote.curve.bondingCurve.complete,
    hasPool: Boolean(quote.accounts.pool),
    decimals: resolved.decimals,
    quoteTokenProgram: resolved.quoteTokenProgram.toBase58(),
    registeredTokenProgram,
  });
  if (verdict !== "ok") return { ok: false, code: "parent_ineligible" };
  const feeConfig = await online.fetchFeeConfig();
  const quoteTransferFee = await online.fetchQuoteTransferFee(mint);
  return {
    ok: true,
    mint,
    quoteTokenProgram: resolved.quoteTokenProgram,
    decimals: resolved.decimals,
    graduated: quote.curve.bondingCurve.complete,
    accounts: quote.accounts,
    curve: quote.curve,
    global,
    feeConfig,
    quoteTransferFee,
  };
}

export async function assembleLiveBuy(input: {
  connection: Connection;
  parentMint: string;
  registeredTokenProgram: string | null;
  launcher: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  shareholders: Shareholder[];
  blockhash: string;
  lastValidBlockHeight: bigint;
  buyAmount: string;
  slippageBps: number | null;
}): Promise<AssembledLaunch> {
  const parent = await readLiveParent(input.connection, input.parentMint, input.registeredTokenProgram);
  if (!parent.ok) throw new AssembleError("parent_ineligible");
  let buy: Parameters<typeof assembleChildLaunch>[0]["buy"] = null;
  if (input.buyAmount !== "0") {
    const units = quoteBaseUnits(input.buyAmount, parent.decimals);
    const slip = slippagePercent(input.slippageBps ?? 0);
    if (!units.ok || units.baseUnits === "0") throw new AssembleError("buy");
    if (!slip.ok) throw new AssembleError("slippage");
    const buyBaseUnits = new BN(units.baseUnits);
    const derived = liveSdk().newBondingCurve(
      parent.global,
      parent.mint,
      parent.curve.quoteControl ?? null,
      new BN(0),
      false,
      parent.curve,
    );
    const curve = {
      ...derived,
      creator: input.launcher,
      isMayhemMode: false,
      quoteMint: parent.mint,
    };
    const tokenAmount = liveSdk().getBuyV3TokenAmountFromQuoteAmount({
      global: parent.global,
      feeConfig: parent.feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      amount: buyBaseUnits,
      curveBaseTokenBalance: curve.realTokenReserves,
      quoteTransferFee: parent.quoteTransferFee,
    });
    if (tokenAmount.lten(0)) throw new AssembleError("buy_unpriceable");
    buy = {
      quoteBaseUnits: buyBaseUnits,
      tokenAmount,
      slippagePercent: slip.percent,
      bondingCurve: curve,
    };
  }
  return assembleChildLaunch({
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    mint: input.mint,
    launcher: input.launcher,
    parentMint: parent.mint,
    quoteTokenProgram: parent.quoteTokenProgram,
    shareholders: input.shareholders,
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
    coverage: "live",
    pumpQuote: parent.accounts,
    buy,
  });
}

function rpcFailed(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econn") ||
    message.includes("socket")
  );
}

export async function observeQuoteParent(
  connection: Connection,
  mintAddress: string,
): Promise<{ ok: true; observation: ParentObservation } | { ok: false; code: "parent_ineligible" | "unavailable" }> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintAddress);
  } catch {
    return { ok: false, code: "parent_ineligible" };
  }
  const online = new (liveSdk().OnlinePumpSdk)(connection);
  let resolved: Resolved;
  try {
    resolved = await online.resolveQuoteMint(mint);
  } catch (error) {
    return { ok: false, code: rpcFailed(error) ? "unavailable" : "parent_ineligible" };
  }
  const quote = resolved.pumpQuote;
  if (!quote) return { ok: false, code: "parent_ineligible" };
  let maxCurveDepth: number;
  try {
    maxCurveDepth = (await online.fetchGlobal()).maxCurveDepth;
  } catch {
    return { ok: false, code: "unavailable" };
  }
  const curve = quote.curve.bondingCurve as typeof quote.curve.bondingCurve & {
    creator?: PublicKey;
    quoteMint?: PublicKey;
    isHolderReward?: boolean;
  };
  if (!curve.creator) return { ok: false, code: "parent_ineligible" };
  const sharing = pump.feeSharingConfigPda(mint);
  const feeMode: ParentFeeMode = curve.isHolderReward
    ? "holder_rewards"
    : curve.creator.equals(sharing)
      ? "fee_sharing"
      : "single_recipient";
  const pool = quote.accounts.pool?.pool.toBase58() ?? null;
  let bondingCurve: string | null = null;
  try {
    const pda = (pump as { bondingCurvePda?: (value: PublicKey) => PublicKey }).bondingCurvePda;
    bondingCurve = pda ? pda(mint).toBase58() : null;
  } catch {
    bondingCurve = null;
  }
  return {
    ok: true,
    observation: {
      mint: mint.toBase58(),
      creator: curve.creator.toBase58(),
      feeMode,
      quoteMint: curve.quoteMint?.toBase58() ?? "11111111111111111111111111111111",
      tokenProgram: resolved.quoteTokenProgram.toBase58(),
      decimals: resolved.decimals,
      mayhem: curve.isMayhemMode,
      cashback: curve.isCashbackCoin,
      holderReward: curve.isHolderReward === true,
      depth: curve.depth,
      maxCurveDepth,
      graduated: curve.complete,
      hasPool: pool !== null,
      bondingCurve,
      pool,
      source: resolved.source,
    },
  };
}
