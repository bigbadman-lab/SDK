import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import { contentHash } from "@/lib/blueprint/json";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { checkImage, type ImageType } from "@/lib/launch/image";
import {
  feeCategory,
  feeLabel,
  httpsUri,
  metadataDocument,
  payloadHashInput,
  READY_NOTICE,
  type FeeCategory,
  type LaunchReview,
  type LaunchSourceKind,
  type LaunchSourceView,
  type PrepareRequest,
} from "@/lib/launch/prepare";
import { developerLabel, trustedOriginator } from "@/lib/library/submission";
import type { AccountIdentity } from "@/lib/server/auth";
import { databaseFailure, getSql } from "@/lib/server/db";
import { readOptionalEnv } from "@/lib/server/env";
import { pinArtwork, pinMetadata } from "@/lib/server/launch/pinata";
import {
  deleteArtwork,
  downloadArtwork,
  uploadArtwork,
} from "@/lib/server/launch/storage";

export class LaunchFlowError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 503,
    readonly code: string
  ) {
    super(code);
  }
}

export type { LaunchReview, LaunchSourceView };

type Resolved = {
  view: LaunchSourceView;
  origin: "private" | "official" | "community";
  originatorAccountId: string | null;
  draftId: string | null;
  librarySdkId: string | null;
  libraryVersionId: string | null;
};

type AssetRow = {
  id: string;
  content_hash: string;
  content_type: ImageType;
  width: number;
  height: number;
  byte_size: number;
  storage_path: string;
  image_ipfs_uri: string | null;
};

type LaunchRow = {
  id: string;
  idempotency_key: string;
  source_kind: LaunchSourceKind;
  draft_id: string | null;
  library_sdk_id: string | null;
  library_version_id: string | null;
  content_hash: string;
  origin: "private" | "official" | "community";
  originator_label: string;
  fee_category: FeeCategory;
  token_name: string;
  token_symbol: string;
  token_description: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  asset_id: string;
  payload_hash: string;
  metadata_hash: string | null;
  metadata_ipfs_uri: string | null;
  image_ipfs_uri: string | null;
  buy_amount: string;
  slippage_bps: number | null;
  status: "preparing" | "ready_for_transaction" | "abandoned";
};

type LaunchTx = postgres.TransactionSql;

export async function resolveLaunchQuery(
  account: AccountIdentity,
  query: {
    draftId: string | null;
    librarySdkId: string | null;
    versionId: string | null;
  }
): Promise<LaunchSourceView> {
  if (query.draftId && query.librarySdkId)
    throw new LaunchFlowError(400, "source");
  if (query.draftId) return (await resolveDraft(account, query.draftId)).view;
  if (query.librarySdkId)
    return (await resolveLibrary(query.librarySdkId, query.versionId, account))
      .view;
  throw new LaunchFlowError(400, "source");
}

export async function saveArtwork(
  account: AccountIdentity,
  bytes: Uint8Array,
  declared: string
): Promise<{
  assetId: string;
  width: number;
  height: number;
  contentType: ImageType;
  previewUrl: string;
}> {
  const checked = await checkImage(bytes);
  if (!checked.ok) throw new LaunchFlowError(422, checked.code);
  if (declared !== checked.type) throw new LaunchFlowError(422, "image_type");
  const hash = sha256(bytes);
  await purgeAbandoned(account.id);
  const existing = await guard(() => findAssetByHash(account.id, hash));
  if (existing) return artworkResult(existing);
  const assetId = randomUUID();
  const extension = checked.type === "image/png" ? "png" : "jpg";
  const storagePath = `${account.id}/${assetId}.${extension}`;
  try {
    await uploadArtwork(storagePath, bytes, checked.type);
  } catch {
    throw new LaunchFlowError(503, "unavailable");
  }
  try {
    await getSql()`
      insert into token_assets (
        id, account_id, content_hash, content_type, width, height, byte_size, storage_path, expires_at
      ) values (
        ${assetId}, ${account.id}, ${hash}, ${checked.type}, ${checked.width}, ${checked.height},
        ${bytes.byteLength}, ${storagePath}, now() + interval '7 days'
      )
    `;
  } catch (error) {
    await deleteArtwork(storagePath).catch(() => undefined);
    if (!isUnique(error)) throw stored(error);
    const raced = await findAssetByHash(account.id, hash);
    if (!raced) throw new LaunchFlowError(503, "unavailable");
    return artworkResult(raced);
  }
  return {
    assetId,
    width: checked.width,
    height: checked.height,
    contentType: checked.type,
    previewUrl: previewUrl(assetId),
  };
}

export async function readOwnedArtwork(
  account: AccountIdentity,
  assetId: string
): Promise<{ bytes: Uint8Array; contentType: ImageType }> {
  const asset = await guard(() => findAsset(account.id, assetId));
  if (!asset) throw new LaunchFlowError(404, "asset_not_found");
  let storedFile: { bytes: Uint8Array; contentType: string } | null;
  try {
    storedFile = await downloadArtwork(asset.storage_path);
  } catch {
    throw new LaunchFlowError(503, "unavailable");
  }
  if (!storedFile || storedFile.bytes.byteLength !== asset.byte_size) {
    throw new LaunchFlowError(404, "asset_not_found");
  }
  return { bytes: storedFile.bytes, contentType: asset.content_type };
}

export async function prepareLaunch(
  account: AccountIdentity,
  request: PrepareRequest
): Promise<LaunchReview> {
  const resolved =
    request.source.kind === "draft"
      ? await resolveDraft(account, request.source.draftId)
      : await resolveLibrary(
          request.source.sdkId,
          request.source.versionId,
          account
        );
  const asset = await guard(() => findAsset(account.id, request.assetId));
  if (!asset) throw new LaunchFlowError(404, "artwork");
  const payloadHash = sha256(
    payloadHashInput({
      source: request.source,
      contentHash: resolved.view.contentHash,
      fields: request.fields,
      assetHash: asset.content_hash,
      buyAmount: request.buyAmount,
      slippageBps: request.slippageBps,
    })
  );
  const row = await claim(account, request, resolved, asset.id, payloadHash);
  if (
    row.status === "ready_for_transaction" &&
    row.payload_hash === payloadHash &&
    row.metadata_ipfs_uri &&
    row.image_ipfs_uri
  ) {
    return review(resolved.view, row, asset);
  }
  const imageUri = await ensureImagePin(account.id, asset);
  const document = metadataDocument({
    fields: request.fields,
    imageUri,
    createdOn: platformOrigin(),
  });
  if (!document.ok) throw new LaunchFlowError(422, "uri");
  const metadataHash = sha256(document.hashInput);
  const metadataUri = await ensureMetadataPin(
    account.id,
    metadataHash,
    document.json
  );
  const ready = await guard(() =>
    markReady({
      accountId: account.id,
      launchId: row.id,
      assetId: asset.id,
      payloadHash,
      metadataHash,
      metadataUri,
      imageUri,
    })
  );
  if (ready)
    return review(resolved.view, ready, { ...asset, image_ipfs_uri: imageUri });
  const again = await guard(() => findLaunch(account.id, row.id));
  if (
    again?.status === "ready_for_transaction" &&
    again.payload_hash === payloadHash
  ) {
    return review(resolved.view, again, asset);
  }
  throw new LaunchFlowError(409, "stale_revision");
}

async function claim(
  account: AccountIdentity,
  request: PrepareRequest,
  resolved: Resolved,
  assetId: string,
  payloadHash: string
): Promise<LaunchRow> {
  return guard(() =>
    getSql().begin(async (tx) => {
      const current = request.preparationId
        ? await lockLaunch(tx, account.id, request.preparationId, null)
        : await lockLaunch(tx, account.id, null, request.idempotencyKey);
      if (request.preparationId && !current)
        throw new LaunchFlowError(404, "preparation");
      if (current?.status === "abandoned")
        throw new LaunchFlowError(409, "expired");
      if (current) {
        if (!sameSource(current, resolved))
          throw new LaunchFlowError(409, "source_changed");
        if (current.content_hash !== resolved.view.contentHash)
          throw new LaunchFlowError(409, "stale_revision");
        if (current.idempotency_key !== request.idempotencyKey)
          throw new LaunchFlowError(409, "idempotency_conflict");
        if (current.payload_hash === payloadHash) return current;
        if (!request.preparationId)
          throw new LaunchFlowError(409, "idempotency_conflict");
        return updatePreparation(
          tx,
          account.id,
          current.id,
          request,
          resolved,
          assetId,
          payloadHash
        );
      }
      return insertPreparation(
        tx,
        account,
        request,
        resolved,
        assetId,
        payloadHash
      );
    })
  );
}

async function updatePreparation(
  tx: LaunchTx,
  accountId: string,
  id: string,
  request: PrepareRequest,
  resolved: Resolved,
  assetId: string,
  payloadHash: string
): Promise<LaunchRow> {
  const [updated] = await tx<LaunchRow[]>`
    update token_launches set
      token_name = ${request.fields.name},
      token_symbol = ${request.fields.symbol},
      token_description = ${request.fields.description},
      website = ${request.fields.website},
      twitter = ${request.fields.twitter},
      telegram = ${request.fields.telegram},
      asset_id = ${assetId},
      payload_hash = ${payloadHash},
      buy_amount = ${request.buyAmount},
      slippage_bps = ${request.slippageBps},
      fee_category = ${resolved.view.feeCategory},
      originator_account_id = ${resolved.originatorAccountId},
      originator_label = ${resolved.view.originatorLabel},
      metadata_hash = null,
      metadata_ipfs_uri = null,
      image_ipfs_uri = null,
      status = 'preparing',
      updated_at = now()
    where id = ${id} and account_id = ${accountId}
    returning id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
      content_hash, origin, originator_label, fee_category, token_name, token_symbol,
      token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
      metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
  `;
  if (!updated) throw new LaunchFlowError(503, "unavailable");
  return updated;
}

async function insertPreparation(
  tx: LaunchTx,
  account: AccountIdentity,
  request: PrepareRequest,
  resolved: Resolved,
  assetId: string,
  payloadHash: string
): Promise<LaunchRow> {
  const [inserted] = await tx<LaunchRow[]>`
    insert into token_launches (
      account_id, wallet_address, idempotency_key, source_kind, draft_id, library_sdk_id,
      library_version_id, content_hash, origin, originator_account_id, originator_label,
      fee_category, token_name, token_symbol, token_description, website, twitter, telegram,
      asset_id, payload_hash, buy_amount, slippage_bps, status
    ) values (
      ${account.id}, ${account.walletAddress}, ${request.idempotencyKey}, ${resolved.view.kind},
      ${resolved.draftId}, ${resolved.librarySdkId}, ${resolved.libraryVersionId},
      ${resolved.view.contentHash}, ${resolved.origin}, ${resolved.originatorAccountId},
      ${resolved.view.originatorLabel}, ${resolved.view.feeCategory}, ${request.fields.name},
      ${request.fields.symbol}, ${request.fields.description}, ${request.fields.website},
      ${request.fields.twitter}, ${request.fields.telegram}, ${assetId}, ${payloadHash},
      ${request.buyAmount}, ${request.slippageBps}, 'preparing'
    )
    returning id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
      content_hash, origin, originator_label, fee_category, token_name, token_symbol,
      token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
      metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
  `;
  if (!inserted) throw new LaunchFlowError(503, "unavailable");
  return inserted;
}

async function ensureImagePin(
  accountId: string,
  asset: AssetRow
): Promise<string> {
  if (asset.image_ipfs_uri) return asset.image_ipfs_uri;
  let file: { bytes: Uint8Array; contentType: string } | null;
  try {
    file = await downloadArtwork(asset.storage_path);
  } catch {
    throw new LaunchFlowError(503, "unavailable");
  }
  if (!file) throw new LaunchFlowError(404, "artwork");
  const uri = await pinOrFail(() => pinArtwork(file.bytes, asset.content_type));
  await guard(
    () => getSql()`
    update token_assets
    set image_ipfs_uri = ${uri}
    where id = ${asset.id} and account_id = ${accountId} and image_ipfs_uri is null
  `
  );
  return uri;
}

async function ensureMetadataPin(
  accountId: string,
  metadataHash: string,
  json: string
): Promise<string> {
  const [existing] = await guard(
    () => getSql()<{ metadata_ipfs_uri: string }[]>`
    select metadata_ipfs_uri from token_launches
    where account_id = ${accountId}
      and metadata_hash = ${metadataHash}
      and metadata_ipfs_uri is not null
    limit 1
  `
  );
  if (existing?.metadata_ipfs_uri) return existing.metadata_ipfs_uri;
  return pinOrFail(() => pinMetadata(json));
}

async function markReady(input: {
  accountId: string;
  launchId: string;
  assetId: string;
  payloadHash: string;
  metadataHash: string;
  metadataUri: string;
  imageUri: string;
}): Promise<LaunchRow | null> {
  const [row] = await getSql()<LaunchRow[]>`
    update token_launches set
      metadata_hash = ${input.metadataHash},
      metadata_ipfs_uri = ${input.metadataUri},
      image_ipfs_uri = ${input.imageUri},
      status = 'ready_for_transaction',
      updated_at = now()
    where id = ${input.launchId}
      and account_id = ${input.accountId}
      and payload_hash = ${input.payloadHash}
      and status = 'preparing'
    returning id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
      content_hash, origin, originator_label, fee_category, token_name, token_symbol,
      token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
      metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
  `;
  if (!row || row.metadata_hash !== input.metadataHash) return null;
  await getSql()`
    update token_assets
    set expires_at = null, image_ipfs_uri = ${input.imageUri}
    where id = ${input.assetId} and account_id = ${input.accountId}
  `;
  return row;
}

async function resolveDraft(
  account: AccountIdentity,
  draftId: string
): Promise<Resolved> {
  const [row] = await guard(
    () => getSql()<DraftRow[]>`
    select
      sdk_drafts.id, sdk_drafts.account_id, sdk_drafts.saved_at, sdk_drafts.deleted_at,
      sdk_drafts.saved_name, sdk_drafts.saved_description, sdk_drafts.saved_hash,
      sdk_drafts.originator_account_id, sdk_drafts.originator_label,
      blueprint_versions.id as version_id, blueprint_versions.blueprint, blueprint_versions.content_hash,
      library_sdks.origin as source_origin,
      exists (
        select 1 from executions
        where executions.draft_id = sdk_drafts.id
          and executions.account_id = sdk_drafts.account_id
          and executions.version_id = blueprint_versions.id
          and executions.status = 'SUCCESS'
      ) as tested
    from sdk_drafts
    left join blueprint_versions
      on blueprint_versions.draft_id = sdk_drafts.id
      and blueprint_versions.content_hash = sdk_drafts.saved_hash
    left join library_sdks on library_sdks.id = sdk_drafts.source_sdk_id
    where sdk_drafts.id = ${draftId}
  `
  );
  if (!row || row.account_id !== account.id)
    throw new LaunchFlowError(404, "not_owner");
  if (row.deleted_at) throw new LaunchFlowError(400, "deleted");
  if (
    !row.saved_at ||
    !row.saved_hash ||
    !row.saved_name ||
    !row.saved_description
  ) {
    throw new LaunchFlowError(400, "unsaved");
  }
  if (!row.version_id || !row.content_hash)
    throw new LaunchFlowError(409, "stale_revision");
  if (row.tested !== true) throw new LaunchFlowError(400, "test_required");
  assertBlueprint(row.blueprint, row.content_hash);
  const originator = trustedOriginator({
    ownerAccountId: account.id,
    ownerLabel: developerLabel(account.walletAddress),
    lineageAccountId: row.originator_account_id,
    lineageLabel: row.originator_label,
  });
  const origin =
    row.source_origin === "official" || row.source_origin === "community"
      ? row.source_origin
      : "private";
  const category = feeCategory({
    sourceOrigin: origin,
    launcherAccountId: account.id,
    originatorAccountId: originator.accountId,
  });
  return {
    origin,
    originatorAccountId: originator.accountId,
    draftId: row.id,
    librarySdkId: null,
    libraryVersionId: null,
    view: {
      kind: "draft",
      draftId: row.id,
      librarySdkId: null,
      versionId: row.version_id,
      name: row.saved_name,
      description: row.saved_description,
      provenance:
        origin === "official"
          ? "Private remix of an official SDK"
          : origin === "community"
            ? "Private remix of a community SDK"
            : "Private SDK",
      versionLabel: "Saved revision",
      contentHash: row.content_hash,
      originatorLabel: originator.label,
      feeCategory: category,
      feeLabel: feeLabel(category),
    },
  };
}

async function resolveLibrary(
  sdkId: string,
  versionId: string | null,
  account: AccountIdentity
): Promise<Resolved> {
  const [row] = await guard(
    () => getSql()<LibraryRow[]>`
    select
      library_sdks.id, library_sdks.origin, library_sdks.name, library_sdks.description,
      library_sdks.originator_account_id, library_sdks.originator_label,
      library_versions.id as version_id, library_versions.version_number, library_versions.content_hash,
      library_versions.blueprint
    from library_sdks
    join library_versions on library_versions.sdk_id = library_sdks.id
      and library_versions.id = coalesce(${versionId}::uuid, library_sdks.current_version_id)
    where library_sdks.id = ${sdkId} and library_sdks.status = 'published'
  `
  );
  if (!row) throw new LaunchFlowError(404, "not_owner");
  assertBlueprint(row.blueprint, row.content_hash);
  const originator = trustedOriginator({
    ownerAccountId: account.id,
    ownerLabel: developerLabel(account.walletAddress),
    lineageAccountId: row.originator_account_id,
    lineageLabel: row.originator_label,
  });
  const category = feeCategory({
    sourceOrigin: row.origin,
    launcherAccountId: account.id,
    originatorAccountId: originator.accountId,
  });
  return {
    origin: row.origin,
    originatorAccountId: originator.accountId,
    draftId: null,
    librarySdkId: row.id,
    libraryVersionId: row.version_id,
    view: {
      kind: "library",
      draftId: null,
      librarySdkId: row.id,
      versionId: row.version_id,
      name: row.name,
      description: row.description,
      provenance:
        row.origin === "official" ? "Official Library" : "Community Library",
      versionLabel: `Version ${row.version_number}`,
      contentHash: row.content_hash,
      originatorLabel: originator.label,
      feeCategory: category,
      feeLabel: feeLabel(category),
    },
  };
}

function assertBlueprint(value: unknown, storedHash: string): void {
  const validated = validateBlueprint(value);
  if (!validated.ok || contentHash(validated.blueprint) !== storedHash) {
    throw new LaunchFlowError(400, "blueprint_invalid");
  }
}

function review(
  source: LaunchSourceView,
  row: LaunchRow,
  asset: AssetRow
): LaunchReview {
  const ready =
    row.status === "ready_for_transaction" &&
    Boolean(row.metadata_ipfs_uri && row.image_ipfs_uri);
  return {
    ...source,
    feeCategory: row.fee_category,
    feeLabel: feeLabel(row.fee_category),
    originatorLabel: row.originator_label,
    id: row.id,
    status: row.status,
    ready,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenDescription: row.token_description,
    website: row.website,
    twitter: row.twitter,
    telegram: row.telegram,
    artworkUrl: previewUrl(asset.id),
    artworkWidth: asset.width,
    artworkHeight: asset.height,
    imagePinned: Boolean(row.image_ipfs_uri),
    metadataPinned: Boolean(row.metadata_ipfs_uri),
    imageUri: row.image_ipfs_uri,
    metadataUri: row.metadata_ipfs_uri,
    buyAmount: row.buy_amount,
    slippageBps: row.slippage_bps,
    notice: READY_NOTICE,
  };
}

async function purgeAbandoned(accountId: string): Promise<void> {
  await guard(async () => {
    await getSql()`
      update token_launches
      set status = 'abandoned', updated_at = now()
      where account_id = ${accountId}
        and status = 'preparing'
        and updated_at < now() - interval '7 days'
    `;
    const stale = await getSql()<{ id: string; storage_path: string }[]>`
      select id, storage_path from token_assets
      where account_id = ${accountId}
        and expires_at is not null
        and expires_at < now()
        and not exists (
          select 1 from token_launches
          where token_launches.asset_id = token_assets.id
            and token_launches.status in ('preparing', 'ready_for_transaction')
        )
    `;
    for (const asset of stale) {
      await deleteArtwork(asset.storage_path).catch(() => undefined);
      await getSql()`delete from token_assets where id = ${asset.id} and account_id = ${accountId}`;
    }
  });
}

async function findAsset(
  accountId: string,
  assetId: string
): Promise<AssetRow | null> {
  const [row] = await getSql()<AssetRow[]>`
    select id, content_hash, content_type, width, height, byte_size, storage_path, image_ipfs_uri
    from token_assets
    where id = ${assetId} and account_id = ${accountId} and visibility = 'staged'
  `;
  return row ?? null;
}

async function findAssetByHash(
  accountId: string,
  hash: string
): Promise<AssetRow | null> {
  const [row] = await getSql()<AssetRow[]>`
    select id, content_hash, content_type, width, height, byte_size, storage_path, image_ipfs_uri
    from token_assets
    where account_id = ${accountId} and content_hash = ${hash} and visibility = 'staged'
      and (expires_at is null or expires_at > now())
  `;
  return row ?? null;
}

async function findLaunch(
  accountId: string,
  id: string
): Promise<LaunchRow | null> {
  const [row] = await getSql()<LaunchRow[]>`
    select
      id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
      content_hash, origin, originator_label, fee_category, token_name, token_symbol,
      token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
      metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
    from token_launches
    where id = ${id} and account_id = ${accountId}
  `;
  return row ?? null;
}

async function lockLaunch(
  tx: LaunchTx,
  accountId: string,
  id: string | null,
  key: string | null
): Promise<LaunchRow | null> {
  const [row] = id
    ? await tx<LaunchRow[]>`
      select
        id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
        content_hash, origin, originator_label, fee_category, token_name, token_symbol,
        token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
        metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
      from token_launches
      where id = ${id} and account_id = ${accountId}
      for update
    `
    : await tx<LaunchRow[]>`
      select
        id, idempotency_key, source_kind, draft_id, library_sdk_id, library_version_id,
        content_hash, origin, originator_label, fee_category, token_name, token_symbol,
        token_description, website, twitter, telegram, asset_id, payload_hash, metadata_hash,
        metadata_ipfs_uri, image_ipfs_uri, buy_amount, slippage_bps, status
      from token_launches
      where account_id = ${accountId} and idempotency_key = ${key}
      for update
    `;
  return row ?? null;
}

function sameSource(row: LaunchRow, resolved: Resolved): boolean {
  if (resolved.view.kind === "draft")
    return row.source_kind === "draft" && row.draft_id === resolved.draftId;
  return (
    row.source_kind === "library" &&
    row.library_sdk_id === resolved.librarySdkId &&
    row.library_version_id === resolved.libraryVersionId
  );
}

function platformOrigin(): string | null {
  const origin = readOptionalEnv("NEXT_PUBLIC_APP_URL");
  return origin && httpsUri(origin) ? origin : null;
}

async function pinOrFail(pin: () => Promise<string>): Promise<string> {
  try {
    return await pin();
  } catch (error) {
    if (error instanceof Error && error.message === "uri_too_long")
      throw new LaunchFlowError(422, "uri_too_long");
    throw new LaunchFlowError(503, "pin_failed");
  }
}

function artworkResult(asset: AssetRow): {
  assetId: string;
  width: number;
  height: number;
  contentType: ImageType;
  previewUrl: string;
} {
  return {
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    contentType: asset.content_type,
    previewUrl: previewUrl(asset.id),
  };
}

function previewUrl(assetId: string): string {
  return `/api/launch/artwork/${assetId}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LaunchFlowError) throw error;
    throw stored(error);
  }
}

function stored(error: unknown): LaunchFlowError {
  const failure = databaseFailure(error);
  return new LaunchFlowError(
    503,
    failure === "missing_schema" ? "schema_missing" : "unavailable"
  );
}

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

type DraftRow = {
  id: string;
  account_id: string;
  saved_at: Date | null;
  deleted_at: Date | null;
  saved_name: string | null;
  saved_description: string | null;
  saved_hash: string | null;
  originator_account_id: string | null;
  originator_label: string | null;
  version_id: string | null;
  blueprint: unknown;
  content_hash: string | null;
  source_origin: "official" | "community" | null;
  tested: boolean;
};

type LibraryRow = {
  id: string;
  origin: "official" | "community";
  name: string;
  description: string;
  originator_account_id: string | null;
  originator_label: string;
  version_id: string;
  version_number: number;
  content_hash: string;
  blueprint: unknown;
};

export async function assertRehearsalParent(): Promise<string> {
  try {
    const columns = await getSql()<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = 'token_launches'
        and column_name in ('parent_scope', 'parent_mint_address')
    `;
    if (columns.length < 2) throw new LaunchFlowError(503, "not_ready");
    const rows = await getSql()<{ mint_address: string }[]>`
      select mint_address from parent_registrations
      where scope = 'test' and symbol = 'TREST' and eligible = true
      limit 1
    `;
    const mint = rows[0]?.mint_address;
    if (!mint) throw new LaunchFlowError(422, "parent_unregistered");
    return mint;
  } catch (error) {
    if (error instanceof LaunchFlowError) throw error;
    throw new LaunchFlowError(503, databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable");
  }
}

export async function bindRehearsalParent(accountId: string, launchId: string): Promise<void> {
  const mint = await assertRehearsalParent();
  try {
    const updated = await getSql()<{ id: string }[]>`
      update token_launches
      set parent_scope = 'test', parent_mint_address = ${mint}
      where id = ${launchId}
        and account_id = ${accountId}
        and (
          (parent_scope = 'production' and parent_mint_address is null)
          or (parent_scope = 'test' and parent_mint_address = ${mint})
        )
      returning id
    `;
    if (!updated[0]) throw new LaunchFlowError(409, "parent_immutable");
  } catch (error) {
    if (error instanceof LaunchFlowError) throw error;
    throw new LaunchFlowError(503, databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable");
  }
}
