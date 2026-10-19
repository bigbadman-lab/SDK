// Pure launch-preparation rules. Recipients and percentages are never taken from a request.

export const TOKEN_NAME_MAX = 32;
export const TOKEN_SYMBOL_MAX = 13;
export const TOKEN_DESCRIPTION_MAX = 500;
export const LINK_MAX = 200;
export const URI_MAX = 200;
export const ARTWORK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FeeCategory = "community_split" | "originator_launch" | "official";

export type LaunchSourceKind = "draft" | "library";

export type PrepareSource =
  | { kind: "draft"; draftId: string }
  | { kind: "library"; sdkId: string; versionId: string };

export type TokenFields = {
  name: string;
  symbol: string;
  description: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
};

export type PrepareRequest = {
  idempotencyKey: string;
  preparationId: string | null;
  source: PrepareSource;
  fields: TokenFields;
  assetId: string;
  buyAmount: string;
  slippageBps: number | null;
};

export function feeCategory(input: {
  sourceOrigin: "private" | "official" | "community";
  launcherAccountId: string;
  originatorAccountId: string | null;
}): FeeCategory {
  if (input.sourceOrigin === "official") return "official";
  if (
    !input.originatorAccountId ||
    input.originatorAccountId === input.launcherAccountId
  ) {
    return "originator_launch";
  }
  return "community_split";
}

export function feeLabel(category: FeeCategory): string {
  if (category === "official") return "60% launcher · 40% platform";
  if (category === "originator_launch") return "85% launcher · 15% platform";
  return "60% launcher · 25% originating developer · 15% platform";
}

export function parsePrepareBody(
  value: unknown
): { ok: true; value: PrepareRequest } | { ok: false; code: string } {
  if (!record(value)) return { ok: false, code: "body" };
  const keys = Object.keys(value).sort();
  const expected = [
    "assetId",
    "buyAmount",
    "description",
    "idempotencyKey",
    "name",
    "preparationId",
    "slippageBps",
    "source",
    "symbol",
    "telegram",
    "twitter",
    "website",
  ];
  if (keys.join(",") !== expected.join(",")) return { ok: false, code: "body" };
  if (
    typeof value.idempotencyKey !== "string" ||
    !UUID.test(value.idempotencyKey)
  ) {
    return { ok: false, code: "idempotency" };
  }
  if (
    value.preparationId !== null &&
    (typeof value.preparationId !== "string" || !UUID.test(value.preparationId))
  ) {
    return { ok: false, code: "preparation" };
  }
  const source = parseSource(value.source);
  if (!source) return { ok: false, code: "source" };
  const fields = parseTokenFields({
    name: value.name,
    symbol: value.symbol,
    description: value.description,
    website: value.website,
    twitter: value.twitter,
    telegram: value.telegram,
  });
  if (!fields.ok) return fields;
  if (typeof value.assetId !== "string" || !UUID.test(value.assetId))
    return { ok: false, code: "artwork" };
  if (typeof value.buyAmount !== "string") return { ok: false, code: "buy" };
  if (value.slippageBps !== null && typeof value.slippageBps !== "number")
    return { ok: false, code: "slippage" };
  const buy = parseBuy(value.buyAmount, value.slippageBps);
  if (!buy.ok) return buy;
  return {
    ok: true,
    value: {
      idempotencyKey: value.idempotencyKey.toLowerCase(),
      preparationId:
        typeof value.preparationId === "string"
          ? value.preparationId.toLowerCase()
          : null,
      source,
      fields: fields.value,
      assetId: value.assetId.toLowerCase(),
      buyAmount: buy.amount,
      slippageBps: buy.slippageBps,
    },
  };
}

export function parseTokenFields(
  value: unknown
): { ok: true; value: TokenFields } | { ok: false; code: string } {
  if (!record(value)) return { ok: false, code: "body" };
  if (typeof value.name !== "string") return { ok: false, code: "name" };
  const name = value.name.trim();
  if (
    name !== value.name ||
    name.length < 1 ||
    name.length > TOKEN_NAME_MAX ||
    /[\u0000-\u001f]/.test(name)
  ) {
    return { ok: false, code: "name" };
  }
  if (
    typeof value.symbol !== "string" ||
    !/^[A-Za-z0-9]{1,13}$/.test(value.symbol)
  ) {
    return { ok: false, code: "symbol" };
  }
  if (value.symbol.length > TOKEN_SYMBOL_MAX)
    return { ok: false, code: "symbol" };
  if (typeof value.description !== "string")
    return { ok: false, code: "description" };
  const description = value.description.trim();
  if (
    description !== value.description ||
    description.length < 1 ||
    description.length > TOKEN_DESCRIPTION_MAX ||
    /[\u0000-\u001f]/.test(description)
  ) {
    return { ok: false, code: "description" };
  }
  const website = optionalLink(value.website, "website");
  if (!website.ok) return website;
  const twitter = optionalLink(value.twitter, "twitter");
  if (!twitter.ok) return twitter;
  const telegram = optionalLink(value.telegram, "telegram");
  if (!telegram.ok) return telegram;
  if (
    twitter.value &&
    !/^https:\/\/(x\.com|twitter\.com)\/[A-Za-z0-9_]+\/?$/.test(twitter.value)
  ) {
    return { ok: false, code: "twitter" };
  }
  if (
    telegram.value &&
    !/^https:\/\/t\.me\/[A-Za-z0-9_]+\/?$/.test(telegram.value)
  ) {
    return { ok: false, code: "telegram" };
  }
  return {
    ok: true,
    value: {
      name,
      symbol: value.symbol,
      description,
      website: website.value,
      twitter: twitter.value,
      telegram: telegram.value,
    },
  };
}

export function parseBuy(
  amount: string,
  slippageBps: number | null
):
  | { ok: true; amount: string; slippageBps: number | null }
  | { ok: false; code: "buy" | "slippage" } {
  const canonical = canonicalAmount(amount);
  if (!canonical) return { ok: false, code: "buy" };
  if (canonical === "0") {
    if (slippageBps !== null) return { ok: false, code: "slippage" };
    return { ok: true, amount: "0", slippageBps: null };
  }
  if (
    slippageBps === null ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > 1000
  ) {
    return { ok: false, code: "slippage" };
  }
  return { ok: true, amount: canonical, slippageBps };
}

export function canonicalAmount(value: string): string | null {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (!whole) return null;
  if (!trimmed) return whole;
  return `${whole}.${trimmed}`;
}

export function metadataDocument(input: {
  fields: TokenFields;
  imageUri: string;
  createdOn: string | null;
}): { ok: true; json: string; hashInput: string } | { ok: false; code: "uri" } {
  if (!httpsUri(input.imageUri)) return { ok: false, code: "uri" };
  const document: Record<string, string | boolean> = {
    name: input.fields.name,
    symbol: input.fields.symbol,
    description: input.fields.description,
    image: input.imageUri,
    showName: true,
  };
  if (input.createdOn && httpsUri(input.createdOn))
    document.createdOn = input.createdOn;
  if (input.fields.website) document.website = input.fields.website;
  if (input.fields.twitter) document.twitter = input.fields.twitter;
  if (input.fields.telegram) document.telegram = input.fields.telegram;
  const json = JSON.stringify(document);
  return { ok: true, json, hashInput: json };
}

export function httpsUri(value: string): boolean {
  if (
    value.length < 12 ||
    value.length > URI_MAX ||
    !value.startsWith("https://") ||
    /\s/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.host.length > 0
    );
  } catch {
    return false;
  }
}

export function ipfsGatewayUri(
  gatewayDomain: string,
  cid: string
): string | null {
  if (!/^[A-Za-z0-9]+$/.test(cid) || cid.length < 46 || cid.length > 100)
    return null;
  const host = gatewayDomain
    .trim()
    .replace(/^https:\/\//, "")
    .replace(/\/+$/, "");
  if (!host || host.startsWith("http://") || !/^[A-Za-z0-9.-]+$/.test(host))
    return null;
  const uri = `https://${host}/ipfs/${cid}`;
  return httpsUri(uri) ? uri : null;
}

export function payloadHashInput(input: {
  source: PrepareSource;
  contentHash: string;
  fields: TokenFields;
  assetHash: string;
  buyAmount: string;
  slippageBps: number | null;
}): string {
  return JSON.stringify({
    assetHash: input.assetHash,
    buyAmount: input.buyAmount,
    contentHash: input.contentHash,
    description: input.fields.description,
    name: input.fields.name,
    slippageBps: input.slippageBps,
    source:
      input.source.kind === "draft"
        ? { draftId: input.source.draftId, kind: "draft" }
        : {
            kind: "library",
            sdkId: input.source.sdkId,
            versionId: input.source.versionId,
          },
    symbol: input.fields.symbol,
    telegram: input.fields.telegram,
    twitter: input.fields.twitter,
    website: input.fields.website,
  });
}

export function idempotencyDecision(
  existingHash: string | null,
  nextHash: string
): "create" | "reuse" | "conflict" {
  if (!existingHash) return "create";
  return existingHash === nextHash ? "reuse" : "conflict";
}

export function metadataStale(
  pinnedHash: string | null,
  nextHash: string
): boolean {
  return pinnedHash !== nextHash;
}

export const READY_NOTICE =
  "Token creation and wallet signing are not available until the canonical $SDK mint is verified. This preparation is not a mint.";

export type LaunchSourceView = {
  kind: LaunchSourceKind;
  draftId: string | null;
  librarySdkId: string | null;
  versionId: string;
  name: string;
  description: string;
  provenance: string;
  versionLabel: string;
  contentHash: string;
  originatorLabel: string;
  feeCategory: FeeCategory;
  feeLabel: string;
};

export type LaunchReview = LaunchSourceView & {
  id: string;
  status: "preparing" | "ready_for_transaction" | "abandoned";
  ready: boolean;
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  artworkUrl: string;
  artworkWidth: number;
  artworkHeight: number;
  imagePinned: boolean;
  metadataPinned: boolean;
  imageUri: string | null;
  metadataUri: string | null;
  buyAmount: string;
  slippageBps: number | null;
  notice: string;
};

function parseSource(value: unknown): PrepareSource | null {
  if (!record(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (
    value.kind === "draft" &&
    keys === "draftId,kind" &&
    typeof value.draftId === "string" &&
    UUID.test(value.draftId)
  ) {
    return { kind: "draft", draftId: value.draftId.toLowerCase() };
  }
  if (
    value.kind === "library" &&
    keys === "kind,sdkId,versionId" &&
    typeof value.sdkId === "string" &&
    typeof value.versionId === "string" &&
    UUID.test(value.sdkId) &&
    UUID.test(value.versionId)
  ) {
    return {
      kind: "library",
      sdkId: value.sdkId.toLowerCase(),
      versionId: value.versionId.toLowerCase(),
    };
  }
  return null;
}

function optionalLink(
  value: unknown,
  code: "website" | "twitter" | "telegram"
): { ok: true; value: string | null } | { ok: false; code: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, code };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > LINK_MAX || !httpsUri(trimmed))
    return { ok: false, code };
  return { ok: true, value: trimmed };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
