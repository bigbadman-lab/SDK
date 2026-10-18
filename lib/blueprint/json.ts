import { createHash } from "node:crypto";

import { MAX_JSON_DEPTH, MAX_OUTPUT_BYTES, type Blueprint } from "./model.ts";

export function canonicalJson(value: unknown): string {
  return encode(value);
}

export function contentHash(blueprint: Blueprint): string {
  return createHash("sha256").update(canonicalJson(blueprint)).digest("hex");
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function withinOutputLimit(value: unknown, maxBytes = MAX_OUTPUT_BYTES): boolean {
  return jsonByteLength(value) <= maxBytes;
}

export function exceedsDepth(value: unknown, depth = MAX_JSON_DEPTH): boolean {
  return depthOf(value) > depth;
}

function depthOf(value: unknown, level = 0): number {
  if (level > MAX_JSON_DEPTH + 1) return level;
  if (Array.isArray(value)) {
    return value.reduce((max, item) => Math.max(max, depthOf(item, level + 1)), level + 1);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce(
      (max, item) => Math.max(max, depthOf(item, level + 1)),
      level + 1,
    );
  }
  return level;
}

function encode(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => encode(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${encode(item)}`)
    .join(",")}}`;
}
