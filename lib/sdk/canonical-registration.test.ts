import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicChildLaunchesOpen } from "../launch/public-launch.ts";
import type { ParentObservation } from "../launch/parent.ts";
import { TREST_MINT, TOKEN_2022_PROGRAM } from "../launch/verified-launch.ts";
import { canonicalPhase, officialIdentity, rewardsAreActive, visibleOfficialMint } from "./official.ts";
import {
  CANONICAL_APPROVAL,
  memoryCanonicalStore,
  parseRegisterArgs,
  presentCanonicalStatus,
  readMintAccount,
  reviewCanonicalRegistration,
  runRegister,
  type CanonicalIdentity,
  type ExistingCanonical,
  type RegisterIo,
} from "./canonical-registration.ts";

const MINT = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const OTHER = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const DEPLOYER = "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC";
const RECIPIENT = "GJRBYe1nDVszvBDYDjT3Q7DW7fTkdHxaJbL4NvHPqF3p";
const OPERATOR = "5hAjFTvs7FoM2evWEMLU3GnNcQFJNk89RcaPbcsyp8rR";
const CREATOR = "11111111111111111111111111111111";
const QUOTE = "So11111111111111111111111111111111111111112";

function mintData(decimals = 6, initialized = 1): Uint8Array {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = initialized;
  return data;
}

function observation(patch: Partial<ParentObservation> = {}): ParentObservation {
  return {
    mint: MINT,
    creator: CREATOR,
    feeMode: "fee_sharing",
    quoteMint: QUOTE,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    mayhem: false,
    cashback: false,
    holderReward: false,
    depth: 0,
    maxCurveDepth: 5,
    graduated: false,
    hasPool: false,
    bondingCurve: null,
    pool: null,
    source: "pumpCoin",
    ...patch,
  };
}

function argv(extra: string[] = []): string[] {
  return [
    "node",
    "sdk-register",
    "--mint",
    MINT,
    "--deployer",
    DEPLOYER,
    "--fee-recipient",
    RECIPIENT,
    "--fee-mode",
    "fee_sharing",
    "--operator",
    OPERATOR,
    ...extra,
  ];
}

function harness(input: {
  account?: { owner: string; data: Uint8Array } | null | "unavailable";
  observed?: { ok: true; observation: ParentObservation } | { ok: false; code: "parent_ineligible" | "unavailable" };
  existing?: ExistingCanonical;
  schema?: boolean | "unavailable";
  commit?: RegisterIo["commit"];
} = {}): { io: RegisterIo; calls: { observe: number; commit: number } } {
  const calls = { observe: 0, commit: 0 };
  const io: RegisterIo = {
    async readMintAccount() {
      return input.account === undefined ? { owner: TOKEN_2022_PROGRAM, data: mintData() } : input.account;
    },
    async observe() {
      calls.observe += 1;
      return input.observed ?? { ok: true, observation: observation() };
    },
    async readExisting() {
      return input.existing ?? { config: null, production: null };
    },
    async schemaReady() {
      return input.schema ?? true;
    },
    async commit(identity) {
      calls.commit += 1;
      return input.commit ? input.commit(identity) : "ok";
    },
    childLaunchesOpen: () => false,
  };
  return { io, calls };
}

function readyIdentity(): CanonicalIdentity {
  const decision = reviewCanonicalRegistration({
    request: { mint: MINT, deployer: DEPLOYER, feeRecipient: RECIPIENT, feeMode: "fee_sharing", operator: OPERATOR },
    mintAccount: { owner: TOKEN_2022_PROGRAM, decimals: 6, initialized: true },
    observation: observation(),
    existing: { config: null, production: null },
  });
  if (!decision.ok) throw new Error(decision.code);
  return decision.identity;
}

test("a missing mint is rejected before any chain or database call", async () => {
  const missing = parseRegisterArgs(["node", "sdk-register"]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "missing_mint");
  const { io, calls } = harness();
  const result = await runRegister(["node", "sdk-register"], io);
  assert.equal(result.code, 2);
  assert.match(result.out, /code=missing_mint/);
  assert.match(result.out, /writes=0/);
  assert.equal(calls.observe, 0);
  assert.equal(calls.commit, 0);
});

test("an invalid address is rejected", async () => {
  const result = await runRegister(["node", "sdk-register", "--mint", "not-a-mint"], harness().io);
  assert.equal(result.code, 2);
  assert.match(result.out, /code=invalid_address/);
});

test("a missing mint account is rejected", async () => {
  const { io, calls } = harness({ account: null });
  const result = await runRegister(argv(), io);
  assert.match(result.out, /code=mint_not_found/);
  assert.equal(calls.observe, 0);
  assert.equal(calls.commit, 0);
});

test("the wrong token program and an unsupported mint are rejected", async () => {
  const program = await runRegister(argv(), harness({ account: { owner: CREATOR, data: mintData() } }).io);
  assert.match(program.out, /code=token_program/);
  const configured = await runRegister(argv(), harness({ account: { owner: TOKEN_2022_PROGRAM, data: mintData(6, 0) } }).io);
  assert.match(configured.out, /code=mint_configuration/);
  const incompatible = reviewCanonicalRegistration({
    request: { mint: MINT, deployer: DEPLOYER, feeRecipient: RECIPIENT, feeMode: "fee_sharing", operator: OPERATOR },
    mintAccount: { owner: TOKEN_2022_PROGRAM, decimals: 6, initialized: true },
    observation: observation({ mayhem: true }),
    existing: { config: null, production: null },
  });
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.equal(incompatible.code, "pump_incompatible");
  assert.equal(readMintAccount(CREATOR, mintData()), null);
  assert.equal(readMintAccount(TOKEN_2022_PROGRAM, mintData())?.decimals, 6);
});

test("the historical TREST mint is rejected", async () => {
  const { io, calls } = harness();
  const result = await runRegister(argv().map((token) => (token === MINT ? TREST_MINT : token)), io);
  assert.match(result.out, /code=trest_mint/);
  assert.equal(calls.observe, 0);
  assert.equal(calls.commit, 0);
});

test("a conflicting production registration is blocked", async () => {
  const existing: ExistingCanonical = {
    config: { mint: OTHER, tokenProgram: TOKEN_2022_PROGRAM, decimals: 6, quoteMint: QUOTE },
    production: {
      mint: OTHER,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
      quoteMint: QUOTE,
      deployer: DEPLOYER,
      feeRecipient: RECIPIENT,
      feeMode: "fee_sharing",
    },
  };
  const result = await runRegister(argv(["--execute", "--approval", CANONICAL_APPROVAL]), harness({ existing }).io);
  assert.match(result.out, /code=conflict/);
  assert.match(result.out, /writes=0/);
});

test("the same verified configuration is idempotent and does not write again", async () => {
  const identity = readyIdentity();
  const existing: ExistingCanonical = {
    config: { mint: identity.mint, tokenProgram: identity.tokenProgram, decimals: identity.decimals, quoteMint: identity.quoteMint },
    production: {
      mint: identity.mint,
      tokenProgram: identity.tokenProgram,
      decimals: identity.decimals,
      quoteMint: identity.quoteMint,
      deployer: identity.deployer,
      feeRecipient: identity.feeRecipient,
      feeMode: identity.feeMode,
    },
  };
  const { io, calls } = harness({ existing });
  const dry = await runRegister(argv(), io);
  assert.match(dry.out, /validation=idempotent/);
  assert.match(dry.out, /writes=0/);
  const again = await runRegister(argv(["--execute", "--approval", CANONICAL_APPROVAL]), io);
  assert.match(again.out, /verification=idempotent/);
  assert.equal(calls.commit, 0);
  assert.notEqual(identity.creator, identity.deployer);
});

test("a failed canonical write leaves both records unchanged", () => {
  const identity = readyIdentity();
  const store = memoryCanonicalStore("production");
  assert.equal(store.commit(identity), "rolled_back");
  assert.equal(store.snapshot(), null);
  const saved = memoryCanonicalStore();
  assert.equal(saved.commit(identity), "ok");
  assert.deepEqual(saved.snapshot(), { configMint: identity.mint, productionMint: identity.mint, rewardsActive: false });
});

test("homepage and SDK identity stay on the same canonical mint while rewards stay inactive", () => {
  const registered = canonicalPhase({ mint: MINT, decimals: 6, rewardsActive: false });
  const live = canonicalPhase({ mint: MINT, decimals: 6, rewardsActive: true });
  assert.equal(registered.phase, "registered");
  assert.equal(live.phase, "live");
  assert.equal(rewardsAreActive("registered"), false);
  assert.equal(rewardsAreActive("live"), true);
  const identity = officialIdentity({ ok: true, phase: "registered", mint: MINT, decimals: 6 });
  assert.equal(identity.mint, visibleOfficialMint("registered", MINT));
  assert.equal(identity.rewardsActive, false);
  assert.equal(officialIdentity({ ok: true, phase: "prelaunch" }).mint, null);
  const hero = readFileSync(new URL("../../components/hero.tsx", import.meta.url), "utf8");
  const sdk = readFileSync(new URL("../../app/sdk/page.tsx", import.meta.url), "utf8");
  const launch = readFileSync(new URL("../../app/launch/page.tsx", import.meta.url), "utf8");
  assert.equal(hero.includes("officialIdentity"), true);
  assert.equal(sdk.includes("officialIdentity"), true);
  assert.equal(launch.includes("officialIdentity"), true);
  assert.equal(hero.includes(MINT), false);
  assert.equal(sdk.includes(MINT), false);
  const market = readFileSync(new URL("../../app/api/sdk/market/route.ts", import.meta.url), "utf8");
  assert.equal(market.includes('export const dynamic = "force-dynamic"'), true);
  assert.equal(market.includes('"cache-control": "private, no-store"'), true);
});

test("registration leaves rewards and child launches inactive", async () => {
  const { io, calls } = harness();
  const dry = await runRegister(argv(), io);
  assert.match(dry.out, /rewards=inactive/);
  assert.match(dry.out, /child_launches=inactive/);
  assert.match(dry.out, /writes=0/);
  assert.equal(calls.commit, 0);
  const closed = await runRegister(argv(["--execute", "--approval", CANONICAL_APPROVAL]), harness({ schema: false }).io);
  assert.match(closed.out, /code=migration_required/);
  const opened = await runRegister(argv(["--execute", "--approval", CANONICAL_APPROVAL]), io);
  assert.match(opened.out, /verification=matched/);
  assert.match(opened.out, /rewards=inactive/);
  assert.match(opened.out, /child_launches=inactive/);
  assert.equal(calls.commit, 1);
  assert.equal(publicChildLaunchesOpen(undefined), false);
  const claim = readFileSync(new URL("../../app/api/account/rewards/claim/route.ts", import.meta.url), "utf8");
  const submit = readFileSync(new URL("../../app/api/launch/submit/route.ts", import.meta.url), "utf8");
  const build = readFileSync(new URL("../../app/api/launch/build/route.ts", import.meta.url), "utf8");
  const recover = readFileSync(new URL("../../app/api/launch/recover/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261026190000_sdk_prod_01a_canonical_parent.sql", import.meta.url), "utf8");
  const registrar = readFileSync(new URL("../../services/transaction-builder/src/sdk-register-cli.ts", import.meta.url), "utf8");
  assert.equal(claim.includes("rewardsAreActive"), true);
  assert.equal(submit.includes("readPublicLaunchGate"), true);
  assert.equal(build.includes("readPublicLaunchGate"), true);
  assert.equal(recover.includes("readPublicLaunchGate"), true);
  assert.equal(submit.includes("publicChildLaunchesOpen"), false);
  assert.equal(build.includes("PUBLIC_CHILD_LAUNCHES"), false);
  assert.match(migration, /rewards_active boolean not null default false/);
  assert.match(migration, /canonical mint is immutable/);
  assert.equal(migration.includes("BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump"), false);
  assert.equal(registrar.includes("sql.begin"), true);
  assert.match(registrar, /rewards_active = false|rewards_active, false/);
  assert.equal(registrar.includes("delete from parent_registrations"), false);
  assert.equal(registrar.includes("delete from sdk_parent_config"), false);
});

test("status reports an unregistered mint without a financial action", () => {
  const status = presentCanonicalStatus({
    database: "unavailable",
    configMint: null,
    productionMint: null,
    chain: "not_checked",
    rewardsActive: false,
    childLaunchesOpen: false,
  });
  assert.equal(status.code, 0);
  assert.match(status.out, /canonical_mint=unregistered/);
  assert.match(status.out, /rewards=inactive/);
  assert.match(status.out, /child_launches=inactive/);
  assert.match(status.out, /trest_public=retired/);
  assert.match(status.out, /builder=unregistered/);
  const divergent = presentCanonicalStatus({
    database: "ok",
    configMint: MINT,
    productionMint: OTHER,
    chain: "matched",
    rewardsActive: false,
    childLaunchesOpen: false,
  });
  assert.equal(divergent.code, 2);
  assert.match(divergent.out, /website=divergent/);
  assert.match(divergent.out, /builder=divergent/);
  const cli = readFileSync(new URL("../../services/transaction-builder/src/sdk-status-cli.ts", import.meta.url), "utf8");
  assert.equal(cli.includes("rewards-worker"), false);
  assert.equal(cli.includes("insert into"), false);
});

test("a single-recipient fee wallet must match the explicit deployer", () => {
  const decision = reviewCanonicalRegistration({
    request: { mint: MINT, deployer: DEPLOYER, feeRecipient: RECIPIENT, feeMode: "single_recipient", operator: OPERATOR },
    mintAccount: { owner: TOKEN_2022_PROGRAM, decimals: 6, initialized: true },
    observation: observation({ feeMode: "single_recipient" }),
    existing: { config: null, production: null },
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, "fee_recipient");
});
