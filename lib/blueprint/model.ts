export const SCHEMA_VERSION = "1.0" as const;

export const OPERATIONS = [
  "ai.generate",
  "ai.analyze",
  "solana.account",
  "solana.transactions",
  "solana.token",
  "data.transform",
] as const;

export type Operation = (typeof OPERATIONS)[number];

export const INPUT_TYPES = [
  "string",
  "number",
  "boolean",
  "enum",
  "solanaAddress",
] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export const TRANSFORM_ACTIONS = [
  "select",
  "filter",
  "sort",
  "aggregate",
  "deduplicate",
  "format",
  "calculate",
] as const;

export type TransformAction = (typeof TRANSFORM_ACTIONS)[number];

export const REGISTERED_SCHEMAS = [
  "text_v1",
  "analysis_v1",
  "prompt_result_v1",
] as const;

export type RegisteredSchema = (typeof REGISTERED_SCHEMAS)[number];

export const MAX_STEPS = 5;
export const MAX_OPENAI_REQUESTS = 5;
export const MAX_HELIUS_REQUESTS = 10;
export const MAX_RUN_MS = 60_000;
export const MAX_OUTPUT_TOKENS = 4_000;
export const MAX_TEXT_CHARS = 40_000;
export const MAX_OUTPUT_BYTES = 131_072;
export const MAX_TRANSACTIONS = 100;
export const MAX_TRANSFORM_ACTIONS = 5;
export const MAX_JSON_DEPTH = 6;
export const MAX_BUILDER_MESSAGE_CHARS = 8_000;
export const RUN_TOKEN_BUDGET = 20_000;
export const OPENAI_RESERVE_USD = 0.02;
export const ACCOUNT_DAILY_USD = 1;
export const GLOBAL_DAILY_USD = 20;
export const PROVIDER_DEADLINE_MS = 20_000;
export const PROVIDER_RETRIES = 0;
export const BUILDER_MESSAGES_PER_DAY = 100;
export const WEBSITE_RUNS_PER_DAY = 20;
export const MAX_DRAFTS = 20;
export const MAX_CONCURRENT_RUNS = 2;
export const MODEL_ID = "gpt-4.1-mini";

export type Ref = { $ref: string };

export type DeclarativeSchema = {
  type: "object";
  properties: Record<string, { type: "string" | "number" | "boolean" }>;
  required: string[];
};

export type ResponseSchema = RegisteredSchema | DeclarativeSchema;

export type InputField =
  | {
      type: "string";
      required: boolean;
      maxLength: number;
      default?: string;
    }
  | {
      type: "number";
      required: boolean;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | { type: "boolean"; required: boolean; default?: boolean }
  | {
      type: "enum";
      required: boolean;
      values: string[];
      default?: string;
    }
  | { type: "solanaAddress"; required: boolean; default?: string };

export type CompareOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains";

export type TransformStepAction =
  | { action: "select"; fields: string[] }
  | {
      action: "filter";
      field: string;
      operator: CompareOperator;
      value: string | number | boolean;
    }
  | { action: "sort"; field: string; direction: "asc" | "desc" }
  | {
      action: "aggregate";
      operator: "count" | "sum" | "min" | "max";
      field?: string;
    }
  | { action: "deduplicate"; field?: string }
  | { action: "format"; template: string }
  | {
      action: "calculate";
      operator: "add" | "sub" | "mul" | "div";
      left: number | { field: string };
      right: number | { field: string };
      as: string;
    };

export type Step = {
  id: string;
  op: Operation;
  config: Record<string, unknown>;
  args: Record<string, Ref | string | number | boolean>;
};

export type Blueprint = {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  description: string;
  inputs: Record<string, InputField>;
  steps: Step[];
  outputs: Record<string, { type: "string" | "number" | "boolean" | "object" | "array"; from: Ref }>;
  limits: { timeoutMs: number; maxOutputBytes: number };
  capabilities: Operation[];
};

export type Issue = { path: string; code: string };

export const IDENTIFIER = /^[a-z][a-z0-9_]{0,40}$/;
