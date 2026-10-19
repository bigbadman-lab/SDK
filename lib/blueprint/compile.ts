import {
  IDENTIFIER,
  OPERATIONS,
  type Blueprint,
  type Operation,
  type Ref,
  type TransformAction,
} from "./model.ts";
import { validateBlueprint } from "./validate.ts";

export type Proposal = {
  reply: string;
  name: string;
  description: string;
  outputKey: string;
  inputs: Array<{
    key: string;
    type: "string" | "number" | "boolean" | "enum" | "solanaAddress";
    required: boolean;
    enumValues: string[];
  }>;
  steps: Array<{
    id: string;
    op: Operation;
    mode: string;
    task: string;
    args: Array<{ key: string; ref: string }>;
    fields: string[];
  }>;
};

const TRANSFORMS = new Set<TransformAction>([
  "select",
  "filter",
  "sort",
  "aggregate",
  "deduplicate",
  "format",
  "calculate",
]);

const INPUT_TYPES = new Set(["string", "number", "boolean", "enum", "solanaAddress"]);

export function compileProposal(
  value: unknown,
): { ok: true; reply: string; blueprint: Blueprint } | { ok: false; code: string; path: string } {
  if (hasUnknownOperation(value)) return { ok: false, code: "operation", path: "steps" };
  if (!isProposal(value)) return { ok: false, code: "proposal", path: "" };
  const normalized = normalizeProposal(value);
  const last = normalized.steps.at(-1);
  if (!last) return { ok: false, code: "steps_empty", path: "steps" };
  const blueprint = {
    schemaVersion: "1.0" as const,
    name: clip(normalized.name, 80, "Private SDK"),
    description: clip(normalized.description, 500, "A private draft."),
    inputs: normalized.inputs,
    steps: normalized.steps.map((step) => ({
      id: step.id,
      op: step.op,
      config: configFor(step),
      args: step.args,
    })),
    outputs: {
      [normalized.outputKey]: {
        type: "object" as const,
        from: { $ref: `steps.${last.id}.result` },
      },
    },
    limits: { timeoutMs: 60000, maxOutputBytes: 131072 },
    capabilities: [...new Set(normalized.steps.map((step) => step.op))],
  };
  const validated = validateBlueprint(blueprint);
  if (!validated.ok) {
    const issue = validated.issues[0];
    return { ok: false, code: issue?.code ?? "blueprint", path: issue?.path ?? "" };
  }
  return { ok: true, reply: clip(value.reply, 2_000, "The draft was updated."), blueprint: validated.blueprint };
}

export function revisionTurns(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
  blueprint: Blueprint | null,
): Array<{ role: "user" | "assistant"; content: string }> {
  const turns = history.map((item) => ({ role: item.role, content: item.content }));
  if (blueprint) {
    turns.push({
      role: "user",
      content: `Current blueprint to revise:\n${JSON.stringify(compactDraft(blueprint))}`,
    });
  }
  turns.push({ role: "user", content: message });
  return turns;
}

function compactDraft(blueprint: Blueprint): {
  name: string;
  description: string;
  outputKey: string;
  inputs: Array<{ key: string; type: string; required: boolean; enumValues: string[] }>;
  steps: Array<{
    id: string;
    op: Operation;
    mode: string;
    task: string;
    args: Array<{ key: string; ref: string }>;
    fields: string[];
  }>;
} {
  return {
    name: blueprint.name,
    description: blueprint.description,
    outputKey: Object.keys(blueprint.outputs)[0] ?? "result",
    inputs: Object.entries(blueprint.inputs).map(([key, field]) => ({
      key,
      type: field.type,
      required: field.required,
      enumValues: field.type === "enum" ? field.values : [],
    })),
    steps: blueprint.steps.map((step) => ({
      id: step.id,
      op: step.op,
      mode: stepMode(step),
      task: stepTask(step),
      args: Object.entries(step.args).map(([key, value]) => ({
        key,
        ref: typeof value === "object" ? value.$ref : String(value),
      })),
      fields: stepFields(step),
    })),
  };
}

function stepMode(step: Blueprint["steps"][number]): string {
  if (typeof step.config.mode === "string") return step.config.mode;
  const action = firstAction(step);
  return action && typeof action.action === "string" ? action.action : "";
}

function stepTask(step: Blueprint["steps"][number]): string {
  return typeof step.config.task === "string" ? step.config.task : "";
}

function stepFields(step: Blueprint["steps"][number]): string[] {
  const action = firstAction(step);
  if (!action || !Array.isArray(action.fields)) return [];
  return action.fields.filter((field): field is string => typeof field === "string");
}

function firstAction(step: Blueprint["steps"][number]): { action?: unknown; fields?: unknown } | null {
  const actions = step.config.actions;
  if (!Array.isArray(actions)) return null;
  const action = actions[0];
  if (!action || typeof action !== "object") return null;
  return action as { action?: unknown; fields?: unknown };
}

function normalizeProposal(value: Proposal): {
  name: string;
  description: string;
  outputKey: string;
  inputs: Blueprint["inputs"];
  steps: Array<{
    id: string;
    op: Operation;
    mode: string;
    task: string;
    fields: string[];
    args: Blueprint["steps"][number]["args"];
  }>;
} {
  const usedInputs = new Set<string>();
  const inputIds = new Map<string, string>();
  const inputs: Blueprint["inputs"] = {};
  for (const input of value.inputs.slice(0, 8)) {
    if (!INPUT_TYPES.has(input.type)) continue;
    const id = uniqueIdentifier(input.key, usedInputs, "input");
    inputIds.set(input.key, id);
    inputIds.set(snake(input.key), id);
    if (input.type === "string") inputs[id] = { type: "string", required: input.required, maxLength: 4000 };
    else if (input.type === "number") inputs[id] = { type: "number", required: input.required };
    else if (input.type === "boolean") inputs[id] = { type: "boolean", required: input.required };
    else if (input.type === "enum") {
      const values = [...new Set(input.enumValues.map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 80))].slice(0, 20);
      if (values.length === 0) inputs[id] = { type: "string", required: input.required, maxLength: 4000 };
      else inputs[id] = { type: "enum", required: input.required, values };
    } else inputs[id] = { type: "solanaAddress", required: input.required };
  }

  const usedSteps = new Set<string>();
  const stepIds = new Map<string, string>();
  const selected = value.steps.slice(0, 5);
  for (const step of selected) {
    const id = uniqueIdentifier(step.id, usedSteps, "step");
    stepIds.set(step.id, id);
    stepIds.set(snake(step.id), id);
  }
  const stepOps = new Map(selected.map((step) => [stepIds.get(step.id) ?? step.id, step.op]));

  const steps = selected.map((step) => {
    const id = stepIds.get(step.id) ?? uniqueIdentifier(step.id, usedSteps, "step");
    const args: Blueprint["steps"][number]["args"] = {};
    for (const arg of step.args.slice(0, 8)) {
      const key = uniqueIdentifier(arg.key, new Set(Object.keys(args)), "arg");
      if (Object.hasOwn(args, key)) continue;
      const compiled = compileRef(arg.ref, inputIds, stepIds, stepOps);
      if (compiled !== null) args[key] = compiled;
    }
    alignArgs(step.op, step.mode, args);
    return {
      id,
      op: step.op,
      mode: step.mode,
      task: clip(step.task, 2_000, "Use the supplied evidence."),
      fields: uniqueFields(step.fields),
      args,
    };
  });

  repairTokenBalanceRefs(steps);

  const outputSource = value.outputKey.split(".").at(-1) ?? value.outputKey;
  const outputKey = IDENTIFIER.test(snake(outputSource)) ? snake(outputSource) : "result";
  return { name: value.name, description: value.description, outputKey, inputs, steps };
}

function repairTokenBalanceRefs(
  steps: Array<{ id: string; op: Operation; args: Blueprint["steps"][number]["args"] }>,
): void {
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const step of steps) {
    if (step.op !== "solana.token" && step.op !== "solana.account") continue;
    const mint = step.args.mint;
    if (mint === undefined || !isRefValue(mint)) continue;
    const sourceId = /^steps\.([a-z][a-z0-9_]{0,40})\.result$/.exec(mint.$ref)?.[1];
    if (!sourceId) continue;
    const source = byId.get(sourceId);
    const sourceMint = source?.args.mint;
    if (!source || sourceMint === undefined || !isRefValue(sourceMint)) continue;
    if (!/^inputs\.[a-z][a-z0-9_]{0,40}$/.test(sourceMint.$ref)) continue;
    step.args.mint = { $ref: sourceMint.$ref };
    const sourceAddress = source.args.address;
    if (!Object.hasOwn(step.args, "address") && sourceAddress !== undefined && isRefValue(sourceAddress)) {
      step.args.address = { $ref: sourceAddress.$ref };
    }
  }
}

function alignArgs(op: Operation, mode: string, args: Blueprint["steps"][number]["args"]): void {
  if (op === "data.transform") renameFirstRef(args, "data");
  if (op === "solana.account" || (op === "solana.transactions" && mode !== "detail")) renameFirstRef(args, "address");
  if (op === "solana.transactions" && mode === "detail") renameFirstRef(args, "signature");
  if (op === "solana.token") renameFirstRef(args, "mint");
}

function renameFirstRef(args: Blueprint["steps"][number]["args"], key: string): void {
  if (Object.hasOwn(args, key)) return;
  const found = Object.entries(args).find((entry) => isRefValue(entry[1]));
  if (!found) return;
  args[key] = found[1];
  delete args[found[0]];
}

function compileRef(
  ref: string,
  inputs: Map<string, string>,
  steps: Map<string, string>,
  stepOps: Map<string, Operation>,
): Ref | string | number | boolean | null {
  const trimmed = ref.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const number = Number(trimmed);
    return Number.isSafeInteger(number) ? number : null;
  }
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (trimmed.startsWith("inputs.")) {
    const key = inputs.get(trimmed.slice("inputs.".length));
    return key ? { $ref: `inputs.${key}` } : null;
  }
  if (trimmed.startsWith("steps.")) {
    const body = trimmed.slice("steps.".length);
    const dot = body.indexOf(".");
    const rawId = dot === -1 ? body : body.slice(0, dot);
    const id = steps.get(rawId) ?? steps.get(snake(rawId));
    if (!id) return null;
    let path = dot === -1 ? "" : body.slice(dot + 1);
    if (path === "result") path = "";
    else if (path.startsWith("result.")) path = path.slice("result.".length);
    const segments = path
      .split(".")
      .map((segment) => snake(segment))
      .filter((segment) => IDENTIFIER.test(segment));
    const allowed = allowedPath(stepOps.get(id));
    const kept = segments.length > 0 && allowed.has(segments[0] ?? "") ? `.${segments.join(".")}` : "";
    return { $ref: `steps.${id}.result${kept}` };
  }
  if (trimmed.length > 0 && trimmed.length <= 2_000) return trimmed;
  return null;
}

function allowedPath(op: Operation | undefined): Set<string> {
  if (op === "ai.generate") return new Set(["text"]);
  if (op === "ai.analyze") return new Set(["summary", "findings"]);
  if (op === "solana.account") return new Set(["lamports", "tokens", "account", "coverage"]);
  if (op === "solana.transactions") return new Set(["transactions", "transaction", "truncated", "coverage"]);
  if (op === "solana.token") return new Set(["supply", "holders", "mint", "coverage"]);
  return new Set();
}

function uniqueFields(fields: string[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const field of fields) {
    const id = snake(field);
    if (!IDENTIFIER.test(id) || used.has(id) || result.length >= 12) continue;
    used.add(id);
    result.push(id);
  }
  return result;
}

function uniqueIdentifier(value: string, used: Set<string>, fallback: string): string {
  const base = IDENTIFIER.test(snake(value)) ? snake(value) : fallback;
  let candidate = base;
  let count = 2;
  while (used.has(candidate) || !IDENTIFIER.test(candidate)) {
    const suffix = `_${count}`;
    candidate = `${base.slice(0, 41 - suffix.length)}${suffix}`;
    count += 1;
    if (count > 20) break;
  }
  used.add(candidate);
  return candidate;
}

function snake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 41);
}

function clip(value: string, max: number, fallback: string): string {
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

function configFor(step: {
  op: Operation;
  mode: string;
  task: string;
  fields: string[];
  args: Blueprint["steps"][number]["args"];
}): Blueprint["steps"][number]["config"] {
  if (step.op === "ai.generate" || step.op === "ai.analyze") {
    return {
      task: step.task,
      responseSchema: step.op === "ai.analyze" ? "analysis_v1" : "text_v1",
    };
  }
  if (step.op === "solana.account") {
    return { mode: step.mode === "balances" ? "balances" : "account" };
  }
  if (step.op === "solana.transactions") {
    const requested = step.args.limit;
    const limit =
      typeof requested === "number" && Number.isInteger(requested) && requested >= 1 && requested <= 100
        ? requested
        : 20;
    return { mode: step.mode === "detail" ? "detail" : "recent", limit };
  }
  if (step.op === "solana.token") {
    const mode = step.mode === "supply" || step.mode === "holders" ? step.mode : "mint";
    return { mode };
  }
  const action = TRANSFORMS.has(step.mode as TransformAction) ? (step.mode as TransformAction) : "select";
  if (action === "select") return { actions: [{ action, fields: step.fields.length > 0 ? step.fields : ["text"] }] };
  if (action === "filter") {
    return {
      actions: [{ action, field: step.fields[0] ?? "value", operator: "eq", value: step.task.slice(0, 200) || "true" }],
    };
  }
  if (action === "sort") {
    return { actions: [{ action, field: step.fields[0] ?? "value", direction: "asc" }] };
  }
  if (action === "aggregate") return { actions: [{ action, operator: "count" }] };
  if (action === "deduplicate") return { actions: [{ action }] };
  if (action === "format") return { actions: [{ action, template: step.task || "{text}" }] };
  return { actions: [{ action: "calculate", operator: "add", left: 1, right: 1, as: step.fields[0] ?? "total" }] };
}

function hasUnknownOperation(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.steps)) return false;
  return value.steps.some(
    (step) => record(step) && typeof step.op === "string" && !OPERATIONS.includes(step.op as Operation),
  );
}

function isProposal(value: unknown): value is Proposal {
  if (!record(value) || typeof value.reply !== "string" || typeof value.name !== "string") return false;
  if (typeof value.description !== "string" || typeof value.outputKey !== "string") return false;
  if (!Array.isArray(value.inputs) || !Array.isArray(value.steps)) return false;
  if (value.steps.length < 1) return false;
  return value.steps.every(
    (step) =>
      record(step) &&
      typeof step.id === "string" &&
      OPERATIONS.includes(step.op as Operation) &&
      typeof step.mode === "string" &&
      typeof step.task === "string" &&
      Array.isArray(step.args) &&
      Array.isArray(step.fields) &&
      step.args.every((arg) => record(arg) && typeof arg.key === "string" && typeof arg.ref === "string"),
  ) && value.inputs.every(
    (input) =>
      record(input) &&
      typeof input.key === "string" &&
      typeof input.type === "string" &&
      typeof input.required === "boolean" &&
      Array.isArray(input.enumValues),
  );
}

function isRefValue(value: Ref | string | number | boolean): value is Ref {
  return typeof value === "object" && value !== null && "$ref" in value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
