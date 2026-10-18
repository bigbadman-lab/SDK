import { canonicalAddress } from "../auth/solana.ts";
import { exceedsDepth, jsonByteLength } from "./json.ts";
import {
  IDENTIFIER,
  INPUT_TYPES,
  MAX_OUTPUT_BYTES,
  MAX_RUN_MS,
  MAX_STEPS,
  MAX_TEXT_CHARS,
  MAX_TRANSFORM_ACTIONS,
  OPERATIONS,
  REGISTERED_SCHEMAS,
  TRANSFORM_ACTIONS,
  type Blueprint,
  type CompareOperator,
  type DeclarativeSchema,
  type InputField,
  type Issue,
  type Operation,
  type ResponseSchema,
  type Step,
  type TransformStepAction,
} from "./model.ts";
import { isRef, refTarget } from "./refs.ts";

const COMPARES = ["eq", "neq", "gt", "lt", "gte", "lte", "contains"] as const;
const OUTPUT_TYPES = ["string", "number", "boolean", "object", "array"] as const;

export function validateBlueprint(
  value: unknown,
): { ok: true; blueprint: Blueprint } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!record(value)) return fail([{ path: "", code: "blueprint_type" }]);
  if (value.schemaVersion !== "1.0") issues.push({ path: "schemaVersion", code: "schema_version" });
  const name = boundedString(value.name, 1, 80);
  if (!name) issues.push({ path: "name", code: "name" });
  const description = boundedString(value.description, 1, 500);
  if (!description) issues.push({ path: "description", code: "description" });
  const inputs = validateInputs(value.inputs, issues);
  const steps = validateSteps(value.steps, inputs, issues);
  const outputs = validateOutputs(value.outputs, inputs, steps, issues);
  const limits = validateLimits(value.limits, issues);
  const capabilities = validateCapabilities(value.capabilities, steps, issues);
  if (issues.length > 0 || !name || !description || !inputs || !steps || !outputs || !limits || !capabilities) {
    return fail(issues);
  }
  return {
    ok: true,
    blueprint: {
      schemaVersion: "1.0",
      name,
      description,
      inputs,
      steps,
      outputs,
      limits,
      capabilities,
    },
  };
}

export function validateInputsAgainst(
  blueprint: Blueprint,
  raw: unknown,
): { ok: true; values: Record<string, unknown> } | { ok: false; issues: Issue[] } {
  if (!record(raw)) return fail([{ path: "inputs", code: "inputs_type" }]);
  if (jsonByteLength(raw) > MAX_OUTPUT_BYTES) {
    return fail([{ path: "inputs", code: "payload_too_large" }]);
  }
  if (exceedsDepth(raw)) return fail([{ path: "inputs", code: "payload_too_deep" }]);
  const issues: Issue[] = [];
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(blueprint.inputs, key)) issues.push({ path: `inputs.${key}`, code: "unknown_input" });
  }
  for (const [key, field] of Object.entries(blueprint.inputs)) {
    const present = Object.hasOwn(raw, key);
    const source = present ? raw[key] : field.default;
    if (source === undefined) {
      if (field.required) issues.push({ path: `inputs.${key}`, code: "required" });
      continue;
    }
    const parsed = parseInput(field, source);
    if (parsed === undefined) issues.push({ path: `inputs.${key}`, code: "input_type" });
    else values[key] = parsed;
  }
  return issues.length > 0 ? fail(issues) : { ok: true, values };
}

function validateInputs(
  value: unknown,
  issues: Issue[],
): Record<string, InputField> | null {
  if (!record(value)) {
    issues.push({ path: "inputs", code: "inputs_type" });
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length > 8) issues.push({ path: "inputs", code: "too_many_inputs" });
  const inputs: Record<string, InputField> = {};
  for (const key of keys) {
    if (!IDENTIFIER.test(key)) issues.push({ path: `inputs.${key}`, code: "identifier" });
    const field = inputField(value[key], `inputs.${key}`, issues);
    if (field) inputs[key] = field;
  }
  return inputs;
}

function inputField(value: unknown, path: string, issues: Issue[]): InputField | null {
  if (!record(value) || typeof value.type !== "string" || !INPUT_TYPES.includes(value.type as never)) {
    issues.push({ path, code: "input_type" });
    return null;
  }
  if (typeof value.required !== "boolean") issues.push({ path: `${path}.required`, code: "required_flag" });
  const required = value.required === true;
  if (value.type === "string") {
    const maxLength = numberIn(value.maxLength, 1, MAX_TEXT_CHARS) ?? MAX_TEXT_CHARS;
    if (value.maxLength !== undefined && numberIn(value.maxLength, 1, MAX_TEXT_CHARS) === null) {
      issues.push({ path: `${path}.maxLength`, code: "bound" });
    }
    const field: InputField = { type: "string", required, maxLength };
    if (value.default !== undefined) {
      if (typeof value.default !== "string" || value.default.length > maxLength) {
        issues.push({ path: `${path}.default`, code: "default" });
      } else field.default = value.default;
    }
    return field;
  }
  if (value.type === "number") {
    const field: InputField = { type: "number", required };
    const minimum = optionalNumber(value.minimum);
    const maximum = optionalNumber(value.maximum);
    if (value.minimum !== undefined && minimum === null) issues.push({ path: `${path}.minimum`, code: "bound" });
    if (value.maximum !== undefined && maximum === null) issues.push({ path: `${path}.maximum`, code: "bound" });
    if (typeof minimum === "number") field.minimum = minimum;
    if (typeof maximum === "number") field.maximum = maximum;
    if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) {
      issues.push({ path, code: "bound" });
    }
    if (value.default !== undefined) {
      if (typeof value.default !== "number" || !Number.isFinite(value.default)) {
        issues.push({ path: `${path}.default`, code: "default" });
      } else field.default = value.default;
    }
    return field;
  }
  if (value.type === "boolean") {
    const field: InputField = { type: "boolean", required };
    if (value.default !== undefined) {
      if (typeof value.default !== "boolean") issues.push({ path: `${path}.default`, code: "default" });
      else field.default = value.default;
    }
    return field;
  }
  if (value.type === "enum") {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 20) {
      issues.push({ path: `${path}.values`, code: "enum_values" });
      return null;
    }
    const values = value.values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80);
    if (values.length !== value.values.length || new Set(values).size !== values.length) {
      issues.push({ path: `${path}.values`, code: "enum_values" });
      return null;
    }
    const field: InputField = { type: "enum", required, values };
    if (value.default !== undefined) {
      if (typeof value.default !== "string" || !values.includes(value.default)) {
        issues.push({ path: `${path}.default`, code: "default" });
      } else field.default = value.default;
    }
    return field;
  }
  const field: InputField = { type: "solanaAddress", required };
  if (value.default !== undefined) {
    if (typeof value.default !== "string" || !canonicalAddress(value.default)) {
      issues.push({ path: `${path}.default`, code: "address" });
    } else field.default = canonicalAddress(value.default) ?? value.default;
  }
  return field;
}

function validateSteps(value: unknown, inputs: Record<string, InputField> | null, issues: Issue[]): Step[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: "steps", code: "steps_type" });
    return null;
  }
  if (value.length < 1) issues.push({ path: "steps", code: "steps_empty" });
  if (value.length > MAX_STEPS) issues.push({ path: "steps", code: "too_many_steps" });
  const steps: Step[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const path = `steps.${index}`;
    if (!record(item) || typeof item.id !== "string" || !IDENTIFIER.test(item.id)) {
      issues.push({ path: `${path}.id`, code: "identifier" });
      return;
    }
    if (seen.has(item.id)) issues.push({ path: `${path}.id`, code: "duplicate_step" });
    seen.add(item.id);
    if (!OPERATIONS.includes(item.op as Operation)) {
      issues.push({ path: `${path}.op`, code: "operation" });
      return;
    }
    const op = item.op as Operation;
    const args = validateArgs(item.args, `${path}.args`, inputs, steps, item.id, issues);
    const config = validateConfig(op, item.config, `${path}.config`, issues);
    if (args && config) steps.push({ id: item.id, op, config, args });
  });
  return steps;
}

function validateArgs(
  value: unknown,
  path: string,
  inputs: Record<string, InputField> | null,
  earlier: Step[],
  currentId: string,
  issues: Issue[],
): Step["args"] | null {
  if (!record(value)) {
    issues.push({ path, code: "args_type" });
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length > 8) issues.push({ path, code: "too_many_args" });
  const args: Step["args"] = {};
  for (const key of keys) {
    if (!IDENTIFIER.test(key)) issues.push({ path: `${path}.${key}`, code: "identifier" });
    const item = value[key];
    if (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      if (typeof item === "string" && item.length > 2_000) issues.push({ path: `${path}.${key}`, code: "arg_size" });
      else args[key] = item;
      continue;
    }
    if (!isRef(item)) {
      issues.push({ path: `${path}.${key}`, code: "arg_value" });
      continue;
    }
    const target = refTarget(item.$ref);
    if (!target) {
      issues.push({ path: `${path}.${key}`, code: "reference" });
      continue;
    }
    if (target.kind === "input") {
      if (!inputs || !Object.hasOwn(inputs, target.field)) {
        issues.push({ path: `${path}.${key}`, code: "unknown_input" });
      }
    } else if (target.stepId === currentId) {
      issues.push({ path: `${path}.${key}`, code: "self_reference" });
    } else if (!earlier.some((step) => step.id === target.stepId)) {
      issues.push({ path: `${path}.${key}`, code: "forward_reference" });
    }
    args[key] = { $ref: item.$ref };
  }
  return args;
}

function validateConfig(op: Operation, value: unknown, path: string, issues: Issue[]): Record<string, unknown> | null {
  if (!record(value)) {
    issues.push({ path, code: "config_type" });
    return null;
  }
  if (op === "ai.generate" || op === "ai.analyze") {
    const task = boundedString(value.task, 1, 2_000);
    if (!task) issues.push({ path: `${path}.task`, code: "task" });
    const schema = responseSchema(value.responseSchema, `${path}.responseSchema`, issues);
    if (!task || !schema) return null;
    return { task, responseSchema: schema };
  }
  if (op === "solana.account") {
    if (value.mode !== "account" && value.mode !== "balances") {
      issues.push({ path: `${path}.mode`, code: "mode" });
      return null;
    }
    return { mode: value.mode };
  }
  if (op === "solana.transactions") {
    if (value.mode !== "recent" && value.mode !== "detail") {
      issues.push({ path: `${path}.mode`, code: "mode" });
      return null;
    }
    const limit = value.limit === undefined ? 20 : numberIn(value.limit, 1, 100);
    if (limit === null) issues.push({ path: `${path}.limit`, code: "bound" });
    return limit === null ? null : { mode: value.mode, limit };
  }
  if (op === "solana.token") {
    if (value.mode !== "mint" && value.mode !== "supply" && value.mode !== "holders") {
      issues.push({ path: `${path}.mode`, code: "mode" });
      return null;
    }
    return { mode: value.mode };
  }
  if (!Array.isArray(value.actions)) {
    issues.push({ path: `${path}.actions`, code: "transform_actions" });
    return null;
  }
  if (value.actions.length < 1 || value.actions.length > MAX_TRANSFORM_ACTIONS) {
    issues.push({ path: `${path}.actions`, code: "transform_count" });
  }
  const actions: TransformStepAction[] = [];
  value.actions.forEach((action, index) => {
    const parsed = transformAction(action, `${path}.actions.${index}`, issues);
    if (parsed) actions.push(parsed);
  });
  return { actions };
}

function transformAction(value: unknown, path: string, issues: Issue[]): TransformStepAction | null {
  if (!record(value) || typeof value.action !== "string" || !TRANSFORM_ACTIONS.includes(value.action as never)) {
    issues.push({ path, code: "transform_action" });
    return null;
  }
  if (value.action === "select") {
    if (!stringList(value.fields, 1, 12)) {
      issues.push({ path: `${path}.fields`, code: "fields" });
      return null;
    }
    return { action: "select", fields: value.fields as string[] };
  }
  if (value.action === "filter") {
    if (typeof value.field !== "string" || !IDENTIFIER.test(value.field)) {
      issues.push({ path: `${path}.field`, code: "field" });
    }
    if (!COMPARES.includes(value.operator as CompareOperator)) {
      issues.push({ path: `${path}.operator`, code: "operator" });
    }
    if (!scalar(value.value) || (typeof value.value === "string" && value.value.length > 200)) {
      issues.push({ path: `${path}.value`, code: "filter_value" });
      return null;
    }
    if (typeof value.field !== "string") return null;
    return {
      action: "filter",
      field: value.field,
      operator: value.operator as CompareOperator,
      value: value.value as string | number | boolean,
    };
  }
  if (value.action === "sort") {
    if (typeof value.field !== "string" || (value.direction !== "asc" && value.direction !== "desc")) {
      issues.push({ path, code: "sort" });
      return null;
    }
    return { action: "sort", field: value.field, direction: value.direction };
  }
  if (value.action === "aggregate") {
    if (!["count", "sum", "min", "max"].includes(String(value.operator))) {
      issues.push({ path, code: "aggregate" });
      return null;
    }
    const action: TransformStepAction = {
      action: "aggregate",
      operator: value.operator as "count" | "sum" | "min" | "max",
    };
    if (value.field !== undefined) {
      if (typeof value.field !== "string") issues.push({ path: `${path}.field`, code: "field" });
      else action.field = value.field;
    }
    return action;
  }
  if (value.action === "deduplicate") {
    const action: TransformStepAction = { action: "deduplicate" };
    if (value.field !== undefined) {
      if (typeof value.field !== "string") issues.push({ path: `${path}.field`, code: "field" });
      else action.field = value.field;
    }
    return action;
  }
  if (value.action === "format") {
    if (typeof value.template !== "string" || value.template.length < 1 || value.template.length > 500) {
      issues.push({ path: `${path}.template`, code: "template" });
      return null;
    }
    if (/[{][^{}]*[^A-Za-z0-9_.{}]/.test(value.template)) {
      issues.push({ path: `${path}.template`, code: "template" });
    }
    return { action: "format", template: value.template };
  }
  if (!["add", "sub", "mul", "div"].includes(String(value.operator)) || typeof value.as !== "string" || !IDENTIFIER.test(value.as)) {
    issues.push({ path, code: "calculate" });
    return null;
  }
  const left = operand(value.left);
  const right = operand(value.right);
  if (!left || !right) {
    issues.push({ path, code: "calculate" });
    return null;
  }
  return {
    action: "calculate",
    operator: value.operator as "add" | "sub" | "mul" | "div",
    left,
    right,
    as: value.as,
  };
}

function validateOutputs(
  value: unknown,
  inputs: Record<string, InputField> | null,
  steps: Step[] | null,
  issues: Issue[],
): Blueprint["outputs"] | null {
  if (!record(value) || Object.keys(value).length < 1 || Object.keys(value).length > 8) {
    issues.push({ path: "outputs", code: "outputs" });
    return null;
  }
  const outputs: Blueprint["outputs"] = {};
  for (const [key, item] of Object.entries(value)) {
    if (!IDENTIFIER.test(key) || !record(item) || !OUTPUT_TYPES.includes(item.type as never) || !isRef(item.from)) {
      issues.push({ path: `outputs.${key}`, code: "output" });
      continue;
    }
    const target = refTarget(item.from.$ref);
    if (!target) issues.push({ path: `outputs.${key}.from`, code: "reference" });
    else if (target.kind === "input" && (!inputs || !Object.hasOwn(inputs, target.field))) {
      issues.push({ path: `outputs.${key}.from`, code: "unknown_input" });
    } else if (target.kind === "step" && !steps?.some((step) => step.id === target.stepId)) {
      issues.push({ path: `outputs.${key}.from`, code: "forward_reference" });
    }
    outputs[key] = { type: item.type as Blueprint["outputs"][string]["type"], from: { $ref: item.from.$ref } };
  }
  return outputs;
}

function validateLimits(value: unknown, issues: Issue[]): Blueprint["limits"] | null {
  if (!record(value)) {
    issues.push({ path: "limits", code: "limits" });
    return null;
  }
  const timeoutMs = numberIn(value.timeoutMs, 1, MAX_RUN_MS);
  const maxOutputBytes = numberIn(value.maxOutputBytes, 1, MAX_OUTPUT_BYTES);
  if (timeoutMs === null) issues.push({ path: "limits.timeoutMs", code: "bound" });
  if (maxOutputBytes === null) issues.push({ path: "limits.maxOutputBytes", code: "bound" });
  if (timeoutMs === null || maxOutputBytes === null) return null;
  return { timeoutMs, maxOutputBytes };
}

function validateCapabilities(value: unknown, steps: Step[] | null, issues: Issue[]): Operation[] | null {
  if (!Array.isArray(value) || value.some((item) => !OPERATIONS.includes(item as Operation))) {
    issues.push({ path: "capabilities", code: "capabilities" });
    return null;
  }
  const capabilities = [...new Set(value)] as Operation[];
  const used = new Set(steps?.map((step) => step.op) ?? []);
  if (capabilities.length !== used.size || capabilities.some((item) => !used.has(item))) {
    issues.push({ path: "capabilities", code: "capabilities_mismatch" });
  }
  return capabilities;
}

export function responseSchema(value: unknown, path: string, issues: Issue[]): ResponseSchema | null {
  if (typeof value === "string" && REGISTERED_SCHEMAS.includes(value as never)) {
    return value as ResponseSchema;
  }
  if (!record(value) || value.type !== "object" || !record(value.properties) || !Array.isArray(value.required)) {
    issues.push({ path, code: "response_schema" });
    return null;
  }
  const keys = Object.keys(value.properties);
  if (keys.length < 1 || keys.length > 8) {
    issues.push({ path, code: "response_schema" });
    return null;
  }
  const properties: DeclarativeSchema["properties"] = {};
  for (const key of keys) {
    if (!IDENTIFIER.test(key)) issues.push({ path: `${path}.${key}`, code: "identifier" });
    const property = value.properties[key];
    if (!record(property) || !["string", "number", "boolean"].includes(String(property.type))) {
      issues.push({ path: `${path}.${key}`, code: "response_schema" });
      continue;
    }
    properties[key] = { type: property.type as "string" | "number" | "boolean" };
  }
  const required = value.required.filter((item): item is string => typeof item === "string");
  if (required.length !== value.required.length || required.some((item) => !Object.hasOwn(properties, item))) {
    issues.push({ path: `${path}.required`, code: "response_schema" });
  }
  return { type: "object", properties, required };
}

function parseInput(field: InputField, value: unknown): unknown {
  if (field.type === "string") {
    return typeof value === "string" && value.length <= field.maxLength ? value : undefined;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (field.minimum !== undefined && value < field.minimum) return undefined;
    if (field.maximum !== undefined && value > field.maximum) return undefined;
    return value;
  }
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "enum") return typeof value === "string" && field.values.includes(value) ? value : undefined;
  return typeof value === "string" ? canonicalAddress(value) ?? undefined : undefined;
}

function operand(value: unknown): number | { field: string } | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (record(value) && typeof value.field === "string" && IDENTIFIER.test(value.field)) return { field: value.field };
  return null;
}

function stringList(value: unknown, min: number, max: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === "string" && IDENTIFIER.test(item));
}

function scalar(value: unknown): boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function boundedString(value: unknown, min: number, max: number): string | null {
  return typeof value === "string" && value.length >= min && value.length <= max ? value : null;
}

function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(issues: Issue[]): { ok: false; issues: Issue[] } {
  return { ok: false, issues };
}
