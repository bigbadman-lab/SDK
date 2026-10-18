import type { Ref } from "./model.ts";

const INPUT_REF = /^inputs\.([a-z][a-z0-9_]{0,40})$/;
const STEP_REF =
  /^steps\.([a-z][a-z0-9_]{0,40})\.result(?:\.([A-Za-z_][A-Za-z0-9_]{0,40}(?:\.[A-Za-z_][A-Za-z0-9_]{0,40})*))?$/;

export function isRef(value: unknown): value is Ref {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "$ref" in value &&
    typeof value.$ref === "string"
  );
}

export function refTarget(
  ref: string,
): { kind: "input"; field: string } | { kind: "step"; stepId: string; path: string[] } | null {
  const input = INPUT_REF.exec(ref);
  if (input?.[1]) return { kind: "input", field: input[1] };
  const step = STEP_REF.exec(ref);
  if (!step?.[1]) return null;
  const path = step[2] ? step[2].split(".") : [];
  return { kind: "step", stepId: step[1], path };
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
