import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import { PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { claimAuthorizationMessage } from "../../../lib/rewards/ownership.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { creatorVaultAddress, heliusChain, observeMeta, readCreatorVaults, type Chain, type ObservedTransaction } from "./chain.ts";
import { buildSolCollection } from "./instructions.ts";
import { settleClaimHttp, type ClaimBody } from "./claim-route.ts";
import { runCycle, submitClaim } from "./run.ts";
import { memoryStore, type RegisteredParent } from "./store.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const HOLDER = "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y";
const SYSTEM = "11111111111111111111111111111111";
const NOW = Date.UTC(2026, 9, 20, 16, 2, 0);

function signer(): { secret: string; address: string } {
  const pair = nacl.sign.keyPair();
  return { secret: bs58.encode(pair.secretKey), address: new PublicKey(pair.publicKey).toBase58() };
}

function observed(feePayer: string, patch: Partial<ObservedTransaction> = {}): ObservedTransaction {
  return {
    status: "confirmed",
    slot: "44",
    feeLamports: "5000",
    feePayer,
    nativeVaultOut: "1000000",
    creatorDelta: "995000",
    wsolTokenOut: "0",
    wsolClosedLamports: "0",
    wsolRentLamports: "0",
    tokenDelta: "40",
    destinationDelta: "995000",
    destinationTokenDelta: "40",
    ...patch,
  };
}

function harness(input?: { wallet?: string; submit?: "submitted" | "uncertain"; buyStatus?: "confirmed" | "failed"; deposit?: string }) {
  const key = signer();
  const holder = signer();
  const vault = creatorVaultAddress(key.address);
  assert.ok(vault);
  const blockhash = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const submits: Uint8Array[] = [];
  const readSignatures: string[] = [];
  let reads = 0;
  const chain: Chain = {
    async account(address) {
      if (address === key.address) return { lamports: input?.wallet ?? "5000000000", owner: SYSTEM, data: new Uint8Array() };
      if (address === vault) return { lamports: "1890880", owner: SYSTEM, data: new Uint8Array() };
      return null;
    },
    async rent() {
      return "890880";
    },
    async mint() {
      return { decimals: 6, tokenProgram: TOKEN_2022_PROGRAM_ID };
    },
    async holders() {
      return { observedSlot: "44", accounts: [{ owner: holder.address, mint: TREST, amount: "50000000000" }] };
    },
    async slot() {
      return "44";
    },
    async blockhash() {
      return blockhash;
    },
    async market() {
      return {
        graduated: false,
        curve: {
          virtualTokenReserves: "1000000000",
          virtualQuoteReserves: "1000000000",
          realTokenReserves: "1000000000",
          realQuoteReserves: "0",
          tokenTotalSupply: "1000000000",
          complete: false,
          creator: key.address,
        },
      };
    },
    async submit(wire) {
      submits.push(wire);
      return input?.submit ?? "submitted";
    },
    async transaction(signature, lookup) {
      readSignatures.push(signature);
      reads += 1;
      if (input?.submit === "uncertain") return observed(key.address, { status: "uncertain" });
      if (lookup.destination !== key.address) {
        return observed(key.address, { destinationDelta: "298500", destinationTokenDelta: "40", feeLamports: "0", nativeVaultOut: "0", creatorDelta: "0" });
      }
      if (reads > 1) {
        return observed(key.address, { status: input?.buyStatus ?? "confirmed", nativeVaultOut: "0", creatorDelta: "0", feeLamports: "0" });
      }
      const deposit = input?.deposit ?? "0";
      return observed(key.address, { creatorDelta: (995_000 + Number(deposit)).toString(), destinationDelta: (995_000 + Number(deposit)).toString() });
    },
  };
  const parent: RegisteredParent = {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: TREST,
    deployerAddress: key.address,
    feeRecipientAddress: key.address,
    feeMode: "single_recipient",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 6,
    graduated: false,
    quoteMintAddress: SYSTEM,
    eligible: true,
  };
  const store = memoryStore({
    parent,
    control: { suspended: false, reserveLamports: "0", cycleCapLamports: "1000000000", slippageBps: 100 },
  });
  return { key, holder, chain, store, submits, readSignatures, parent };
}

function cycle(env: ReturnType<typeof harness>, patch?: { suspended?: boolean; authorised?: boolean; loopEnabled?: boolean }) {
  return runCycle({
    nowMs: NOW,
    holder: "worker-a",
    loopEnabled: patch?.loopEnabled ?? true,
    authorised: patch?.authorised ?? true,
    suspended: patch?.suspended ?? false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    store: env.store,
    chain: env.chain,
  });
}

test("an unauthorised worker does not read vaults or broadcast", async () => {
  const env = harness();
  const result = await cycle(env, { authorised: false });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "inactive");
  assert.equal(env.submits.length, 0);
});

test("a confirmed creator-vault receipt funds a 30/30/40 window and a reconciled buyback", async () => {
  const env = harness();
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "bought");
  assert.equal(result.tokenCredited, "40");
  const windows = await env.store.windows(TREST, "test");
  assert.equal(windows[0]?.holders, "298500");
  assert.equal(windows[0]?.buyback, "298500");
  assert.equal(windows[0]?.deployer, "398000");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.owner, env.holder.address);
  assert.equal(snaps[0]?.solLamports, "298500");
  assert.equal(snaps[0]?.tokenAmount, "40");
  assert.equal(env.submits.length, 2);
  const again = await cycle(env);
  assert.equal(again.ok, true);
  assert.equal(env.submits.length, 2);
});

test("an unrelated deposit is excluded from the credited fee", async () => {
  const env = harness({ deposit: "50000" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  const receipts = await env.store.receipts(TREST, "test");
  assert.equal(receipts[0]?.amountLamports, "995000");
});

test("an uncertain broadcast is not retried after a restart", async () => {
  const env = harness({ submit: "uncertain" });
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "uncertain");
  const second = await cycle(env);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "uncertain");
  assert.equal(env.submits.length, 1);
  const stored = (await env.store.intents(env.parent.mintAddress, env.parent.scope)).find((intent) => intent.kind === "collect");
  assert.equal(env.readSignatures.length, 1);
  assert.equal(env.readSignatures[0], stored?.signature);
});

test("a second worker cannot enter a locked cycle", async () => {
  const env = harness();
  let release: (value: "submitted" | "uncertain") => void = () => undefined;
  env.chain.submit = (wire) => new Promise((resolve) => {
    env.submits.push(wire);
    release = resolve;
  });
  const first = cycle(env);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = await runCycle({
    nowMs: NOW,
    holder: "worker-b",
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    store: env.store,
    chain: env.chain,
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "locked");
  release("uncertain");
  await first;
});

test("a failed buyback keeps the SOL entitlement and credits no tokens", async () => {
  const env = harness({ buyStatus: "failed" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.tokenCredited, "0");
  const windows = await env.store.windows(TREST, "test");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.solLamports, "298500");
  assert.equal(snaps[0]?.tokenAmount, "0");
});

test("insufficient deployer SOL does not buy back and does not remove holder SOL", async () => {
  const env = harness({ wallet: "1000" });
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unfunded");
  const windows = await env.store.windows(TREST, "test");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.solLamports, "298500");
  assert.equal(env.submits.length, 1);
});

test("a mismatched or suspended signer broadcasts nothing", async () => {
  const env = harness();
  const mismatch = await runCycle({
    nowMs: NOW,
    holder: "worker-a",
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: signer().secret,
    expectedAddress: env.key.address,
    store: env.store,
    chain: env.chain,
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.code, "signer_mismatch");
  env.store = memoryStore({
    parent: env.parent,
    control: { suspended: true, reserveLamports: "0", cycleCapLamports: "1", slippageBps: 100 },
  });
  const suspended = await cycle(env);
  assert.equal(suspended.ok, false);
  if (suspended.ok) return;
  assert.equal(suspended.code, "suspended");
  assert.equal(env.submits.length, 0);
});

test("SOL and TREST claims require ownership and cannot be repeated or cross parents", async () => {
  const env = harness();
  await cycle(env);
  const before = env.submits.length;
  const solMessage = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-holder-0001",
    amount: "298500",
  });
  const tokenMessage = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "trest",
    idempotencyKey: "claim-trest-holder-001",
    amount: "40",
  });
  assert.ok(solMessage && tokenMessage);
  const secret = bs58.decode(env.holder.secret);
  const sol = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "298500",
    idempotencyKey: "claim-sol-holder-0001",
    message: solMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(solMessage), secret)),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(sol.ok, true);
  const repeat = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "298500",
    idempotencyKey: "claim-sol-holder-0001",
    message: solMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(solMessage), secret)),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(repeat.ok, false);
  if (repeat.ok) return;
  assert.equal(repeat.code, "duplicate");
  const token = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "trest",
    amount: "40",
    idempotencyKey: "claim-trest-holder-001",
    message: tokenMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(tokenMessage), secret)),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(token.ok, true);
  const productionMessage = claimAuthorizationMessage({
    scope: "production",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-holder-0002",
    amount: "1",
  });
  assert.ok(productionMessage);
  const otherParent = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "production",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "1",
    idempotencyKey: "claim-sol-holder-0002",
    message: productionMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(productionMessage), secret)),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(otherParent.ok, false);
  if (otherParent.ok) return;
  assert.equal(otherParent.code, "parent");
  assert.equal(env.submits.length, before + 2);
});

test("an uncertain claim is reconciled without a second transfer", async () => {
  const env = harness();
  await cycle(env);
  const before = env.submits.length;
  const message = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-resume-0001",
    amount: "298500",
  });
  assert.ok(message);
  assert.equal(await env.store.saveClaim({
    claimant: env.holder.address,
    asset: "sol",
    amount: "298500",
    idempotencyKey: "claim-sol-resume-0001",
    status: "uncertain",
    signature: "resume-signature",
    scope: "test",
    parentMint: TREST,
    proofHash: "ab".repeat(32),
  }), "ok");
  const resumed = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "298500",
    idempotencyKey: "claim-sol-resume-0001",
    message,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), bs58.decode(env.holder.secret))),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.signature, "resume-signature");
  assert.equal(env.submits.length, before);
});

test("an account claim crosses the worker boundary only for its reserved entitlement", async () => {
  const env = harness();
  await cycle(env);
  const before = env.submits.length;
  const message = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-boundary-01",
    amount: "298500",
  });
  assert.ok(message);
  const body = {
    scope: "test" as const,
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol" as const,
    amount: "298500",
    idempotencyKey: "claim-sol-boundary-01",
    message,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), bs58.decode(env.holder.secret))),
    domain: "sdk.fund",
  };
  const execute = (claim: ClaimBody) => submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: claim.scope,
    parentMint: claim.parentMint,
    claimant: claim.claimant,
    asset: claim.asset,
    amount: claim.amount,
    idempotencyKey: claim.idempotencyKey,
    message: claim.message,
    signature: claim.signature,
    domain: claim.domain,
    store: env.store,
    chain: env.chain,
  });
  const unsigned = await settleClaimHttp({
    headerMatches: false,
    runtimeReady: true,
    raw: JSON.stringify(body),
    execute,
  });
  assert.equal(unsigned.status, 401);
  const inactive = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: false,
    raw: JSON.stringify(body),
    execute,
  });
  assert.equal(inactive.status, 503);
  const arbitrary = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    raw: JSON.stringify({ ...body, instructions: [{ programId: "11111111111111111111111111111111" }] }),
    execute,
  });
  assert.equal(arbitrary.status, 400);
  assert.equal(env.submits.length, before);
  const accepted = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    raw: JSON.stringify(body),
    execute,
  });
  assert.equal(accepted.status, 200);
  assert.equal(typeof accepted.body.signature, "string");
  assert.equal(env.submits.length, before + 1);
  const inflated = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-boundary-02",
    amount: "999999999",
  });
  assert.ok(inflated);
  const over = await settleClaimHttp({
    headerMatches: true,
    runtimeReady: true,
    raw: JSON.stringify({
      ...body,
      amount: "999999999",
      idempotencyKey: "claim-sol-boundary-02",
      message: inflated,
      signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(inflated), bs58.decode(env.holder.secret))),
    }),
    execute,
  });
  assert.equal(over.status, 409);
  assert.equal(env.submits.length, before + 1);
});

test("Helius vault reads use the derived creator vault and parsed transaction meta", async () => {
  const creator = signer().address;
  const vault = creatorVaultAddress(creator);
  assert.ok(vault);
  const calls: string[] = [];
  const chain = heliusChain(async (method, params) => {
    calls.push(`${method}:${String(params[0])}`);
    if (method === "getAccountInfo" && params[0] === vault) {
      return { value: { lamports: 1_890_880, owner: "11111111111111111111111111111111", data: ["", "base64"] } };
    }
    if (method === "getMinimumBalanceForRentExemption") return 890_880;
    return { value: null };
  });
  const read = await readCreatorVaults(chain, creator);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.nativeLamports, "1000000");
  assert.equal(read.wsolLamports, "0");
  assert.equal(await chain.market(TREST), null);
  assert.equal(calls.some((call) => call.includes(vault)), true);
  const meta = observeMeta(
    {
      slot: 9,
      transaction: { message: { accountKeys: [creator, vault, HOLDER] } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10_000_000, 1_890_880, 1],
        postBalances: [10_995_000, 890_880, 1],
        preTokenBalances: [],
        postTokenBalances: [],
      },
    },
    { creator, solVault: vault, wsolVault: HOLDER, parentMint: TREST, destination: creator },
  );
  assert.equal(meta?.nativeVaultOut, "1000000");
  assert.equal(meta?.creatorDelta, "995000");
  assert.equal(meta?.feeLamports, "5000");
});

test("a graduated pool buyback is built from chain market state", async () => {
  const env = harness();
  env.parent.graduated = true;
  env.chain.market = async () => ({
    graduated: true,
    pool: {
      address: "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
      baseVault: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      quoteVault: "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
      baseReserve: "1000000000",
      quoteReserve: "1000000000",
      baseSupply: "1000000000000",
      quoteMint: "So11111111111111111111111111111111111111112",
      coinCreator: env.key.address,
      lpFeeBps: 25,
      protocolFeeBps: 5,
      creatorFeeBps: 0,
    },
  });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "bought");
  assert.equal(result.tokenCredited, "40");
});

test("the signer rejects an inserted transfer and an altered collection account", async () => {
  const env = harness();
  const built = await buildSolCollection({ creator: env.key.address, ammVaultExists: false });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const blockhash = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const instructions = built.instructions.map((instruction) => ({
    programId: instruction.programId,
    data: instruction.data,
    keys: instruction.keys,
  }));
  const policy = {
    kind: "collect" as const,
    scope: "test" as const,
    parentMint: TREST,
    deployer: env.key.address,
    recipient: env.key.address,
    maxLamports: "0",
    maxRentLamports: "0",
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  const sign = (next: typeof instructions) => signInspected({
    secret: env.key.secret,
    expectedAddress: env.key.address,
    suspended: false,
    transaction: { feePayer: env.key.address, recentBlockhash: blockhash, instructions: next },
    policy,
  });
  assert.equal(sign(instructions).ok, true);
  const stranger = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const inserted = sign([
    ...instructions,
    {
      programId: "11111111111111111111111111111111",
      data: [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      keys: [
        { pubkey: env.key.address, isSigner: true, isWritable: true },
        { pubkey: stranger, isSigner: false, isWritable: true },
      ],
    },
  ]);
  assert.equal(inserted.ok, false);
  const altered = instructions.map((instruction) => {
    if (instruction.programId !== PUMP_PROGRAM_ID) return instruction;
    return {
      ...instruction,
      keys: instruction.keys.map((key, index) => (index === 4 ? { ...key, pubkey: TREST } : key)),
    };
  });
  assert.equal(sign(altered).ok, false);
  const signerFlip = instructions.map((instruction) => {
    if (instruction.programId !== PUMP_PROGRAM_ID) return instruction;
    return {
      ...instruction,
      keys: instruction.keys.map((key, index) => (index === 0 ? { ...key, isSigner: true } : key)),
    };
  });
  assert.equal(sign(signerFlip).ok, false);
});
