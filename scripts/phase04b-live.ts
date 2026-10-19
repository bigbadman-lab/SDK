import { readFileSync } from "node:fs";

import { runBlueprint } from "../lib/blueprint/execute.ts";
import type { ResponseSchema } from "../lib/blueprint/model.ts";
import { OFFICIAL_SDKS } from "../lib/library/official.ts";

const model = "gpt-4.1-mini";

function envValue(name: string): string | undefined {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0 || trimmed.slice(0, separator).trim() !== name) continue;
    const raw = trimmed.slice(separator + 1).trim();
    if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
}

function jsonSchema(schema: ResponseSchema): Record<string, unknown> {
  if (schema === "text_v1") return objectSchema({ text: { type: "string" } }, ["text"]);
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
  return objectSchema(
    Object.fromEntries(Object.entries(schema.properties).map(([key, property]) => [key, { type: property.type }])),
    schema.required,
  );
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

async function openai(call: { task: string; payload: unknown; schema: ResponseSchema; maxOutputTokens: number }) {
  const key = envValue("OPENAI_API_KEY");
  if (!key) throw new Error("missing_openai");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: call.maxOutputTokens,
      messages: [
        {
          role: "system",
          content:
            "Use only the supplied evidence. Do not invent chain facts, balances, or transaction history. If evidence is missing, say so in the structured result.",
        },
        { role: "user", content: JSON.stringify({ task: call.task, evidence: call.payload }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: typeof call.schema === "string" ? call.schema : "declared_object", strict: true, schema: jsonSchema(call.schema) },
      },
    }),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const body = (await response.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string } }>;
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
  if (!content) throw new Error("openai_empty");
  return {
    value: JSON.parse(content) as unknown,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

async function helius(method: string, params: unknown[]): Promise<unknown> {
  const rpcUrl = envValue("HELIUS_RPC_URL");
  if (!rpcUrl) throw new Error("missing_helius");
  const response = await fetch(rpcUrl, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`helius_http_${response.status}`);
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (body.error) throw new Error("helius_error");
  return body.result ?? null;
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  return text.slice(0, 160).replace(/\s+/g, " ");
}

const selected = process.argv.slice(2);
const sdks = selected.length === 0 ? OFFICIAL_SDKS : OFFICIAL_SDKS.filter((sdk) => selected.includes(sdk.name));

for (const sdk of sdks) {
  const started = Date.now();
  try {
    const result = await runBlueprint({
      blueprint: sdk.blueprint,
      values: sdk.sample,
      startedAt: started,
      ports: { now: () => Date.now(), openai, helius },
    });
    console.log(
      [
        sdk.name,
        result.status,
        `${result.durationMs}ms`,
        result.errorCode ?? "-",
        `openai:${result.openaiRequests}`,
        `helius:${result.heliusRequests}`,
        `keys:${result.output ? Object.keys(result.output).join(",") : "-"}`,
        preview(result.output),
      ].join(" | "),
    );
    const output = result.output;
    if (output && typeof output === "object") {
      for (const [key, value] of Object.entries(output)) {
        if (key === "activity" || key === "balances" || key === "mint") continue;
        const text = JSON.stringify(value) ?? "";
        console.log(`  ${sdk.name} ${key}: ${text.slice(0, 500).replace(/\s+/g, " ")}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "run_failed";
    console.log([sdk.name, "FAILED", `${Date.now() - started}ms`, message.split(" ")[0] ?? "run_failed"].join(" | "));
  }
}
