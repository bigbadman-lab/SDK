import type { Blueprint, Operation } from "../blueprint/model.ts";

export const OFFICIAL_SDK_NAMES = [
  "Prompt Architect",
  "Data Alchemist",
  "Document Intelligence",
  "World Engine",
  "PersonaOS",
  "Decision Lab",
  "Chain Investigator",
  "Token Forensics",
  "Wallet DNA",
  "Venture Forge",
] as const;

export const LIBRARY_PAGE_SIZE = 12;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

const OPERATION_LABELS: Record<Operation, string> = {
  "ai.generate": "Generate",
  "ai.analyze": "Analyze",
  "solana.account": "Account",
  "solana.transactions": "Transactions",
  "solana.token": "Token",
  "data.transform": "Transform",
};

export type LibraryOrigin = "official" | "community";

export type LibraryQuery = {
  q: string;
  origin: LibraryOrigin | null;
  page: number;
  limit: number;
  offset: number;
};

export type LibraryInput = {
  key: string;
  type: string;
  required: boolean;
  values: string[];
};

export function isPublicId(value: string): boolean {
  return UUID.test(value);
}

export function isOfficialSdkName(name: string): boolean {
  return (OFFICIAL_SDK_NAMES as readonly string[]).includes(name);
}

export function originAllowsName(origin: LibraryOrigin, name: string): boolean {
  const official = isOfficialSdkName(name);
  return origin === "official" ? official : !official;
}

export function visibleInLibrary(listingStatus: string | null): boolean {
  return listingStatus === "published";
}

export function libraryQuery(input: {
  q?: string | null;
  origin?: string | null;
  page?: string | null;
}): LibraryQuery {
  const q = (input.q ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const origin = input.origin === "official" || input.origin === "community" ? input.origin : null;
  const parsed = Number(input.page);
  const page = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 1;
  return {
    q,
    origin,
    page,
    limit: LIBRARY_PAGE_SIZE,
    offset: (page - 1) * LIBRARY_PAGE_SIZE,
  };
}

export function libraryHref(query: Pick<LibraryQuery, "q" | "origin" | "page">): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.origin) params.set("origin", query.origin);
  if (query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text.length > 0 ? `/library?${text}` : "/library";
}

export function ilikePattern(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function nextLibraryVersion(input: {
  validated: boolean;
  hash: string;
  versions: Array<{ versionNumber: number; contentHash: string }>;
}):
  | { action: "reject" }
  | { action: "reuse"; versionNumber: number }
  | { action: "append"; versionNumber: number } {
  if (!input.validated || !HASH.test(input.hash)) return { action: "reject" };
  const existing = input.versions.find((version) => version.contentHash === input.hash);
  if (existing) return { action: "reuse", versionNumber: existing.versionNumber };
  const max = input.versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0);
  return { action: "append", versionNumber: max + 1 };
}

export function remixCopy(input: {
  remixerAccountId: string;
  source: {
    sdkId: string;
    versionId: string;
    contentHash: string;
    blueprintHash: string;
    originatorAccountId: string | null;
    originatorLabel: string;
  };
}):
  | { ok: false; code: "lineage" }
  | {
      ok: true;
      savedAt: null;
      published: false;
      ownerAccountId: string;
      sourceSdkId: string;
      sourceVersionId: string;
      contentHash: string;
      originatorAccountId: string | null;
      originatorLabel: string;
    } {
  const label = input.source.originatorLabel.trim();
  if (
    !isPublicId(input.remixerAccountId) ||
    !isPublicId(input.source.sdkId) ||
    !isPublicId(input.source.versionId) ||
    !HASH.test(input.source.contentHash) ||
    input.source.contentHash !== input.source.blueprintHash ||
    label.length < 1 ||
    label.length > 80
  ) {
    return { ok: false, code: "lineage" };
  }
  return {
    ok: true,
    savedAt: null,
    published: false,
    ownerAccountId: input.remixerAccountId,
    sourceSdkId: input.source.sdkId,
    sourceVersionId: input.source.versionId,
    contentHash: input.source.contentHash,
    originatorAccountId: input.source.originatorAccountId,
    originatorLabel: label,
  };
}

export function operationLabels(capabilities: readonly string[]): string[] {
  const labels: string[] = [];
  for (const capability of capabilities) {
    if (!Object.hasOwn(OPERATION_LABELS, capability)) continue;
    const label = OPERATION_LABELS[capability as Operation];
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function publicInputs(blueprint: Blueprint): LibraryInput[] {
  return Object.entries(blueprint.inputs).map(([key, field]) => ({
    key,
    type: field.type,
    required: field.required,
    values: field.type === "enum" ? field.values : [],
  }));
}

export function publicOutputs(blueprint: Blueprint): Array<{ key: string; type: string; from: string }> {
  return Object.entries(blueprint.outputs).map(([key, output]) => ({
    key,
    type: output.type,
    from: output.from.$ref,
  }));
}
