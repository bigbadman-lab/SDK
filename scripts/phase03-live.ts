import { readFileSync } from "node:fs";
import { runBlueprint } from "../lib/blueprint/execute.ts";
import type { Blueprint, ResponseSchema } from "../lib/blueprint/model.ts";

const model = "gpt-4.1-mini";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const systemProgram = "11111111111111111111111111111111";

function envValue(name: string): string | undefined {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0 || trimmed.slice(0, separator).trim() !== name) continue;
    const raw = trimmed.slice(separator + 1).trim();
    if (
      (raw.startsWith("\"") && raw.endsWith("\"")) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
}

function blueprint(step: Blueprint["steps"][number], input: Blueprint["inputs"]): Blueprint {
  return {
    schemaVersion: "1.0",
    name: "Live check",
    description: "One bounded provider call.",
    inputs: input,
    steps: [step],
    outputs: { result: { type: "object", from: { $ref: `steps.${step.id}.result` } } },
    limits: { timeoutMs: 60000, maxOutputBytes: 131072 },
    capabilities: [step.op],
  };
}

async function openAi(task: string, payload: unknown, _schema: ResponseSchema) {
  const key = envValue("OPENAI_API_KEY");
  if (!key) throw new Error("missing_openai");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: "system", content: "Return only the structured result." },
        { role: "user", content: JSON.stringify({ task, evidence: payload }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "text_v1",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai_empty");
  return {
    value: JSON.parse(content) as unknown,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

async function helius(method: string, params: unknown[]) {
  const rpcUrl = envValue("HELIUS_RPC_URL");
  if (!rpcUrl) throw new Error("missing_helius");
  const response = await fetch(rpcUrl, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`helius_http_${response.status}`);
  const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
  if (body.error) throw new Error("provider");
  return body.result ?? null;
}

const missing = ["OPENAI_API_KEY", "HELIUS_RPC_URL"].filter((name) => !envValue(name));
if (missing.length > 0) {
  console.log(JSON.stringify({ missing }));
  process.exitCode = 2;
} else {
  const ai = await runBlueprint({
    startedAt: Date.now(),
    values: { prompt: "ready" },
    ports: { now: () => Date.now(), openai: (call) => openAi(call.task, call.payload, call.schema), helius },
    blueprint: blueprint(
      {
        id: "draft",
        op: "ai.generate",
        config: { task: "Repeat the supplied word.", responseSchema: "text_v1" },
        args: { text: { $ref: "inputs.prompt" } },
      },
      { prompt: { type: "string", required: true, maxLength: 20 } },
    ),
  });
  const supply = await runBlueprint({
    startedAt: Date.now(),
    values: { mint: usdc },
    ports: { now: () => Date.now(), openai: (call) => openAi(call.task, call.payload, call.schema), helius },
    blueprint: blueprint(
      {
        id: "token",
        op: "solana.token",
        config: { mode: "supply" },
        args: { mint: { $ref: "inputs.mint" } },
      },
      { mint: { type: "solanaAddress", required: true } },
    ),
  });
  const failure = await runBlueprint({
    startedAt: Date.now(),
    values: { mint: systemProgram },
    ports: { now: () => Date.now(), openai: (call) => openAi(call.task, call.payload, call.schema), helius },
    blueprint: blueprint(
      {
        id: "token",
        op: "solana.token",
        config: { mode: "supply" },
        args: { mint: { $ref: "inputs.mint" } },
      },
      { mint: { type: "solanaAddress", required: true } },
    ),
  });
  const supplyResult = supply.output?.result;
  const amount =
    typeof supplyResult === "object" && supplyResult !== null && "supply" in supplyResult
      ? supplyResult.supply
      : null;
  const supplyAmount =
    typeof amount === "object" && amount !== null && "amount" in amount ? amount.amount : null;
  console.log(
    JSON.stringify({
      ai: {
        status: ai.status,
        model,
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        errorCode: ai.errorCode ?? null,
      },
      helius: { status: supply.status, supplyAmount, errorCode: supply.errorCode ?? null },
      providerFailure: { status: failure.status, errorCode: failure.errorCode ?? null },
    }),
  );
}
