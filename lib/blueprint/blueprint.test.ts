import assert from "node:assert/strict";
import test from "node:test";
import { compileProposal, revisionTurns } from "./compile.ts";
import { runBlueprint } from "./execute.ts";
import type { Blueprint } from "./model.ts";
import { applyTransform } from "./transform.ts";
import { validateBlueprint, validateInputsAgainst } from "./validate.ts";

const base = (): Blueprint => ({
  schemaVersion: "1.0",
  name: "Prompt architect",
  description: "Improve a prompt from supplied text.",
  inputs: { prompt: { type: "string", required: true, maxLength: 1000 } },
  steps: [
    {
      id: "draft",
      op: "ai.generate",
      config: { task: "Rewrite the prompt", responseSchema: "text_v1" },
      args: { text: { $ref: "inputs.prompt" } },
    },
  ],
  outputs: { result: { type: "object", from: { $ref: "steps.draft.result" } } },
  limits: { timeoutMs: 60000, maxOutputBytes: 131072 },
  capabilities: ["ai.generate"],
});

test("a follow-up request revises the current blueprint", () => {
  const first = revisionTurns([], "Summarize a wallet.", null);
  assert.deepEqual(first, [{ role: "user", content: "Summarize a wallet." }]);
  const followUp = revisionTurns(
    [
      { role: "user", content: "Summarize a wallet." },
      { role: "assistant", content: "Ready." },
    ],
    "Add the token symbol.",
    base(),
  );
  assert.equal(followUp.at(-1)?.content, "Add the token symbol.");
  const attached = followUp.find((turn) => turn.content.startsWith("Current blueprint to revise:"));
  assert.equal(attached?.role, "user");
  assert.match(attached?.content ?? "", /Prompt architect/);
  assert.match(attached?.content ?? "", /inputs\.prompt/);
});

test("validator accepts a five-step blueprint and rejects a sixth", () => {
  const blueprint = base();
  assert.equal(validateBlueprint(blueprint).ok, true);
  blueprint.steps = Array.from({ length: 6 }, (_, index) => ({
    id: `step_${index}`,
    op: "data.transform",
    config: { actions: [{ action: "select", fields: ["text"] }] },
    args: { data: { $ref: "inputs.prompt" } },
  }));
  blueprint.capabilities = ["data.transform"];
  const invalid = validateBlueprint(blueprint);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.issues.some((issue) => issue.code === "too_many_steps"), true);
});

test("validator rejects unknown operations, forward refs, and transform actions", () => {
  const extra = base();
  extra.steps[0] = { ...extra.steps[0]!, op: "shell.run" as "ai.generate" };
  const extraResult = validateBlueprint(extra);
  assert.equal(extraResult.ok, false);
  const forward = base();
  forward.steps = [
    {
      id: "first",
      op: "ai.generate",
      config: { task: "Use a later step", responseSchema: "text_v1" },
      args: { text: { $ref: "steps.later.result" } },
    },
    {
      id: "later",
      op: "ai.generate",
      config: { task: "Later", responseSchema: "text_v1" },
      args: { text: { $ref: "inputs.prompt" } },
    },
  ];
  forward.capabilities = ["ai.generate"];
  const forwardResult = validateBlueprint(forward);
  assert.equal(forwardResult.ok, false);
  if (!forwardResult.ok) {
    assert.equal(forwardResult.issues.some((issue) => issue.code === "forward_reference"), true);
  }
  const self = base();
  self.steps[0] = {
    ...self.steps[0]!,
    args: { text: { $ref: "steps.draft.result" } },
  };
  const selfResult = validateBlueprint(self);
  assert.equal(selfResult.ok, false);
  if (!selfResult.ok) assert.equal(selfResult.issues.some((issue) => issue.code === "self_reference"), true);
  const transform = base();
  transform.capabilities = ["data.transform"];
  transform.steps = [
    {
      id: "shape",
      op: "data.transform",
      config: { actions: [{ action: "eval", fields: ["text"] }] },
      args: { data: { $ref: "inputs.prompt" } },
    },
  ];
  const transformResult = validateBlueprint(transform);
  assert.equal(transformResult.ok, false);
  if (!transformResult.ok) {
    assert.equal(transformResult.issues.some((issue) => issue.code === "transform_action"), true);
  }
});

test("inputs reject a malformed address, an oversized payload, and a bad schema", () => {
  const blueprint = base();
  blueprint.inputs = { wallet: { type: "solanaAddress", required: true } };
  const address = validateInputsAgainst(blueprint, { wallet: "not-an-address" });
  assert.equal(address.ok, false);
  const oversized = validateInputsAgainst(base(), { prompt: "x".repeat(200_000) });
  assert.equal(oversized.ok, false);
  const schema = base();
  schema.steps[0] = {
    ...schema.steps[0]!,
    config: { task: "Bad schema", responseSchema: { type: "code", properties: {}, required: [] } },
  };
  const schemaResult = validateBlueprint(schema);
  assert.equal(schemaResult.ok, false);
});

test("quota reservation stops at the locked daily counts", () => {
  assert.equal(reserve(9, 10), 10);
  assert.equal(reserve(10, 10), null);
  assert.equal(reserve(19, 20), 20);
  assert.equal(reserve(20, 20), null);
});

test("the shared engine runs each operation family through injected ports", async () => {
  const now = { value: 0 };
  const ports = {
    now: () => now.value,
    openai: async () => ({ value: { text: "clearer prompt", summary: "ok", findings: ["one"], improved: "better", notes: ["n"] }, inputTokens: 10, outputTokens: 5 }),
    helius: async (method: string) => {
      if (method === "getBalance") return { value: 5 };
      if (method === "getTokenAccountsByOwner") return { value: [] };
      if (method === "getAccountInfo") return { value: { lamports: 1, owner: "11111111111111111111111111111111", executable: false } };
      if (method === "getSignaturesForAddress") return [{ signature: "sig", slot: 1, err: null, blockTime: 1 }];
      if (method === "getTransaction") return { meta: { fee: 5000, err: null }, slot: 2, blockTime: 3 };
      if (method === "getTokenSupply") return { value: { amount: "1", decimals: 6 } };
      if (method === "getTokenLargestAccounts") return { value: [{ address: "holder", amount: "1" }] };
      throw new Error(method);
    },
  };
  const ai = await runBlueprint({ blueprint: base(), values: { prompt: "hello" }, ports, startedAt: 0 });
  assert.equal(ai.status, "SUCCESS");
  assert.equal(ai.openaiRequests, 1);
  const account = base();
  account.inputs = { wallet: { type: "solanaAddress", required: true } };
  account.capabilities = ["solana.account"];
  account.outputs = { result: { type: "object", from: { $ref: "steps.lookup.result" } } };
  account.steps = [{ id: "lookup", op: "solana.account", config: { mode: "balances" }, args: { address: { $ref: "inputs.wallet" } } }];
  const address = "So11111111111111111111111111111111111111112";
  const balances = await runBlueprint({ blueprint: account, values: { wallet: address }, ports, startedAt: 0 });
  assert.equal(balances.status, "SUCCESS");
  assert.equal(balances.heliusRequests, 2);
  account.steps = [{ id: "lookup", op: "solana.account", config: { mode: "account" }, args: { address: { $ref: "inputs.wallet" } } }];
  assert.equal((await runBlueprint({ blueprint: account, values: { wallet: address }, ports, startedAt: 0 })).status, "SUCCESS");
  const activity = base();
  activity.inputs = { wallet: { type: "solanaAddress", required: true }, signature: { type: "string", required: true, maxLength: 100 } };
  activity.capabilities = ["solana.transactions"];
  activity.outputs = { result: { type: "object", from: { $ref: "steps.recent.result" } } };
  activity.steps = [{ id: "recent", op: "solana.transactions", config: { mode: "recent", limit: 5 }, args: { address: { $ref: "inputs.wallet" } } }];
  assert.equal((await runBlueprint({ blueprint: activity, values: { wallet: address, signature: "5".repeat(88) }, ports, startedAt: 0 })).status, "SUCCESS");
  activity.steps = [{ id: "recent", op: "solana.transactions", config: { mode: "detail", limit: 1 }, args: { signature: { $ref: "inputs.signature" } } }];
  assert.equal((await runBlueprint({ blueprint: activity, values: { wallet: address, signature: "5".repeat(88) }, ports, startedAt: 0 })).status, "SUCCESS");
  const token = base();
  token.outputs = { result: { type: "object", from: { $ref: "steps.token.result" } } };
  token.inputs = { mint: { type: "solanaAddress", required: true } };
  token.capabilities = ["solana.token"];
  for (const mode of ["mint", "supply", "holders"] as const) {
    token.steps = [{ id: "token", op: "solana.token", config: { mode }, args: { mint: { $ref: "inputs.mint" } } }];
    const result = await runBlueprint({ blueprint: token, values: { mint: address }, ports, startedAt: 0 });
    assert.equal(result.status, "SUCCESS");
  }
  const analysis = base();
  analysis.steps = [
    {
      id: "draft",
      op: "ai.analyze",
      config: { task: "Summarize the prompt", responseSchema: "analysis_v1" },
      args: { text: { $ref: "inputs.prompt" } },
    },
  ];
  analysis.capabilities = ["ai.analyze"];
  assert.equal((await runBlueprint({ blueprint: analysis, values: { prompt: "hello" }, ports, startedAt: 0 })).status, "SUCCESS");
  const transform = base();
  transform.capabilities = ["data.transform"];
  transform.inputs = { rows: { type: "number", required: true } };
  transform.outputs = { result: { type: "object", from: { $ref: "steps.shape.result" } } };
  transform.steps = [
    {
      id: "shape",
      op: "data.transform",
      config: { actions: [{ action: "calculate", operator: "add", left: 2, right: 3, as: "total" }] },
      args: { data: { $ref: "inputs.rows" } },
    },
  ];
  const shaped = await runBlueprint({ blueprint: transform, values: { rows: 4 }, ports, startedAt: 0 });
  assert.equal(shaped.status, "SUCCESS");
  token.steps = [{ id: "token", op: "solana.token", config: { mode: "holders" }, args: { mint: { $ref: "inputs.mint" } } }];
  const holders = await runBlueprint({ blueprint: token, values: { mint: address }, ports, startedAt: 0 });
  const holderResult = holders.output?.result;
  assert.equal(
    typeof holderResult === "object" && holderResult !== null && "coverage" in holderResult
      ? (holderResult.coverage as { complete?: boolean }).complete
      : undefined,
    false,
  );
});

test("a deep token account is summarized instead of failing the output ceiling", async () => {
  const now = { value: 0 };
  const ports = {
    now: () => now.value,
    openai: async () => ({ value: { text: "unused" }, inputTokens: 1, outputTokens: 1 }),
    helius: async (): Promise<unknown> => ({
      value: {
        lamports: 1461600,
        owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        executable: false,
        data: {
          parsed: {
            info: {
              decimals: 6,
              supply: "1000",
              extensions: [
                {
                  extension: "tokenMetadata",
                  state: {
                    name: "SDK",
                    symbol: "SDK",
                    uri: "https://example.com/meta.json",
                    extra: { nested: { deeper: { raw: "x".repeat(200_000) } } },
                  },
                },
              ],
            },
            type: "mint",
          },
        },
      },
    }),
  };
  const token = base();
  token.outputs = { result: { type: "object", from: { $ref: "steps.fetch_token_account.result" } } };
  token.inputs = { mint: { type: "solanaAddress", required: true } };
  token.capabilities = ["solana.token"];
  token.steps = [
    {
      id: "fetch_token_account",
      op: "solana.token",
      config: { mode: "mint" },
      args: { mint: { $ref: "inputs.mint" } },
    },
  ];
  const result = await runBlueprint({
    blueprint: token,
    values: { mint: "So11111111111111111111111111111111111111112" },
    ports,
    startedAt: 0,
  });
  assert.equal(result.status, "SUCCESS");
  const body = result.output?.result;
  const mint =
    typeof body === "object" && body !== null && "mint" in body ? body.mint : null;
  assert.equal(typeof mint === "object" && mint !== null && "symbol" in mint ? mint.symbol : null, "SDK");
  assert.equal(JSON.stringify(body).includes("extensions"), false);
  token.steps = [
    {
      id: "fetch_token_account",
      op: "solana.token",
      config: { mode: "supply" },
      args: { mint: { $ref: "inputs.mint" } },
    },
  ];
  ports.helius = async () => ({ value: { amount: "9".repeat(200_000), decimals: 6 } });
  const oversized = await runBlueprint({
    blueprint: token,
    values: { mint: "So11111111111111111111111111111111111111112" },
    ports,
    startedAt: 0,
  });
  assert.equal(oversized.status, "FAILED");
  assert.equal(oversized.errorCode, "output_too_large");
});

test("a wallet and mint read that wallet's token balance", async () => {
  const wallet = "11111111111111111111111111111111";
  const mint = "So11111111111111111111111111111111111111112";
  const calls: string[] = [];
  const ports = {
    now: () => 0,
    openai: async () => ({ value: { text: "unused" }, inputTokens: 1, outputTokens: 1 }),
    helius: async (method: string) => {
      calls.push(method);
      if (method === "getTokenAccountsByOwner") {
        return {
          value: [
            {
              pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              account: {
                data: {
                  parsed: {
                    info: {
                      mint,
                      owner: wallet,
                      tokenAmount: { amount: "1500000", decimals: 6, uiAmountString: "1.5" },
                    },
                    type: "account",
                  },
                },
              },
            },
          ],
        };
      }
      return { value: null };
    },
  };
  const blueprint = base();
  blueprint.inputs = {
    token_mint: { type: "solanaAddress", required: true },
    wallet_address: { type: "solanaAddress", required: true },
  };
  blueprint.capabilities = ["solana.token"];
  blueprint.outputs = { token_balance: { type: "object", from: { $ref: "steps.get_token_balance.result" } } };
  blueprint.steps = [
    {
      id: "get_token_account",
      op: "solana.token",
      config: { mode: "mint" },
      args: { mint: { $ref: "inputs.token_mint" }, address: { $ref: "inputs.wallet_address" } },
    },
    {
      id: "get_token_balance",
      op: "solana.token",
      config: { mode: "mint" },
      args: { mint: { $ref: "steps.get_token_account.result" } },
    },
  ];
  const result = await runBlueprint({
    blueprint,
    values: { token_mint: mint, wallet_address: wallet },
    ports,
    startedAt: 0,
  });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.errorCode, undefined);
  const body = result.output?.token_balance;
  assert.equal(typeof body === "object" && body !== null && "amount" in body ? body.amount : null, "1500000");
  assert.equal(typeof body === "object" && body !== null && "uiAmount" in body ? body.uiAmount : null, "1.5");
  assert.deepEqual(calls, ["getTokenAccountsByOwner", "getTokenAccountsByOwner"]);
  const compiled = compileProposal({
    reply: "Balance.",
    name: "Token balance",
    description: "Read one wallet balance for one mint.",
    outputKey: "token_balance",
    inputs: [
      { key: "token_mint", type: "solanaAddress", required: true, enumValues: [] },
      { key: "wallet_address", type: "solanaAddress", required: true, enumValues: [] },
    ],
    steps: [
      {
        id: "get_token_account",
        op: "solana.token",
        mode: "mint",
        task: "Find the token account.",
        fields: [],
        args: [
          { key: "mint", ref: "inputs.token_mint" },
          { key: "address", ref: "inputs.wallet_address" },
        ],
      },
      {
        id: "get_token_balance",
        op: "solana.token",
        mode: "balance",
        task: "Read the balance.",
        fields: [],
        args: [{ key: "mint", ref: "steps.get_token_account.result" }],
      },
    ],
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.deepEqual(compiled.blueprint.steps[1]?.args.mint, { $ref: "inputs.token_mint" });
  assert.deepEqual(compiled.blueprint.steps[1]?.args.address, { $ref: "inputs.wallet_address" });
});

test("transforms stay local and reject unknown shapes", () => {
  const selected = applyTransform(
    [{ text: "a", extra: 1 }, { text: "a", extra: 1 }, { text: "b", extra: 2 }],
    [
      { action: "deduplicate", field: "text" },
      { action: "filter", field: "extra", operator: "gte", value: 1 },
      { action: "sort", field: "text", direction: "asc" },
      { action: "select", fields: ["text"] },
    ],
  );
  assert.equal(selected.ok, true);
  const counted = applyTransform([{ text: "a" }, { text: "b" }], [{ action: "aggregate", operator: "count" }]);
  assert.equal(counted.ok, true);
  if (counted.ok) assert.equal((counted.value as { count: number }).count, 2);
  const formatted = applyTransform([{ text: "a" }], [{ action: "format", template: "row {text}" }]);
  assert.equal(formatted.ok, true);
  const divided = applyTransform([{ value: 4 }], [
    { action: "calculate", operator: "div", left: { field: "value" }, right: 0, as: "total" },
  ]);
  assert.equal(divided.ok, true);
  if (divided.ok) assert.equal((divided.value as Array<{ total?: number }>)[0]?.total, undefined);
  assert.equal(applyTransform("nope", [{ action: "select", fields: ["text"] }]).ok, false);
  const wrapped = applyTransform({ summary: "observed" }, [{ action: "select", fields: ["summary"] }]);
  assert.equal(wrapped.ok, true);
  if (wrapped.ok) assert.deepEqual(wrapped.value, [{ summary: "observed" }]);
});

test("a failed provider does not become a successful run", async () => {
  const result = await runBlueprint({
    blueprint: base(),
    values: { prompt: "hello" },
    startedAt: 0,
    ports: {
      now: () => 0,
      openai: async () => {
        throw new Error("down");
      },
      helius: async () => null,
    },
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "step_failed");
  assert.equal(result.output, undefined);
  const provider = await runBlueprint({
    blueprint: base(),
    values: { prompt: "hello" },
    startedAt: 0,
    ports: {
      now: () => 0,
      openai: async () => {
        throw new Error("provider");
      },
      helius: async () => null,
    },
  });
  assert.equal(provider.status, "FAILED");
  assert.equal(provider.errorCode, "provider");
});

test("a camelCase model proposal is repaired into a valid blueprint", () => {
  const compiled = compileProposal({
    reply: "The draft reads recent activity and summarizes the supplied evidence.",
    name: "Wallet activity summary",
    description: "Summarize bounded recent activity for one wallet.",
    outputKey: "activitySummary",
    inputs: [{ key: "walletAddress", type: "solanaAddress", required: true, enumValues: [] }],
    steps: [
      {
        id: "fetch",
        op: "solana.transactions",
        mode: "read",
        task: "Read recent signatures.",
        fields: ["signature", "blockTime"],
        args: [
          { key: "address", ref: "inputs.walletAddress" },
          { key: "limit", ref: "5" },
        ],
      },
      {
        id: "analyze_observations",
        op: "ai.analyze",
        mode: "read",
        task: "Separate observations from the evidence.",
        fields: ["observations"],
        args: [{ key: "text", ref: "steps.fetch.transactions" }],
      },
      {
        id: "generate",
        op: "ai.generate",
        mode: "completion",
        task: "Write the summary.",
        fields: ["summary"],
        args: [{ key: "prompt", ref: "steps.analyze_observations.observations" }],
      },
    ],
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(validateBlueprint(compiled.blueprint).ok, true);
  assert.equal(compiled.blueprint.outputs.activity_summary?.from.$ref, "steps.generate.result");
  assert.deepEqual(compiled.blueprint.inputs.wallet_address, { type: "solanaAddress", required: true });
  assert.deepEqual(compiled.blueprint.steps[0]?.args.address, { $ref: "inputs.wallet_address" });
  assert.equal(compiled.blueprint.steps[0]?.args.limit, 5);
  assert.equal(compiled.blueprint.steps[0]?.config.limit, 5);
  assert.deepEqual(compiled.blueprint.steps[1]?.args.text, { $ref: "steps.fetch.result.transactions" });
  assert.deepEqual(compiled.blueprint.steps[2]?.args.prompt, { $ref: "steps.analyze_observations.result" });
  const extra = compileProposal({
    reply: "No.",
    name: "Extra",
    description: "A seventh operation is not part of the engine.",
    outputKey: "result",
    inputs: [],
    steps: [
      {
        id: "run",
        op: "shell.run",
        mode: "read",
        task: "Run code.",
        fields: [],
        args: [],
      },
    ],
  });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.code, "operation");
});

function reserve(current: number, limit: number): number | null {
  if (current >= limit) return null;
  return current + 1;
}
