import { createRequire } from "node:module";

import { PublicKey } from "@solana/web3.js";

import { PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { TOKEN_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import type { CurveMarket, PoolMarket } from "./instructions.ts";

const require = createRequire(import.meta.url);
type AccountData = { lamports: number; owner: PublicKey; data: Buffer; executable: boolean; rentEpoch: number };

const pump = require("@pump-fun/pump-sdk") as {
  bondingCurvePda(mint: PublicKey): PublicKey;
  OnlinePumpSdk: new (connection: {
    getAccountInfo(key: PublicKey): Promise<AccountData | null>;
    getMultipleAccountsInfo(keys: PublicKey[]): Promise<(AccountData | null)[]>;
  }) => {
    fetchBondingCurve(mint: PublicKey): Promise<{
      virtualTokenReserves: { toString(): string };
      virtualQuoteReserves: { toString(): string };
      realTokenReserves: { toString(): string };
      realQuoteReserves: { toString(): string };
      tokenTotalSupply: { toString(): string };
      complete: boolean;
      creator: PublicKey;
      quoteMint: PublicKey;
    }>;
    fetchQuotePool(input: { mint: PublicKey; bondingCurve: { quoteMint: PublicKey } }): Promise<{
      reserves: { baseReserves: { toString(): string }; quoteReserves: { toString(): string } };
      accounts: { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey };
    }>;
  };
};
const pumpSwap = require("@pump-fun/pump-swap-sdk") as {
  GLOBAL_CONFIG_PDA: PublicKey;
  coinCreatorVaultAuthorityPda(creator: PublicKey): PublicKey;
  coinCreatorVaultAtaPda(authority: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey;
  PUMP_AMM_SDK: {
    decodeGlobalConfig(account: AccountData): {
      lpFeeBasisPoints: { toNumber(): number };
      protocolFeeBasisPoints: { toNumber(): number };
      coinCreatorFeeBasisPoints: { toNumber(): number };
    };
    decodePool(account: AccountData): { quoteMint: PublicKey; coinCreator: PublicKey; baseMint: PublicKey };
  };
};
const { NATIVE_MINT } = require("@solana/spl-token") as { NATIVE_MINT: PublicKey };

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

export type ChainAccount = { lamports: string; owner: string; data: Uint8Array } | null;

export type MarketView = { graduated: false; curve: CurveMarket } | { graduated: true; pool: PoolMarket };

export type ObservedTransaction = {
  status: "confirmed" | "failed" | "uncertain";
  slot: string;
  feeLamports: string;
  feePayer: string;
  nativeVaultOut: string;
  creatorDelta: string;
  wsolTokenOut: string;
  wsolClosedLamports: string;
  wsolRentLamports: string;
  tokenDelta: string;
  destinationDelta: string;
  destinationTokenDelta: string;
};

export type Chain = {
  account(address: string): Promise<ChainAccount>;
  rent(bytes: number): Promise<string>;
  mint(mint: string): Promise<{ decimals: number; tokenProgram: string } | null>;
  holders(mint: string, tokenProgram: string): Promise<{ observedSlot: string; accounts: { owner: string; mint: string; amount: string }[] } | null>;
  slot(): Promise<string>;
  blockhash(): Promise<string>;
  market(mint: string): Promise<MarketView | null>;
  submit(wire: Uint8Array): Promise<"submitted" | "uncertain">;
  transaction(signature: string, lookup: VaultLookup): Promise<ObservedTransaction | null>;
};

export type VaultLookup = {
  creator: string;
  solVault: string;
  wsolVault: string;
  parentMint: string;
  destination: string;
};

export function bondingCurveAddress(mint: string): string | null {
  try {
    return pump.bondingCurvePda(new PublicKey(mint)).toBase58();
  } catch {
    return null;
  }
}

export function creatorVaultAddress(creator: string): string | null {
  try {
    const [address] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()],
      new PublicKey(PUMP_PROGRAM_ID),
    );
    return address.toBase58();
  } catch {
    return null;
  }
}

export function ammWsolVaultAddress(creator: string): string | null {
  try {
    const creatorKey = new PublicKey(creator);
    const authority = pumpSwap.coinCreatorVaultAuthorityPda(creatorKey);
    return pumpSwap.coinCreatorVaultAtaPda(authority, NATIVE_MINT, new PublicKey(TOKEN_PROGRAM_ID)).toBase58();
  } catch {
    return null;
  }
}

function u64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
  return value;
}

export function spendableLamports(lamports: string, rentLamports: string): string | null {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(lamports) || !/^(0|[1-9][0-9]{0,18})$/.test(rentLamports)) return null;
  const balance = BigInt(lamports);
  const rent = BigInt(rentLamports);
  return (balance > rent ? balance - rent : BigInt(0)).toString();
}

export function wsolAmount(account: ChainAccount): string | null {
  if (!account || account.owner !== TOKEN_PROGRAM_ID || account.data.length < 72) return "0";
  const mint = new PublicKey(account.data.subarray(0, 32)).toBase58();
  if (mint !== NATIVE_MINT.toBase58()) return null;
  const amount = u64(account.data, 64);
  return amount === null ? null : amount.toString();
}

export async function readCreatorVaults(chain: Chain, creator: string): Promise<
  { ok: true; nativeLamports: string; wsolLamports: string; ammVaultExists: boolean; solVault: string; wsolVault: string } | { ok: false; code: "vault" }
> {
  const solVault = creatorVaultAddress(creator);
  const wsolVault = ammWsolVaultAddress(creator);
  if (!solVault || !wsolVault) return { ok: false, code: "vault" };
  const [sol, wsol] = await Promise.all([chain.account(solVault), chain.account(wsolVault)]);
  if (sol && sol.owner !== SYSTEM_PROGRAM_ID) return { ok: false, code: "vault" };
  const rent = sol ? await chain.rent(sol.data.length) : "0";
  const native = spendableLamports(sol?.lamports ?? "0", rent);
  const wrapped = wsolAmount(wsol);
  if (native === null || wrapped === null) return { ok: false, code: "vault" };
  return {
    ok: true,
    nativeLamports: native,
    wsolLamports: wrapped,
    ammVaultExists: wrapped !== "0",
    solVault,
    wsolVault,
  };
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export async function heliusRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const requests = method === "batch"
        ? (params as { method: string; params: unknown[] }[]).map((request, id) => ({ jsonrpc: "2.0", id, method: request.method, params: request.params }))
        : [{ jsonrpc: "2.0", id: 1, method, params }];
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(method === "batch" ? requests : requests[0]),
      });
      if (response.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { result?: unknown; error?: unknown } | { result?: unknown; id?: number }[];
      if (method === "batch") {
        if (!Array.isArray(body)) return null;
        return [...body].sort((left, right) => Number(left.id) - Number(right.id)).map((entry) => entry.result ?? null);
      }
      if (!body || Array.isArray(body) || body.error) return null;
      return body.result ?? null;
    } catch {
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

function accountKey(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "pubkey" in value && typeof value.pubkey === "string") return value.pubkey;
  return null;
}

function signed(value: bigint): string {
  return value < BigInt(0) ? `-${(-value).toString()}` : value.toString();
}

export function observeMeta(value: unknown, lookup: VaultLookup): ObservedTransaction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    slot?: number;
    meta?: {
      err?: unknown;
      fee?: number;
      preBalances?: number[];
      postBalances?: number[];
      preTokenBalances?: { accountIndex?: number; mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }[];
      postTokenBalances?: { accountIndex?: number; mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }[];
    } | null;
    transaction?: { message?: { accountKeys?: unknown[] } };
  };
  if (!record.meta) {
    return { status: "uncertain", slot: String(record.slot ?? 0), feeLamports: "0", feePayer: "", nativeVaultOut: "0", creatorDelta: "0", wsolTokenOut: "0", wsolClosedLamports: "0", wsolRentLamports: "0", tokenDelta: "0", destinationDelta: "0", destinationTokenDelta: "0" };
  }
  const keys = (record.transaction?.message?.accountKeys ?? []).map(accountKey);
  const lamportDelta = (address: string): bigint | null => {
    const index = keys.indexOf(address);
    const pre = record.meta?.preBalances?.[index];
    const post = record.meta?.postBalances?.[index];
    if (index < 0 || typeof pre !== "number" || typeof post !== "number") return null;
    return BigInt(post) - BigInt(pre);
  };
  const creator = lamportDelta(lookup.creator);
  const vault = lamportDelta(lookup.solVault);
  const destination = lamportDelta(lookup.destination);
  if (creator === null || vault === null || destination === null || vault > BigInt(0)) return null;
  const tokenAmount = (rows: typeof record.meta.preTokenBalances, mint: string, owner: string): bigint => {
    const row = rows?.find((item) => item.mint === mint && item.owner === owner);
    return BigInt(row?.uiTokenAmount?.amount ?? "0");
  };
  const tokenAt = (rows: typeof record.meta.preTokenBalances, index: number): bigint => {
    const row = rows?.find((item) => item.accountIndex === index);
    return BigInt(row?.uiTokenAmount?.amount ?? "0");
  };
  const wsolIndex = keys.indexOf(lookup.wsolVault);
  const wsolPre = wsolIndex < 0 ? BigInt(0) : tokenAt(record.meta.preTokenBalances, wsolIndex);
  const wsolPost = wsolIndex < 0 ? BigInt(0) : tokenAt(record.meta.postTokenBalances, wsolIndex);
  const wsolOut = wsolPre > wsolPost ? wsolPre - wsolPost : BigInt(0);
  const wsolLamports = lamportDelta(lookup.wsolVault);
  const closed = wsolLamports !== null && wsolLamports < BigInt(0) ? -wsolLamports : BigInt(0);
  const rent = closed > wsolOut ? closed - wsolOut : BigInt(0);
  const parentPre = tokenAmount(record.meta.preTokenBalances, lookup.parentMint, lookup.creator);
  const parentPost = tokenAmount(record.meta.postTokenBalances, lookup.parentMint, lookup.creator);
  const destinationPre = tokenAmount(record.meta.preTokenBalances, lookup.parentMint, lookup.destination);
  const destinationPost = tokenAmount(record.meta.postTokenBalances, lookup.parentMint, lookup.destination);
  return {
    status: record.meta.err ? "failed" : "confirmed",
    slot: String(record.slot ?? 0),
    feeLamports: String(record.meta.fee ?? 0),
    feePayer: keys[0] ?? "",
    nativeVaultOut: (-vault).toString(),
    creatorDelta: signed(creator),
    wsolTokenOut: wsolOut.toString(),
    wsolClosedLamports: closed.toString(),
    wsolRentLamports: rent.toString(),
    tokenDelta: signed(parentPost - parentPre),
    destinationDelta: signed(destination),
    destinationTokenDelta: signed(destinationPost - destinationPre),
  };
}

function accountFromRpc(value: unknown): ChainAccount {
  if (!value || typeof value !== "object" || !("lamports" in value) || !("owner" in value) || !("data" in value)) return null;
  const record = value as { lamports: unknown; owner: unknown; data: unknown };
  const data = Array.isArray(record.data) ? record.data[0] : null;
  if (typeof record.owner !== "string" || typeof data !== "string" || typeof record.lamports !== "number") return null;
  return { lamports: String(record.lamports), owner: record.owner, data: Buffer.from(data, "base64") };
}

export function heliusChain(rpc: Rpc): Chain {
  return {
    async account(address) {
      const value = await rpc("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
      if (!value || typeof value !== "object" || !("value" in value)) return null;
      return accountFromRpc((value as { value: unknown }).value);
    },
    async rent(bytes) {
      const value = await rpc("getMinimumBalanceForRentExemption", [bytes]);
      return typeof value === "number" ? String(value) : "0";
    },
    async mint(mint) {
      const value = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
      if (!value || typeof value !== "object" || !("value" in value)) return null;
      const parsed = (value as { value: { owner?: string; data?: { parsed?: { info?: { decimals?: number } } } } | null }).value;
      const decimals = parsed?.data?.parsed?.info?.decimals;
      if (!parsed?.owner || typeof decimals !== "number") return null;
      return { decimals, tokenProgram: parsed.owner };
    },
    async holders(mint, tokenProgram) {
      const batched = await rpc("batch", [
        { method: "getSlot", params: [{ commitment: "confirmed" }] },
        {
          method: "getProgramAccounts",
          params: [tokenProgram, { encoding: "base64", commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint } }] }],
        },
      ]);
      if (!Array.isArray(batched) || typeof batched[0] !== "number" || !Array.isArray(batched[1])) return null;
      const accounts = batched[1].flatMap((row) => {
        const account = accountFromRpc((row as { account?: unknown }).account);
        if (!account || account.data.length < 72) return [];
        const owner = new PublicKey(account.data.subarray(32, 64)).toBase58();
        const amount = u64(account.data, 64);
        return amount === null ? [] : [{ owner, mint, amount: amount.toString() }];
      });
      return { observedSlot: String(batched[0]), accounts };
    },
    async slot() {
      const value = await rpc("getSlot", [{ commitment: "confirmed" }]);
      return typeof value === "number" ? String(value) : "0";
    },
    async blockhash() {
      const value = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const blockhash = value && typeof value === "object" && "value" in value ? (value as { value: { blockhash?: string } }).value.blockhash : null;
      if (!blockhash) throw new Error("blockhash");
      return blockhash;
    },
    async market(mint) {
      try {
        const read = async (key: PublicKey): Promise<AccountData | null> => {
          const value = await rpc("getAccountInfo", [key.toBase58(), { encoding: "base64", commitment: "confirmed" }]);
          const account = value && typeof value === "object" && "value" in value ? accountFromRpc((value as { value: unknown }).value) : null;
          if (!account) return null;
          return {
            lamports: Number(account.lamports),
            owner: new PublicKey(account.owner),
            data: Buffer.from(account.data),
            executable: false,
            rentEpoch: 0,
          };
        };
        const sdk = new pump.OnlinePumpSdk({
          getAccountInfo: read,
          getMultipleAccountsInfo: (keys) => Promise.all(keys.map((key) => read(key))),
        });
        const curve = await sdk.fetchBondingCurve(new PublicKey(mint));
        if (!curve.complete) {
          return {
            graduated: false,
            curve: {
              virtualTokenReserves: curve.virtualTokenReserves.toString(),
              virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
              realTokenReserves: curve.realTokenReserves.toString(),
              realQuoteReserves: curve.realQuoteReserves.toString(),
              tokenTotalSupply: curve.tokenTotalSupply.toString(),
              complete: false,
              creator: curve.creator.toBase58(),
            },
          };
        }
        const discovered = await sdk.fetchQuotePool({ mint: new PublicKey(mint), bondingCurve: curve });
        const poolAccount = await read(discovered.accounts.pool);
        const globalAccount = await read(pumpSwap.GLOBAL_CONFIG_PDA);
        if (!poolAccount || !globalAccount) return null;
        const decoded = pumpSwap.PUMP_AMM_SDK.decodePool(poolAccount);
        const global = pumpSwap.PUMP_AMM_SDK.decodeGlobalConfig(globalAccount);
        if (!decoded.quoteMint.equals(NATIVE_MINT) || !decoded.baseMint.equals(new PublicKey(mint))) return null;
        const fees = [global.lpFeeBasisPoints, global.protocolFeeBasisPoints, global.coinCreatorFeeBasisPoints].map((value) => value.toNumber());
        if (fees.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)) return null;
        return {
          graduated: true,
          pool: {
            address: discovered.accounts.pool.toBase58(),
            baseVault: discovered.accounts.baseVault.toBase58(),
            quoteVault: discovered.accounts.quoteVault.toBase58(),
            baseReserve: discovered.reserves.baseReserves.toString(),
            quoteReserve: discovered.reserves.quoteReserves.toString(),
            baseSupply: curve.tokenTotalSupply.toString(),
            quoteMint: decoded.quoteMint.toBase58(),
            coinCreator: decoded.coinCreator.toBase58(),
            lpFeeBps: fees[0] ?? 0,
            protocolFeeBps: fees[1] ?? 0,
            creatorFeeBps: fees[2] ?? 0,
          },
        };
      } catch {
        return null;
      }
    },
    async submit(wire) {
      try {
        const value = await rpc("sendTransaction", [Buffer.from(wire).toString("base64"), { encoding: "base64", skipPreflight: false }]);
        return typeof value === "string" ? "submitted" : "uncertain";
      } catch {
        return "uncertain";
      }
    },
    async transaction(signature, lookup) {
      const value = await rpc("getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
      if (!value) return null;
      return observeMeta(value, lookup);
    },
  };
}
