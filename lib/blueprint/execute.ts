import { canonicalAddress } from "../auth/solana.ts";
import { PublicKey } from "@solana/web3.js";
import { exceedsDepth, withinOutputLimit } from "./json.ts";
import {
  MAX_HELIUS_REQUESTS,
  MAX_OPENAI_REQUESTS,
  MAX_OUTPUT_TOKENS,
  MAX_TEXT_CHARS,
  RUN_TOKEN_BUDGET,
  type Blueprint,
  type Ref,
  type ResponseSchema,
  type TransformStepAction,
} from "./model.ts";
import { isRef, readPath, refTarget } from "./refs.ts";
import { applyTransform } from "./transform.ts";

export type StepTrace = {
  stepId: string;
  status: "SUCCESS" | "FAILED";
  durationMs: number;
  providerRequests: number;
  errorCode?: string;
};

export type RunStatus = "SUCCESS" | "FAILED" | "TIMEOUT";

export type RunResult = {
  status: RunStatus;
  output?: Record<string, unknown>;
  errorCode?: string;
  traces: StepTrace[];
  openaiRequests: number;
  heliusRequests: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type EnginePorts = {
  now: () => number;
  openai: (call: {
    task: string;
    payload: unknown;
    schema: ResponseSchema;
    maxOutputTokens: number;
  }) => Promise<{ value: unknown; inputTokens: number; outputTokens: number; refusal?: boolean; truncated?: boolean }>;
  helius: (method: string, params: unknown[]) => Promise<unknown>;
};

export async function runBlueprint(input: {
  blueprint: Blueprint;
  values: Record<string, unknown>;
  ports: EnginePorts;
  startedAt: number;
}): Promise<RunResult> {
  const traces: StepTrace[] = [];
  const results = new Map<string, unknown>();
  let openaiRequests = 0;
  let heliusRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const deadline = input.startedAt + input.blueprint.limits.timeoutMs;

  for (const step of input.blueprint.steps) {
    if (input.ports.now() > deadline) {
      return finish("TIMEOUT", "timeout", input, traces, openaiRequests, heliusRequests, inputTokens, outputTokens);
    }
    const began = input.ports.now();
    try {
      const args = resolveArgs(step.args, input.values, results);
      let providerRequests = 0;
      let value: unknown;
      if (step.op === "ai.generate" || step.op === "ai.analyze") {
        if (openaiRequests >= MAX_OPENAI_REQUESTS) throw new RunFailure("provider_budget");
        if (inputTokens + outputTokens >= RUN_TOKEN_BUDGET) throw new RunFailure("token_budget");
        const response = await input.ports.openai({
          task: String(step.config.task),
          payload: clip(args),
          schema: step.config.responseSchema as ResponseSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
        providerRequests = 1;
        openaiRequests += 1;
        inputTokens += response.inputTokens;
        outputTokens += response.outputTokens;
        if (response.refusal) throw new RunFailure("model_refused");
        if (response.truncated) throw new RunFailure("model_truncated");
        if (!matchesSchema(response.value, step.config.responseSchema as ResponseSchema)) {
          throw new RunFailure("model_nonconforming");
        }
        value = response.value;
      } else if (step.op === "data.transform") {
        const transformed = applyTransform(args.data, step.config.actions as TransformStepAction[]);
        if (!transformed.ok) throw new RunFailure(transformed.code);
        value = transformed.value;
      } else {
        const solana = await runSolana(step.op, step.config, args, input.ports, () => {
          heliusRequests += 1;
          providerRequests += 1;
          if (heliusRequests > MAX_HELIUS_REQUESTS) throw new RunFailure("provider_budget");
        });
        value = solana;
      }
      if (exceedsDepth(value) || !withinOutputLimit(value, input.blueprint.limits.maxOutputBytes)) {
        throw new RunFailure("output_too_large");
      }
      results.set(step.id, value);
      traces.push({
        stepId: step.id,
        status: "SUCCESS",
        durationMs: Math.max(0, input.ports.now() - began),
        providerRequests,
      });
    } catch (error) {
      const code = failureCode(error);
      traces.push({
        stepId: step.id,
        status: "FAILED",
        durationMs: Math.max(0, input.ports.now() - began),
        providerRequests: 0,
        errorCode: code,
      });
      return finish(
        code === "timeout" ? "TIMEOUT" : "FAILED",
        code,
        input,
        traces,
        openaiRequests,
        heliusRequests,
        inputTokens,
        outputTokens,
      );
    }
  }

  const output: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(input.blueprint.outputs)) {
    const target = refTarget(spec.from.$ref);
    if (!target) return finish("FAILED", "reference", input, traces, openaiRequests, heliusRequests, inputTokens, outputTokens);
    const resolved = target.kind === "input" ? input.values[target.field] : readPath(results.get(target.stepId), target.path);
    if (resolved === undefined) {
      return finish("FAILED", "missing_output", input, traces, openaiRequests, heliusRequests, inputTokens, outputTokens);
    }
    output[key] = resolved;
  }
  if (!withinOutputLimit(output, input.blueprint.limits.maxOutputBytes)) {
    return finish("FAILED", "output_too_large", input, traces, openaiRequests, heliusRequests, inputTokens, outputTokens);
  }
  const result = finish("SUCCESS", undefined, input, traces, openaiRequests, heliusRequests, inputTokens, outputTokens);
  result.output = output;
  return result;
}

function failureCode(error: unknown): string {
  if (error instanceof RunFailure) return error.code;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (
    error instanceof Error &&
    (error.message === "provider" || error.message === "provider_unconfigured")
  ) {
    return error.message;
  }
  return "step_failed";
}

class RunFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function runSolana(
  op: Blueprint["steps"][number]["op"],
  config: Record<string, unknown>,
  args: Record<string, unknown>,
  ports: EnginePorts,
  count: () => void,
): Promise<unknown> {
  if (op === "solana.account") {
    const address = addressOf(args.address);
    if (config.mode === "balances") {
      const mint = canonicalAddress(typeof args.mint === "string" ? args.mint : "");
      if (mint) return readTokenBalance(address, mint, ports, count);
      count();
      const balance = await ports.helius("getBalance", [address]);
      count();
      const tokens = await ports.helius("getTokenAccountsByOwner", [
        address,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ]);
      const listed = boundTokenAccounts(tokens);
      return coverage("balances", {
        lamports: rpcValue(balance),
        tokens: listed.tokens,
        tokenAccountCount: listed.tokens.length,
        truncated: listed.truncated,
      });
    }
    count();
    const info = await ports.helius("getAccountInfo", [address, { encoding: "jsonParsed" }]);
    return coverage("account", { account: summarizeAccount(info) });
  }
  if (op === "solana.transactions") {
    if (config.mode === "detail") {
      const signature = stringOf(args.signature);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) throw new RunFailure("signature");
      count();
      const detail = await ports.helius("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
      return coverage("transaction", { transaction: summarizeTransaction(detail) });
    }
    const address = addressOf(args.address);
    const limit = typeof config.limit === "number" ? config.limit : 20;
    count();
    const recent = await ports.helius("getSignaturesForAddress", [address, { limit }]);
    const rows = Array.isArray(recent) ? recent.slice(0, limit) : [];
    return coverage("recent", {
      transactions: rows.slice(0, 100).map(summarizeSignature),
      truncated: rows.length >= limit,
    });
  }
  const balance = tokenBalanceArgs(args);
  if (balance) return readTokenBalance(balance.wallet, balance.mint, ports, count);
  const mint = addressOf(args.mint);
  if (config.mode === "supply") {
    count();
    const supply = await ports.helius("getTokenSupply", [mint]);
    return coverage("supply", { supply: rpcValue(supply) });
  }
  if (config.mode === "holders") {
    count();
    const holders = await ports.helius("getTokenLargestAccounts", [mint]);
    const value = rpcValue(holders);
    const sample = Array.isArray(value) ? value.slice(0, 20) : [];
    return {
      ...coverage("holders", { holders: sample }),
      coverage: {
        source: "getTokenLargestAccounts",
        sampleSize: sample.length,
        truncated: true,
        complete: false,
      },
    };
  }
  count();
  const mintInfo = await ports.helius("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  return coverage("mint", { mint: summarizeAccount(mintInfo) });
}

function coverage(source: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    coverage: {
      source,
      sampleSize: Array.isArray(body.transactions)
        ? body.transactions.length
        : Array.isArray(body.holders)
          ? body.holders.length
          : 1,
      truncated: body.truncated === true,
      complete: body.truncated !== true && source !== "holders",
    },
  };
}

function resolveArgs(
  args: Record<string, Ref | string | number | boolean>,
  inputs: Record<string, unknown>,
  results: Map<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!isRef(value)) {
      resolved[key] = value;
      continue;
    }
    const target = refTarget(value.$ref);
    if (!target) throw new RunFailure("reference");
    const found = target.kind === "input" ? inputs[target.field] : readPath(results.get(target.stepId), target.path);
    if (found === undefined) throw new RunFailure("missing_reference");
    resolved[key] = found;
  }
  return resolved;
}

function matchesSchema(value: unknown, schema: ResponseSchema): boolean {
  if (schema === "text_v1") return record(value) && typeof value.text === "string" && value.text.length <= MAX_TEXT_CHARS;
  if (schema === "analysis_v1") {
    return record(value) && typeof value.summary === "string" && Array.isArray(value.findings) && value.findings.every((item) => typeof item === "string");
  }
  if (schema === "prompt_result_v1") {
    return record(value) && typeof value.improved === "string" && Array.isArray(value.notes) && value.notes.every((item) => typeof item === "string");
  }
  if (!record(value)) return false;
  for (const key of schema.required) {
    const property = schema.properties[key];
    if (!property || typeof value[key] !== property.type) return false;
  }
  return Object.keys(value).every((key) => Object.hasOwn(schema.properties, key));
}

function clip(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= MAX_TEXT_CHARS) return value;
  return { truncated: true, preview: text.slice(0, 4_000) };
}

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function readTokenBalance(
  wallet: string,
  mint: string,
  ports: EnginePorts,
  count: () => void,
): Promise<Record<string, unknown>> {
  count();
  const listed = await ports.helius("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
  let accounts = parseTokenAccounts(listed);
  let complete = true;
  if (accounts.length === 0) {
    complete = false;
    for (const program of [TOKEN_2022, SPL_TOKEN]) {
      count();
      const ata = associatedTokenAddress(wallet, mint, program);
      const info = await ports.helius("getAccountInfo", [ata, { encoding: "jsonParsed" }]);
      const parsed = parseTokenAccount({ pubkey: ata, account: rpcValue(info) });
      if (parsed) {
        accounts = [parsed];
        break;
      }
    }
  }
  const sample = accounts.slice(0, 20);
  const decimals = sample.find((item) => item.decimals !== null)?.decimals ?? null;
  const total = sample.reduce((sum, item) => sum + rawAmount(item.amount), BigInt(0));
  const formatted = formatAmount(total, decimals);
  return {
    wallet,
    mint,
    found: sample.length > 0,
    amount: formatted.amount,
    decimals,
    uiAmount: formatted.uiAmount ?? (total === BigInt(0) ? "0" : null),
    accounts: sample,
    coverage: {
      source: "getTokenAccountsByOwner",
      sampleSize: sample.length,
      truncated: accounts.length > 20,
      complete: complete && accounts.length <= 20,
    },
  };
}

function tokenBalanceArgs(args: Record<string, unknown>): { wallet: string; mint: string } | null {
  const wallet = firstAddress(args.address, args.wallet, nestedAddress(args.mint, "wallet"), nestedAddress(args.mint, "address"));
  const mint = firstAddress(typeof args.mint === "string" ? args.mint : undefined, nestedAddress(args.mint, "mint"));
  if (!wallet || !mint || wallet === mint) return null;
  return { wallet, mint };
}

function firstAddress(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const address = canonicalAddress(value);
    if (address) return address;
  }
  return null;
}

function nestedAddress(value: unknown, key: string): unknown {
  if (!record(value)) return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  if (record(value.mint) && Object.hasOwn(value.mint, key)) return value.mint[key];
  return undefined;
}

function parseTokenAccounts(value: unknown): Array<{ pubkey: string | null; amount: string; decimals: number | null; uiAmount: string | null }> {
  const result = rpcValue(value);
  const rows = Array.isArray(result) ? result : [];
  return rows.flatMap((item) => {
    const parsed = parseTokenAccount(item);
    return parsed ? [parsed] : [];
  });
}

function parseTokenAccount(value: unknown): { pubkey: string | null; amount: string; decimals: number | null; uiAmount: string | null } | null {
  if (!record(value)) return null;
  const account = record(value.account) ? value.account : value;
  const summary = summarizeAccount(account);
  if (!record(summary) || typeof summary.amount !== "string") return null;
  return {
    pubkey: text(value.pubkey),
    amount: summary.amount,
    decimals: typeof summary.decimals === "number" ? summary.decimals : null,
    uiAmount: typeof summary.uiAmount === "string" ? summary.uiAmount : null,
  };
}

function rawAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
}

function formatAmount(raw: bigint, decimals: number | null): { amount: string; uiAmount: string | null } {
  const amount = raw.toString();
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return { amount, uiAmount: null };
  }
  const negative = raw < BigInt(0);
  const value = negative ? -raw : raw;
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const rendered = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return { amount, uiAmount: negative ? `-${rendered}` : rendered };
}

function associatedTokenAddress(owner: string, mint: string, program: PublicKey): string {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), program.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM,
  );
  return address.toBase58();
}

function addressOf(value: unknown): string {
  if (typeof value !== "string") throw new RunFailure("address");
  const address = canonicalAddress(value);
  if (!address) throw new RunFailure("address");
  return address;
}

function stringOf(value: unknown): string {
  if (typeof value !== "string") throw new RunFailure("signature");
  return value;
}

function rpcValue(value: unknown): unknown {
  if (!record(value)) return value;
  if ("error" in value) throw new RunFailure("provider");
  const body = "result" in value ? value.result : value;
  if (record(body) && "value" in body) return body.value;
  return body;
}

function summarizeAccount(value: unknown): unknown {
  const account = rpcValue(value);
  if (!record(account)) return null;
  const parsed = record(account.data) ? account.data.parsed : null;
  const info = record(parsed) && record(parsed.info) ? parsed.info : null;
  const amount = info && record(info.tokenAmount) ? info.tokenAmount : null;
  const metadata = tokenMetadata(info);
  return {
    lamports: typeof account.lamports === "number" ? account.lamports : null,
    owner: text(account.owner),
    executable: typeof account.executable === "boolean" ? account.executable : null,
    type: record(parsed) ? text(parsed.type) : null,
    decimals: finiteNumber(info?.decimals ?? amount?.decimals),
    supply: text(info?.supply),
    amount: text(amount?.amount),
    uiAmount: text(amount?.uiAmountString),
    mint: text(info?.mint),
    tokenOwner: text(info?.owner),
    state: text(info?.state),
    mintAuthority: text(info?.mintAuthority),
    freezeAuthority: text(info?.freezeAuthority),
    name: metadata.name,
    symbol: metadata.symbol,
  };
}

function tokenMetadata(info: Record<string, unknown> | null): { name: string | null; symbol: string | null } {
  const extensions = info && Array.isArray(info.extensions) ? info.extensions : [];
  for (const extension of extensions) {
    if (!record(extension) || !record(extension.state)) continue;
    const name = text(extension.state.name);
    const symbol = text(extension.state.symbol);
    if (name || symbol) return { name, symbol };
  }
  return { name: null, symbol: null };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 200) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeSignature(value: unknown): unknown {
  if (!record(value)) return {};
  return {
    signature: value.signature ?? null,
    slot: value.slot ?? null,
    err: value.err ?? null,
    blockTime: value.blockTime ?? null,
  };
}

function transactionVersion(value: unknown): "legacy" | 0 | 1 | null {
  if (value === "legacy" || value === 0 || value === 1) return value;
  return null;
}

function summarizeTransaction(value: unknown): unknown {
  const transaction = rpcValue(value);
  if (!record(transaction) || !record(transaction.meta)) return { found: false };
  return {
    found: true,
    version: transactionVersion(transaction.version),
    slot: transaction.slot ?? null,
    blockTime: transaction.blockTime ?? null,
    fee: transaction.meta.fee ?? null,
    err: transaction.meta.err ?? null,
  };
}

function boundTokenAccounts(value: unknown): { tokens: unknown[]; truncated: boolean } {
  const result = rpcValue(value);
  const rows = Array.isArray(result) ? result : [];
  return {
    truncated: rows.length > 20,
    tokens: rows.slice(0, 20).map((item) => {
      if (!record(item)) return {};
      return { pubkey: item.pubkey ?? null };
    }),
  };
}

function finish(
  status: RunStatus,
  errorCode: string | undefined,
  input: { ports: EnginePorts; startedAt: number },
  traces: StepTrace[],
  openaiRequests: number,
  heliusRequests: number,
  inputTokens: number,
  outputTokens: number,
): RunResult {
  const result: RunResult = {
    status,
    traces,
    openaiRequests,
    heliusRequests,
    inputTokens,
    outputTokens,
    durationMs: Math.max(0, input.ports.now() - input.startedAt),
  };
  if (errorCode) result.errorCode = errorCode;
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
