import type { TransformStepAction } from "./model.ts";

const MAX_ROWS = 100;

export function applyTransform(
  data: unknown,
  actions: TransformStepAction[],
): { ok: true; value: unknown } | { ok: false; code: string } {
  let current = data;
  for (const action of actions) {
    const next = applyAction(current, action);
    if (!next.ok) return next;
    current = next.value;
  }
  return { ok: true, value: current };
}

function applyAction(
  data: unknown,
  action: TransformStepAction,
): { ok: true; value: unknown } | { ok: false; code: string } {
  if (action.action === "calculate") return calculate(data, action);
  const rows = rowsOf(data);
  if (!rows.ok) return rows;
  const table = rows.value;
  if (table.length > MAX_ROWS) return { ok: false, code: "transform_size" };
  if (action.action === "select") {
    return { ok: true, value: table.map((row) => pick(row, action.fields)) };
  }
  if (action.action === "filter") {
    return { ok: true, value: table.filter((row) => compare(row, action)) };
  }
  if (action.action === "sort") {
    const copy = [...table];
    copy.sort((left, right) => compareValues(fieldOf(left, action.field), fieldOf(right, action.field), action.direction));
    return { ok: true, value: copy };
  }
  if (action.action === "aggregate") return aggregate(table, action);
  if (action.action === "deduplicate") {
    const seen = new Set<string>();
    const unique = table.filter((row) => {
      const key = JSON.stringify(action.field ? fieldOf(row, action.field) : row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ok: true, value: unique };
  }
  return {
    ok: true,
    value: table.map((row) => ({ text: fill(action.template, row) })),
  };
}

function rowsOf(data: unknown): { ok: true; value: unknown[] } | { ok: false; code: string } {
  if (Array.isArray(data)) return { ok: true, value: data };
  if (record(data)) return { ok: true, value: [data] };
  return { ok: false, code: "transform_type" };
}

function calculate(
  data: unknown,
  action: Extract<TransformStepAction, { action: "calculate" }>,
): { ok: true; value: unknown } | { ok: false; code: string } {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length > MAX_ROWS) return { ok: false, code: "transform_size" };
  const value = rows.map((row) => {
    const left = typeof action.left === "number" ? action.left : numeric(fieldOf(row, action.left.field));
    const right = typeof action.right === "number" ? action.right : numeric(fieldOf(row, action.right.field));
    if (left === null || right === null) return row;
    const result =
      action.operator === "add"
        ? left + right
        : action.operator === "sub"
          ? left - right
          : action.operator === "mul"
            ? left * right
            : right === 0
              ? null
              : left / right;
    if (result === null || !Number.isFinite(result)) return row;
    if (!record(row)) return { [action.as]: result };
    return { ...row, [action.as]: result };
  });
  return { ok: true, value: Array.isArray(data) ? value : value[0] };
}

function aggregate(
  data: unknown[],
  action: Extract<TransformStepAction, { action: "aggregate" }>,
): { ok: true; value: unknown } | { ok: false; code: string } {
  if (action.operator === "count") return { ok: true, value: { count: data.length } };
  if (!action.field) return { ok: false, code: "transform_field" };
  const numbers = data.map((row) => numeric(fieldOf(row, action.field ?? ""))).filter((item): item is number => item !== null);
  if (numbers.length === 0) return { ok: true, value: { [action.operator]: null } };
  const value =
    action.operator === "sum"
      ? numbers.reduce((sum, item) => sum + item, 0)
      : action.operator === "min"
        ? Math.min(...numbers)
        : Math.max(...numbers);
  return { ok: true, value: { [action.operator]: value } };
}

function compare(row: unknown, action: Extract<TransformStepAction, { action: "filter" }>): boolean {
  const left = fieldOf(row, action.field);
  const right = action.value;
  if (action.operator === "contains") return typeof left === "string" && typeof right === "string" && left.includes(right);
  if (action.operator === "eq") return left === right;
  if (action.operator === "neq") return left !== right;
  const a = numeric(left);
  const b = numeric(right);
  if (a === null || b === null) return false;
  if (action.operator === "gt") return a > b;
  if (action.operator === "lt") return a < b;
  if (action.operator === "gte") return a >= b;
  return a <= b;
}

function compareValues(left: unknown, right: unknown, direction: "asc" | "desc"): number {
  const factor = direction === "asc" ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
  return String(left ?? "").localeCompare(String(right ?? "")) * factor;
}

function fill(template: string, row: unknown): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, field: string) => {
    const value = fieldOf(row, field);
    return value === undefined || value === null ? "" : String(value);
  });
}

function pick(row: unknown, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) result[field] = fieldOf(row, field);
  return result;
}

function fieldOf(row: unknown, field: string): unknown {
  if (!record(row) || !Object.hasOwn(row, field)) return undefined;
  return row[field];
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
