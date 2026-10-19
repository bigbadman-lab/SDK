import "server-only";

import { readOptionalEnv } from "@/lib/server/env";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  PROVIDER_DEADLINE_MS,
  type ResponseSchema,
} from "@/lib/blueprint/model";

export async function openAiStructured(call: {
  task: string;
  payload: unknown;
  schema: ResponseSchema;
  maxOutputTokens: number;
}): Promise<{
  value: unknown;
  inputTokens: number;
  outputTokens: number;
  refusal?: boolean;
  truncated?: boolean;
}> {
  const key = readOptionalEnv("OPENAI_API_KEY");
  if (!key) throw new Error("provider_unconfigured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      temperature: 0.2,
      max_tokens: Math.min(call.maxOutputTokens, MAX_OUTPUT_TOKENS),
      messages: [
        {
          role: "system",
          content:
            "Use only the supplied evidence. Do not invent chain facts, balances, or transaction history. If evidence is missing, say so in the structured result.",
        },
        {
          role: "user",
          content: JSON.stringify({ task: call.task, evidence: call.payload }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName(call.schema),
          strict: true,
          schema: jsonSchema(call.schema),
        },
      },
    }),
  });
  if (!response.ok) throw new Error("provider");
  const body = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; refusal?: string };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = body.choices?.[0];
  if (choice?.message?.refusal) {
    return { value: {}, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0, refusal: true };
  }
  if (choice?.finish_reason === "length") {
    return { value: {}, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0, truncated: true };
  }
  const content = choice?.message?.content;
  if (!content) throw new Error("provider");
  try {
    return {
      value: JSON.parse(content) as unknown,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  } catch {
    throw new Error("provider");
  }
}

export async function openAiProposal(history: Array<{ role: "user" | "assistant"; content: string }>): Promise<unknown> {
  const key = readOptionalEnv("OPENAI_API_KEY");
  if (!key) throw new Error("provider_unconfigured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      temperature: 0.2,
      max_tokens: 2_000,
      messages: [
        {
          role: "system",
          content:
            "Design one private SDK Blueprint using only ai.generate, ai.analyze, solana.account, solana.transactions, solana.token, and data.transform. Use at most 5 steps. Ids, input keys, output keys, argument keys, and fields are lowercase snake_case. References are inputs.<key> or steps.<earlier_id>.result. Solana account arguments use the key address, token arguments use mint, and transform arguments use data. A wallet's balance of one token passes that wallet as address and the mint as mint on the same step. Do not pass a previous step's whole result as a mint. When a current blueprint is included, revise that blueprint and keep every input and step the request does not change. If the request needs trading, secrets, loops, or a seventh operation, explain that in reply and still return the closest valid read-only Blueprint. Never ask for or include API keys.",
        },
        ...history.map((message) => ({ role: message.role, content: message.content.slice(0, 8_000) })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "blueprint_proposal",
          strict: true,
          schema: proposalSchema(),
        },
      },
    }),
  });
  if (!response.ok) throw new Error("provider");
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; refusal?: string } }>;
  };
  if (body.choices?.[0]?.message?.refusal) throw new Error("model_refused");
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("provider");
  return JSON.parse(content) as unknown;
}

export async function heliusRpc(method: string, params: unknown[]): Promise<unknown> {
  const rpcUrl = readOptionalEnv("HELIUS_RPC_URL");
  if (!rpcUrl) throw new Error("provider_unconfigured");
  const response = await fetch(rpcUrl, {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("provider");
  const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
  if (body.error) throw new Error("provider");
  return body.result ?? null;
}

function schemaName(schema: ResponseSchema): string {
  return typeof schema === "string" ? schema : "declared_object";
}

function jsonSchema(schema: ResponseSchema): Record<string, unknown> {
  if (schema === "text_v1") {
    return objectSchema({ text: { type: "string" } }, ["text"]);
  }
  if (schema === "analysis_v1") {
    return objectSchema(
      { summary: { type: "string" }, findings: { type: "array", items: { type: "string" } } },
      ["summary", "findings"],
    );
  }
  if (schema === "prompt_result_v1") {
    return objectSchema(
      { improved: { type: "string" }, notes: { type: "array", items: { type: "string" } } },
      ["improved", "notes"],
    );
  }
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, property]) => [key, { type: property.type }]),
  );
  return objectSchema(properties, schema.required);
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function proposalSchema(): Record<string, unknown> {
  const argument = objectSchema(
    { key: { type: "string" }, ref: { type: "string" } },
    ["key", "ref"],
  );
  const input = objectSchema(
    {
      key: { type: "string" },
      type: { type: "string", enum: ["string", "number", "boolean", "enum", "solanaAddress"] },
      required: { type: "boolean" },
      enumValues: { type: "array", items: { type: "string" } },
    },
    ["key", "type", "required", "enumValues"],
  );
  const step = objectSchema(
    {
      id: { type: "string" },
      op: { type: "string", enum: ["ai.generate", "ai.analyze", "solana.account", "solana.transactions", "solana.token", "data.transform"] },
      mode: { type: "string" },
      task: { type: "string" },
      args: { type: "array", items: argument },
      fields: { type: "array", items: { type: "string" } },
    },
    ["id", "op", "mode", "task", "args", "fields"],
  );
  return objectSchema(
    {
      reply: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      outputKey: { type: "string" },
      inputs: { type: "array", items: input },
      steps: { type: "array", items: step },
    },
    ["reply", "name", "description", "outputKey", "inputs", "steps"],
  );
}
