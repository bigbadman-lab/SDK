import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import { PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { claimAuthorizationMessage } from "../../../lib/rewards/ownership.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { creatorVaultAddress, heliusChain, observeMeta, readCreatorVaults, type Chain, type ObservedTransaction, type SubmitResult } from "./chain.ts";
import { reconcileLegacyCollection } from "./legacy-recovery.ts";
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

const WINDOW = 5 * 60 * 1000;

function testRehearsal(blockSideWork = false) {
  const start = NOW - (NOW % WINDOW);
  return { windowStartsMs: [start, start + WINDOW, start + 2 * WINDOW], blockSideWork };
}

function harness(input?: {
  wallet?: string;
  submit?: "submitted" | "uncertain" | "preflight" | "timeout";
  buyStatus?: "confirmed" | "failed";
  deposit?: string;
  holders?: "fail-once" | "none";
  signatureState?: "absent" | "present" | "unknown";
  blockhashValid?: "valid" | "expired" | "unknown";
  blockHeight?: string | null;
  lagReads?: number;
  collectStatus?: "confirmed" | "failed";
  parentMint?: string;
  blockSideWork?: boolean;
  vaultLamports?: string;
  rehearsal?: boolean;
}) {
  const key = signer();
  const holder = signer();
  const vault = creatorVaultAddress(key.address);
  assert.ok(vault);
  const submits: Uint8Array[] = [];
  const readSignatures: string[] = [];
  let reads = 0;
  let observations = 0;
  let holderFailures = 0;
  let vaultBalance = input?.vaultLamports ?? "1890880";
  const chain: Chain = {
    async account(address) {
      if (address === key.address) return { lamports: input?.wallet ?? "5000000000", owner: SYSTEM, data: new Uint8Array() };
      if (address === vault) return { lamports: vaultBalance, owner: SYSTEM, data: new Uint8Array() };
      return null;
    },
    async rent() {
      return "890880";
    },
    async mint() {
      return { decimals: 6, tokenProgram: TOKEN_2022_PROGRAM_ID };
    },
    async holders() {
      if (input?.holders === "fail-once" && holderFailures === 0) {
        holderFailures += 1;
        return null;
      }
      if (input?.holders === "none") {
        return { observedSlot: "44", accounts: [{ owner: holder.address, mint: TREST, amount: "49999999999" }] };
      }
      return { observedSlot: "44", accounts: [{ owner: holder.address, mint: TREST, amount: "50000000000" }] };
    },
    async slot() {
      return "44";
    },
    async blockHeight() {
      return input?.blockHeight === undefined ? "44" : input.blockHeight;
    },
    async blockTime() {
      return null;
    },
    async blockhash() {
      return new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
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
    async submit(wire): Promise<SubmitResult> {
      submits.push(wire);
      if (input?.submit === "preflight") return { status: "preflight", code: "rpc:-32002", detail: "Transaction simulation failed: custom program error: 0x1" };
      if (input?.submit === "uncertain" || input?.submit === "timeout") return { status: "uncertain", code: "timeout", detail: "timeout" };
      return { status: "accepted" };
    },
    async signatureState() {
      return input?.signatureState ?? "unknown";
    },
    async blockhashValid() {
      return input?.blockhashValid ?? "unknown";
    },
    async pace() {},
    async transaction(signature, lookup) {
      readSignatures.push(signature);
      reads += 1;
      if (reads <= (input?.lagReads ?? 0)) return null;
      observations += 1;
      if (input?.submit === "uncertain") return observed(key.address, { status: "uncertain" });
      if (lookup.destination !== key.address) {
        return observed(key.address, { destinationDelta: "298500", destinationTokenDelta: "40", feeLamports: "0", nativeVaultOut: "0", creatorDelta: "0" });
      }
      if (observations > 1) {
        return observed(key.address, { status: input?.buyStatus ?? "confirmed", nativeVaultOut: "0", creatorDelta: "0", feeLamports: "0" });
      }
      if (input?.collectStatus === "failed") return observed(key.address, { status: "failed" });
      const deposit = input?.deposit ?? "0";
      return observed(key.address, { creatorDelta: (995_000 + Number(deposit)).toString(), destinationDelta: (995_000 + Number(deposit)).toString() });
    },
  };
  const parent: RegisteredParent = {
    id: "00000000-0000-4000-8000-000000000001",
    scope: "test",
    symbol: "TREST",
    mintAddress: input?.parentMint ?? TREST,
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
    ...(input?.rehearsal === false ? {} : { rehearsal: testRehearsal(input?.blockSideWork ?? false) }),
  });
  return {
    key,
    holder,
    chain,
    store,
    submits,
    readSignatures,
    parent,
    setVault(value: string) {
      vaultBalance = value;
    },
  };
}

function cycleAt(env: ReturnType<typeof harness>, nowMs: number) {
  return runCycle({
    nowMs,
    holder: "worker-a",
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    store: env.store,
    chain: env.chain,
  });
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

test("a confirmed creator-vault receipt funds a 50/50 window and does not buy tokens", async () => {
  const env = harness();
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "collected");
  assert.equal(result.tokenCredited, "0");
  const windows = await env.store.windows(TREST, "test");
  assert.equal(windows[0]?.holders, "497500");
  assert.equal(windows[0]?.buyback, "0");
  assert.equal(windows[0]?.deployer, "497500");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.owner, env.holder.address);
  assert.equal(snaps[0]?.solLamports, "497500");
  assert.equal(snaps[0]?.tokenAmount, "0");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
  const again = await cycle(env);
  assert.equal(again.ok, true);
  assert.equal(env.submits.length, 1);
});

test("fees with no eligible holder stay unassigned and are not given to the protocol", async () => {
  const env = harness({ holders: "none" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.holderPolicy, "no_eligible_holders");
  const windows = await env.store.windows(TREST, "test");
  assert.equal(windows[0]?.holders, "497500");
  assert.equal(windows[0]?.buyback, "0");
  assert.equal(windows[0]?.deployer, "497500");
  assert.equal((await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "")).length, 0);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
});

test("missing signing credentials do not broadcast", async () => {
  const env = harness();
  const result = await runCycle({
    nowMs: NOW,
    holder: "worker-a",
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: null,
    expectedAddress: env.key.address,
    store: env.store,
    chain: env.chain,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "signer_mismatch");
  assert.equal(env.submits.length, 0);
});

test("a snapshot failure stops the rehearsal and does not allocate the receipt twice", async () => {
  const env = harness({ holders: "fail-once" });
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "unreconciled");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.windows(TREST, "test")).length, 1);
  const second = await cycle(env);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "suspended");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.windows(TREST, "test")).length, 1);
});

test("a short deployer wallet still allocates holder SOL and does not buy tokens", async () => {
  const short = harness({ wallet: "298500" });
  const allocated = await cycle(short);
  assert.equal(allocated.ok, true);
  if (!allocated.ok) return;
  assert.equal(allocated.stage, "collected");
  assert.equal(allocated.tokenCredited, "0");
  assert.equal(short.submits.length, 1);
  assert.equal((await short.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
  const windows = await short.store.windows(TREST, "test");
  assert.equal(windows[0]?.holders, "497500");
  assert.equal(windows[0]?.buyback, "0");
  assert.equal(windows[0]?.deployer, "497500");
});

test("the reserve is withheld once and a later pass does not allocate the same receipt", async () => {
  const env = harness();
  env.store = memoryStore({
    parent: env.parent,
    control: { suspended: false, reserveLamports: "4000", cycleCapLamports: "1000000000", slippageBps: 100 },
    rehearsal: testRehearsal(),
  });
  const first = await cycle(env);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const windows = await env.store.windows(TREST, "test");
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.collected, "991000");
  assert.equal(windows[0]?.holders, "495500");
  assert.equal(windows[0]?.buyback, "0");
  assert.equal(windows[0]?.deployer, "495500");
  const second = await cycle(env);
  assert.equal(second.ok, true);
  assert.equal((await env.store.windows(TREST, "test")).length, 1);
  assert.equal(env.submits.length, 1);
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
  assert.equal(second.code, "suspended");
  assert.equal(env.submits.length, 1);
  const stored = (await env.store.intents(env.parent.mintAddress, env.parent.scope)).find((intent) => intent.kind === "collect");
  assert.equal(stored?.status, "uncertain");
  assert.ok(stored?.signature);
  assert.equal(env.readSignatures.length, 0);
});

test("a second worker cannot enter a locked cycle", async () => {
  const env = harness();
  let release: (value: SubmitResult) => void = () => undefined;
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
  assert.equal(env.submits.length, 1);
  release({ status: "uncertain", code: "timeout", detail: "timeout" });
  await first;
});

test("a cycle with no second transaction keeps the SOL entitlement and credits no tokens", async () => {
  const env = harness({ buyStatus: "failed" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "collected");
  const windows = await env.store.windows(TREST, "test");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.solLamports, "497500");
  assert.equal(snaps[0]?.tokenAmount, "0");
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
  assert.equal((await env.store.control(TREST, "test"))?.suspended, false);
});

test("a thin deployer balance does not buy back and does not remove holder SOL", async () => {
  const env = harness({ wallet: "1000" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "collected");
  const windows = await env.store.windows(TREST, "test");
  const snaps = await env.store.snapshots(TREST, "test", windows[0]?.windowKey ?? "");
  assert.equal(snaps[0]?.solLamports, "497500");
  assert.equal(windows[0]?.deployer, "497500");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
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
  assert.equal(token.ok, false);
  if (token.ok) return;
  assert.equal(token.code, "amount");
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
  assert.equal(env.submits.length, before + 1);
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
  assert.equal(result.stage, "collected");
  assert.equal(result.tokenCredited, "0");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
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

const NEXT_WINDOW = NOW + 5 * 60 * 1000;

test("an earlier uncertain collection blocks the next window after a restart", async () => {
  const env = harness({ submit: "uncertain" });
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "uncertain");
  const restarted = await cycleAt(env, NEXT_WINDOW);
  assert.equal(restarted.ok, false);
  if (restarted.ok) return;
  assert.equal(restarted.code, "suspended");
  assert.equal(env.submits.length, 1);
  const collects = (await env.store.intents(TREST, "test")).filter((intent) => intent.kind === "collect");
  assert.equal(collects.length, 1);
  assert.equal(collects[0]?.status, "uncertain");
  assert.equal(collects[0]?.submissionCode, "timeout");
  assert.ok(collects[0]?.recentBlockhash);
});

test("an earlier submitted or unreconciled collection blocks a new collection", async () => {
  for (const status of ["submitted", "unreconciled"] as const) {
    const env = harness();
    env.chain.transaction = async (signature) => {
      env.readSignatures.push(signature);
      return null;
    };
    const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
    assert.equal(await env.store.recordIntent({
      idempotencyKey: "collect-earlier-window",
      parentMint: TREST,
      scope: "test",
      kind: "collect",
      amountLamports: "0",
      tokenAmount: null,
      messageSha256: null,
      recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
    }), "ok");
    assert.equal(await env.store.markIntent(TREST, "test", "collect-earlier-window", "submitted", signature), "ok");
    if (status === "unreconciled") {
      assert.equal(await env.store.markIntent(TREST, "test", "collect-earlier-window", "unreconciled", signature), "ok");
    }
    const blocked = await cycle(env);
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "uncertain");
    assert.equal(env.submits.length, 0);
    const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === "collect-earlier-window");
    assert.equal(stored?.signature, signature);
    assert.equal(stored?.status, status === "unreconciled" ? "unreconciled" : "uncertain");
  }
});

test("a missing signature and missing blockhash do not expire an uncertain collection", async () => {
  const env = harness({ submit: "uncertain", signatureState: "absent", blockhashValid: "expired" });
  env.chain.transaction = async (signature) => {
    env.readSignatures.push(signature);
    return null;
  };
  const first = await cycle(env);
  assert.equal(first.ok, false);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.kind === "collect");
  assert.ok(stored);
  stored.recentBlockhash = null;
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(env.submits.length, 1);
  assert.equal(stored.status, "uncertain");
});

test("an expired uncertain collection stops the rehearsal instead of being replaced", async () => {
  const env = harness({ submit: "uncertain", signatureState: "absent", blockhashValid: "expired" });
  env.chain.transaction = async (signature) => {
    env.readSignatures.push(signature);
    return null;
  };
  const first = await cycle(env);
  assert.equal(first.ok, false);
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(env.submits.length, 1);
  const collects = (await env.store.intents(TREST, "test")).filter((intent) => intent.kind === "collect");
  assert.equal(collects.length, 1);
  assert.equal(collects[0]?.status, "uncertain");
});

test("a preflight rejection stops the rehearsal", async () => {
  const env = harness({ submit: "preflight" });
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "failed");
  const failed = (await env.store.intents(TREST, "test")).find((intent) => intent.kind === "collect");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.submissionCode, "rpc:-32002");
  assert.equal(failed?.submissionDetail?.includes("custom program error"), true);
  assert.equal(failed?.submissionDetail?.includes("http://"), false);
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.receipts(TREST, "test")).length, 0);
});

test("a confirmed on-chain collection failure stops the rehearsal", async () => {
  const env = harness();
  let reads = 0;
  env.chain.transaction = async (signature) => {
    env.readSignatures.push(signature);
    reads += 1;
    return observed(env.key.address, { status: reads === 1 ? "failed" : "confirmed" });
  };
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "failed");
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  const collects = (await env.store.intents(TREST, "test")).filter((intent) => intent.kind === "collect");
  assert.equal(collects.length, 1);
  assert.equal(collects.filter((intent) => intent.status === "failed" && intent.submissionCode === "onchain_failed").length, 1);
  assert.equal((await env.store.receipts(TREST, "test")).length, 0);
  assert.equal(env.submits.length, 1);
});

test("an uncertain collection is not credited or replaced from the next window", async () => {
  const env = harness();
  env.chain.transaction = async (signature) => {
    env.readSignatures.push(signature);
    return null;
  };
  env.chain.signatureState = async () => "unknown";
  const first = await cycle(env);
  assert.equal(first.ok, false);
  assert.equal(env.submits.length, 1);
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal((await env.store.receipts(TREST, "test")).length, 0);
  assert.equal(env.submits.length, 1);
  const collects = (await env.store.intents(TREST, "test")).filter((intent) => intent.kind === "collect");
  assert.equal(collects.length, 1);
  assert.equal(collects[0]?.status, "uncertain");
});

test("a failed intent write cannot broadcast", async () => {
  const env = harness();
  env.store.markIntent = async () => "order";
  const blocked = await cycle(env);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "uncertain");
  assert.equal(env.submits.length, 0);
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(env.submits.length, 0);
});

test("legacy recovery unblocks only the two approved intents and leaves them uncertain", async () => {
  const mint = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
  const rows = [
    { idempotencyKey: "collect-1792587300000", signature: "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m" },
    { idempotencyKey: "collect-1792587600000", signature: "Rh18WpUe1wkT8bV8eVev7uTg1SY4jf1tRqdjo6c6Zufmtqbs5n99Yq6kJ3HzLLnxXKdtcKuwjKhWPpQx5E3Cqu6" },
  ];
  const env = harness({ parentMint: mint, submit: "uncertain" });
  const proof: Chain = {
    ...env.chain,
    async account() {
      return { lamports: "280727692", owner: SYSTEM, data: new Uint8Array() };
    },
    async slot() {
      return "5000";
    },
    async blockTime(slot) {
      return 1_000_000 + Number(slot);
    },
    async signatureState() {
      return "absent";
    },
    async transaction() {
      return null;
    },
    async submit() {
      throw new Error("legacy recovery must not broadcast");
    },
  };
  for (const row of rows) {
    assert.equal(await env.store.recordIntent({
      idempotencyKey: row.idempotencyKey,
      parentMint: mint,
      scope: "test",
      kind: "collect",
      amountLamports: "0",
      tokenAmount: null,
      messageSha256: null,
      recentBlockhash: null,
      createdAtMs: String((1_000_000 + 1000) * 1000),
    }), "ok");
    assert.equal(await env.store.markIntent(mint, "test", row.idempotencyKey, "submitted", row.signature), "ok");
    assert.equal(await env.store.markIntent(mint, "test", row.idempotencyKey, "uncertain", row.signature), "ok");
  }
  const blocked = await cycle(env);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "uncertain");
  assert.equal(env.submits.length, 0);
  const suspended = await cycle(env, { loopEnabled: false, authorised: false });
  assert.equal(suspended.ok, false);
  if (suspended.ok) return;
  assert.equal(suspended.code, "inactive");
  assert.equal(env.submits.length, 0);
  const first = await reconcileLegacyCollection({
    authorised: true,
    parentMint: mint,
    scope: "test",
    idempotencyKey: rows[0]?.idempotencyKey ?? "",
    signature: rows[0]?.signature ?? "",
    approval: "TREST-07F-LEGACY-RECOVERY",
    operator: "operator-1",
    reason: "First historical collection can no longer land.",
    deployer: env.key.address,
    store: env.store,
    chain: proof,
  });
  assert.equal(first.ok, true);
  const stillBlocked = await cycleAt(env, NEXT_WINDOW);
  assert.equal(stillBlocked.ok, false);
  assert.equal(env.submits.length, 0);
  const second = await reconcileLegacyCollection({
    authorised: true,
    parentMint: mint,
    scope: "test",
    idempotencyKey: rows[1]?.idempotencyKey ?? "",
    signature: rows[1]?.signature ?? "",
    approval: "TREST-07F-LEGACY-RECOVERY",
    operator: "operator-1",
    reason: "Second historical collection can no longer land.",
    deployer: env.key.address,
    store: env.store,
    chain: proof,
  });
  assert.equal(second.ok, true);
  const opened = await cycleAt(env, NEXT_WINDOW + 5 * 60 * 1000);
  assert.equal(opened.ok, false);
  if (opened.ok) return;
  assert.equal(opened.code, "suspended");
  assert.equal(env.submits.length, 0);
  const ready = harness({ parentMint: mint, submit: "uncertain" });
  for (const row of rows) {
    assert.equal(await ready.store.recordIntent({
      idempotencyKey: row.idempotencyKey,
      parentMint: mint,
      scope: "test",
      kind: "collect",
      amountLamports: "0",
      tokenAmount: null,
      messageSha256: null,
      recentBlockhash: null,
      createdAtMs: String((1_000_000 + 1000) * 1000),
    }), "ok");
    assert.equal(await ready.store.markIntent(mint, "test", row.idempotencyKey, "submitted", row.signature), "ok");
    assert.equal(await ready.store.markIntent(mint, "test", row.idempotencyKey, "uncertain", row.signature), "ok");
    assert.equal((await reconcileLegacyCollection({
      authorised: true,
      parentMint: mint,
      scope: "test",
      idempotencyKey: row.idempotencyKey,
      signature: row.signature,
      approval: "TREST-07F-LEGACY-RECOVERY",
      operator: "operator-1",
      reason: "Historical collection can no longer land.",
      deployer: ready.key.address,
      store: ready.store,
      chain: proof,
    })).ok, true);
  }
  const attempted = await cycle(ready);
  assert.equal(attempted.ok, false);
  if (attempted.ok) return;
  assert.equal(attempted.code, "uncertain");
  assert.equal(ready.submits.length, 1);
  const stopped = await cycleAt(ready, NEXT_WINDOW);
  assert.equal(stopped.ok, false);
  if (stopped.ok) return;
  assert.equal(stopped.code, "suspended");
  assert.equal(ready.submits.length, 1);
  const collects = (await env.store.intents(mint, "test")).filter((intent) => rows.some((row) => row.idempotencyKey === intent.idempotencyKey));
  assert.equal(collects.every((intent) => intent.status === "uncertain"), true);
  assert.equal((await env.store.legacyRecoveries(mint, "test")).length, 2);
  assert.equal((await env.store.receipts(mint, "test")).length, 0);
});

test("a worker without a rehearsal does not broadcast or settle a claim", async () => {
  const env = harness({ rehearsal: false });
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "rehearsal");
  const claim = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "1",
    idempotencyKey: "claim-without-rehearsal",
    message: "unsigned",
    signature: "unsigned",
    store: env.store,
    chain: env.chain,
  });
  assert.equal(claim.ok, false);
  if (claim.ok) return;
  assert.equal(claim.code, "rehearsal");
  assert.equal(env.submits.length, 0);
});

test("three empty windows close the rehearsal and a fourth key does not broadcast", async () => {
  const env = harness({ vaultLamports: "890880" });
  const start = NOW - (NOW % WINDOW);
  const early = await cycleAt(env, start - 1);
  assert.equal(early.ok, false);
  if (early.ok) return;
  assert.equal(early.code, "schedule");
  assert.equal((await env.store.rehearsalState(TREST, "test"))?.processed.length, 0);
  const first = await cycleAt(env, start);
  assert.equal(first.ok, true);
  const duplicate = await cycleAt(env, start + 1_000);
  assert.equal(duplicate.ok, true);
  assert.equal((await env.store.rehearsalState(TREST, "test"))?.processed.length, 1);
  for (const offset of [WINDOW, 2 * WINDOW]) {
    const result = await cycleAt(env, start + offset);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stage, "idle");
  }
  assert.equal(env.submits.length, 0);
  assert.equal((await env.store.rehearsalState(TREST, "test"))?.status, "closed");
  assert.equal((await env.store.control(TREST, "test"))?.suspended, true);
  const fourth = await cycleAt(env, start + 3 * WINDOW);
  assert.equal(fourth.ok, false);
  if (fourth.ok) return;
  assert.equal(fourth.code, "suspended");
  const control = await env.store.control(TREST, "test");
  assert.ok(control);
  control.suspended = false;
  const reopened = await cycleAt(env, start + 3 * WINDOW);
  assert.equal(reopened.ok, false);
  if (reopened.ok) return;
  assert.equal(reopened.code, "closed");
  assert.equal(env.submits.length, 0);
  assert.equal((await env.store.rehearsalState(TREST, "test"))?.processed.length, 3);
});

test("a skipped authorised key is not replaced and an outside key does not count", async () => {
  const env = harness({ vaultLamports: "890880" });
  const start = NOW - (NOW % WINDOW);
  const third = await cycleAt(env, start + 2 * WINDOW);
  assert.equal(third.ok, true);
  const outside = await cycleAt(env, start + 3 * WINDOW);
  assert.equal(outside.ok, false);
  if (outside.ok) return;
  assert.equal(outside.code, "schedule");
  const state = await env.store.rehearsalState(TREST, "test");
  assert.equal(state?.processed.length, 1);
  assert.equal(state?.processed[0]?.windowStartMs, start + 2 * WINDOW);
  assert.equal(env.submits.length, 0);
});

test("an overlapping claim consumes the window and blocks the second broadcast", async () => {
  const env = harness();
  const start = NOW - (NOW % WINDOW);
  const claimed = await env.store.claimRehearsalWindow({ parentMint: TREST, scope: "test", windowStartMs: start });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  assert.equal(claimed.admission, "execute");
  const second = await cycleAt(env, start);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "stopped");
  assert.equal(env.submits.length, 0);
  assert.equal((await env.store.control(TREST, "test"))?.suspended, true);
  const control = await env.store.control(TREST, "test");
  assert.ok(control);
  control.suspended = false;
  const later = await cycleAt(env, start + WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "stopped");
  assert.equal(env.submits.length, 0);
});

test("a late schedule is rejected instead of shifted", async () => {
  const env = harness({ rehearsal: false });
  const start = Date.UTC(2026, 9, 21, 15, 10, 0);
  assert.equal(await env.store.registerRehearsal({
    parentMint: TREST,
    scope: "test",
    windowStartsMs: [start, start + WINDOW, start + 2 * WINDOW],
    nowMs: start,
    requireUpcoming: true,
  }), "rejected");
  assert.equal(await env.store.rehearsalState(TREST, "test"), null);
  const result = await cycleAt(env, start);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "rehearsal");
  assert.equal(env.submits.length, 0);
});

test("an upcoming three-window schedule rejects an early tick and accepts the first key", async () => {
  const env = harness({ rehearsal: false, vaultLamports: "890880" });
  const start = Date.UTC(2026, 9, 21, 15, 10, 0);
  assert.equal(await env.store.registerRehearsal({
    parentMint: TREST,
    scope: "test",
    windowStartsMs: [start, start + WINDOW, start + 2 * WINDOW],
    nowMs: start - 1,
    requireUpcoming: true,
    blockSideWork: true,
  }), "ok");
  const early = await cycleAt(env, start - 1);
  assert.equal(early.ok, false);
  if (early.ok) return;
  assert.equal(early.code, "schedule");
  const first = await cycleAt(env, start);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.stage, "idle");
  assert.equal(env.submits.length, 0);
  const state = await env.store.rehearsalState(TREST, "test");
  assert.deepEqual(state?.windowStartsMs, [start, start + WINDOW, start + 2 * WINDOW]);
  assert.equal(state?.processed.length, 1);
});

test("an ordinary cycle does not submit a buyback when a later broadcast would be uncertain", async () => {
  const env = harness();
  let attempts = 0;
  env.chain.submit = async (wire) => {
    env.submits.push(wire);
    attempts += 1;
    if (attempts === 1) return { status: "accepted" };
    return { status: "uncertain", code: "timeout", detail: "timeout" };
  };
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "collected");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
  env.setVault("890880");
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.equal(later.stage, "idle");
  assert.equal(env.submits.length, 1);
});

test("a rehearsal database failure does not broadcast", async () => {
  const env = harness();
  env.store.claimRehearsalWindow = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(() => cycle(env));
  assert.equal(env.submits.length, 0);
  const closing = harness({ vaultLamports: "890880" });
  const start = NOW - (NOW % WINDOW);
  const finish = closing.store.finishRehearsalWindow.bind(closing.store);
  let finishes = 0;
  closing.store.finishRehearsalWindow = async (input) => {
    finishes += 1;
    if (finishes === 1) throw new Error("database unavailable");
    return finish(input);
  };
  await assert.rejects(() => cycleAt(closing, start));
  assert.equal(closing.submits.length, 0);
  assert.equal((await closing.store.rehearsalState(TREST, "test"))?.status, "stopped");
  const later = await cycleAt(closing, start + WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(closing.submits.length, 0);
});

test("a failed second observation does not create a buyback or another collection", async () => {
  const env = harness({ buyStatus: "failed" });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stage, "collected");
  assert.equal(env.submits.length, 1);
  env.setVault("890880");
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.equal(later.stage, "idle");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.intents(TREST, "test")).some((intent) => intent.kind === "buyback"), false);
});

test("claims stay unsigned while a rehearsal blocks side work", async () => {
  const env = harness({ blockSideWork: true });
  const funded = await cycle(env);
  assert.equal(funded.ok, true);
  const before = env.submits.length;
  const solMessage = claimAuthorizationMessage({
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    idempotencyKey: "claim-sol-rehearsal-0001",
    amount: "1",
  });
  assert.ok(solMessage);
  const secret = bs58.decode(env.holder.secret);
  const claim = await submitClaim({
    loopEnabled: true,
    authorised: true,
    suspended: false,
    secret: env.key.secret,
    expectedAddress: env.key.address,
    scope: "test",
    parentMint: TREST,
    claimant: env.holder.address,
    asset: "sol",
    amount: "1",
    idempotencyKey: "claim-sol-rehearsal-0001",
    message: solMessage,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(solMessage), secret)),
    store: env.store,
    chain: env.chain,
  });
  assert.equal(claim.ok, false);
  if (claim.ok) return;
  assert.equal(claim.code, "rehearsal");
  assert.equal(env.submits.length, before);
});

test("a delayed confirmation is observed without a second broadcast", async () => {
  const env = harness({ lagReads: 2 });
  const result = await cycle(env);
  assert.equal(result.ok, true);
  assert.equal(env.submits.length, 1);
  assert.ok(env.readSignatures.length >= 3);
  assert.equal((await env.store.receipts(TREST, "test")).length, 1);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.kind === "collect");
  assert.equal(stored?.status, "confirmed");
  assert.match(stored?.submissionDetail ?? "", /last_valid_block_height=/);
});

test("a confirmation missing through the bounded wait stays pending and blocks the next window", async () => {
  const env = harness({ lagReads: 20 });
  const first = await cycle(env);
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "uncertain");
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.kind === "collect");
  assert.equal(stored?.status, "uncertain");
  assert.equal(stored?.submissionCode, "confirmation_pending");
  const later = await cycleAt(env, NEXT_WINDOW);
  assert.equal(later.ok, false);
  if (later.ok) return;
  assert.equal(later.code, "suspended");
  assert.equal(env.submits.length, 1);
});

test("a confirmed on-chain collection failure creates no receipt", async () => {
  const env = harness({ collectStatus: "failed" });
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "failed");
  assert.equal(env.submits.length, 1);
  assert.equal((await env.store.receipts(TREST, "test")).length, 0);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.kind === "collect");
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.submissionCode, "onchain_failed");
});

test("an absent signature expires from the stored blockhash and is not collected again", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "expired" });
  env.chain.transaction = async (signature) => {
    env.readSignatures.push(signature);
    return null;
  };
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  assert.equal(await env.store.recordIntent({
    idempotencyKey: `collect-${start}`,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", `collect-${start}`, "submitted", signature), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "failed");
  assert.equal(env.submits.length, 0);
  assert.equal((await env.store.receipts(TREST, "test")).length, 0);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === `collect-${start}`);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.submissionCode, "expired");
});

test("an absent signature past its validity height expires without a chain error", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "unknown" });
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=1; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "failed");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.status, "failed");
  assert.equal(env.submits.length, 0);
});

test("a current slot above the stored block height does not expire the signature", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "unknown", blockHeight: "40" });
  env.chain.slot = async () => "100000000";
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=100; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "uncertain");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.status, "uncertain");
  assert.equal(env.submits.length, 0);
});

test("block height past the stored last valid block height expires an absent signature", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "unknown", blockHeight: "200" });
  env.chain.slot = async () => "1";
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=100; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "failed");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.submissionCode, "expired");
  assert.equal(env.submits.length, 0);
});

test("an unavailable block height leaves an absent signature uncertain", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "unknown", blockHeight: null });
  env.chain.slot = async () => "100000000";
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=1; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "uncertain");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.status, "uncertain");
});

test("a signature status error is not classified as expiry", async () => {
  const env = harness({ blockhashValid: "expired", blockHeight: "100000" });
  env.chain.signatureState = async () => {
    throw new Error("rpc timeout");
  };
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "uncertain");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.status, "uncertain");
  assert.equal(env.submits.length, 0);
});

test("a confirmed collection is not expired after its block height passes", async () => {
  const env = harness({ blockHeight: "100000" });
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal((await env.store.claimRehearsalWindow({ parentMint: TREST, scope: "test", windowStartMs: start })).ok, true);
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=1; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycleAt(env, start);
  assert.equal(result.ok, true);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key);
  assert.equal(stored?.status, "confirmed");
  assert.equal(stored?.signature, signature);
  assert.notEqual(stored?.submissionCode, "expired");
});

test("a still-valid absent signature is not treated as failed", async () => {
  const env = harness({ signatureState: "absent", blockhashValid: "valid" });
  env.chain.transaction = async () => null;
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  assert.equal(await env.store.recordSubmission(TREST, "test", key, {
    recentBlockhash: null,
    submissionCode: "confirmation_pending",
    submissionDetail: "last_valid_block_height=100; confirmation not visible before the bounded wait",
  }), "ok");
  const result = await cycle(env);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "uncertain");
  assert.equal((await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key)?.status, "uncertain");
  assert.equal(env.submits.length, 0);
});

test("a confirmed collection is reconciled once after a restart and is not broadcast again", async () => {
  const env = harness();
  const start = NOW - (NOW % WINDOW);
  const signature = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const key = `collect-${start}`;
  const claimed = await env.store.claimRehearsalWindow({ parentMint: TREST, scope: "test", windowStartMs: start });
  assert.equal(claimed.ok, true);
  assert.equal(await env.store.recordIntent({
    idempotencyKey: key,
    parentMint: TREST,
    scope: "test",
    kind: "collect",
    amountLamports: "0",
    tokenAmount: null,
    messageSha256: null,
    recentBlockhash: new PublicKey(nacl.sign.keyPair().publicKey).toBase58(),
  }), "ok");
  assert.equal(await env.store.markIntent(TREST, "test", key, "submitted", signature), "ok");
  const result = await cycleAt(env, start);
  assert.equal(result.ok, true);
  assert.equal((await env.store.receipts(TREST, "test")).length, 1);
  const stored = (await env.store.intents(TREST, "test")).find((intent) => intent.idempotencyKey === key);
  assert.equal(stored?.status, "confirmed");
  assert.equal(stored?.signature, signature);
  const submits = env.submits.length;
  await cycleAt(env, start);
  assert.equal(env.submits.length, submits);
  assert.equal((await env.store.receipts(TREST, "test")).length, 1);
});

