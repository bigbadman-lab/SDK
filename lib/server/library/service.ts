import "server-only";

import type postgres from "postgres";

import { contentHash } from "@/lib/blueprint/json";
import type { Blueprint } from "@/lib/blueprint/model";
import { parseSdkIdentity } from "@/lib/blueprint/save";
import { validateBlueprint, validateInputsAgainst } from "@/lib/blueprint/validate";
import { runBlueprint } from "@/lib/blueprint/execute";
import {
  ilikePattern,
  isPublicId,
  libraryQuery,
  nextLibraryVersion,
  originAllowsName,
  publicInputs,
  publicOutputs,
  remixCopy,
  type LibraryOrigin,
  type LibraryQuery,
} from "@/lib/library/library";
import { OFFICIAL_ORIGINATOR_LABEL, OFFICIAL_SDKS, officialSeedPlan } from "@/lib/library/official";
import {
  developerLabel,
  reviewDecision,
  submissionEligibility,
  submissionQuota,
  trustedOriginator,
} from "@/lib/library/submission";
import type { AccountIdentity } from "@/lib/server/auth";
import {
  beginLibraryExecution,
  BlueprintFlowError,
  finishLibraryExecution,
} from "@/lib/server/blueprint/service";
import { heliusRpc, openAiStructured } from "@/lib/server/blueprint/providers";
import { databaseFailure, getSql } from "@/lib/server/db";

export type LibraryCard = {
  id: string;
  name: string;
  description: string;
  origin: LibraryOrigin;
  originatorLabel: string;
  versionId: string;
  versionNumber: number;
  contentHash: string;
  capabilities: string[];
};

export type LibraryDetail = LibraryCard & {
  inputs: ReturnType<typeof publicInputs>;
  steps: Array<{ id: string; op: string }>;
  outputs: ReturnType<typeof publicOutputs>;
  versions: Array<{ id: string; versionNumber: number; contentHash: string }>;
  blueprint: Blueprint;
};

type StoredVersion = {
  sdk_id: string;
  origin: LibraryOrigin;
  originator_account_id: string | null;
  originator_label: string;
  name: string;
  description: string;
  version_id: string;
  version_number: number;
  content_hash: string;
  blueprint: Blueprint;
};

export async function listPublished(input: {
  q?: string | null;
  origin?: string | null;
  page?: string | null;
}): Promise<{ query: LibraryQuery; listings: LibraryCard[]; nextPage: number | null }> {
  const query = libraryQuery(input);
  const pattern = ilikePattern(query.q);
  const rows = await guard(() =>
    getSql()<
      {
        id: string;
        name: string;
        description: string;
        origin: LibraryOrigin;
        originator_label: string;
        version_id: string;
        version_number: number;
        content_hash: string;
        capabilities: unknown;
      }[]
    >`
      select
        library_sdks.id,
        library_sdks.name,
        library_sdks.description,
        library_sdks.origin,
        library_sdks.originator_label,
        library_versions.id as version_id,
        library_versions.version_number,
        library_versions.content_hash,
        library_versions.blueprint -> 'capabilities' as capabilities
      from library_sdks
      join library_versions on library_versions.id = library_sdks.current_version_id
      where library_sdks.status = 'published'
        and (${query.origin}::text is null or library_sdks.origin = ${query.origin})
        and (
          ${pattern}::text is null
          or library_sdks.name ilike ${pattern} escape '\\'
          or library_sdks.description ilike ${pattern} escape '\\'
        )
      order by library_sdks.updated_at desc, library_sdks.id desc
      limit ${query.limit + 1}
      offset ${query.offset}
    `,
  );
  const page = rows.slice(0, query.limit).map(cardFromRow);
  return {
    query,
    listings: page,
    nextPage: rows.length > query.limit ? query.page + 1 : null,
  };
}

export async function readPublished(sdkId: string, versionId?: string | null): Promise<LibraryDetail> {
  if (!isPublicId(sdkId)) throw new BlueprintFlowError(404, "library_not_found");
  if (versionId && !isPublicId(versionId)) throw new BlueprintFlowError(404, "library_not_found");
  const version = await guard(() => loadVersion(sdkId, versionId ?? null));
  const versions = await guard(() => listVersionSummaries(sdkId));
  return detailFrom(version, versions);
}

export async function testPublishedSdk(input: {
  account: AccountIdentity;
  sdkId: string;
  versionId?: string | null;
  values: unknown;
}) {
  const version = await publishedVersion(input.sdkId, input.versionId ?? null);
  const validated = validateBlueprint(version.blueprint);
  if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
  const hash = contentHash(validated.blueprint);
  if (hash !== version.content_hash) throw new BlueprintFlowError(400, "blueprint_invalid");
  const inputs = validateInputsAgainst(validated.blueprint, input.values);
  if (!inputs.ok) throw new BlueprintFlowError(400, inputs.issues[0]?.code ?? "inputs");
  const aiSteps = validated.blueprint.steps.filter(
    (step) => step.op === "ai.generate" || step.op === "ai.analyze",
  ).length;
  const reserved = await beginLibraryExecution({
    accountId: input.account.id,
    libraryVersionId: version.version_id,
    aiSteps,
  });
  const started = Date.now();
  try {
    const result = await runBlueprint({
      blueprint: validated.blueprint,
      values: inputs.values,
      startedAt: started,
      ports: { now: () => Date.now(), openai: openAiStructured, helius: heliusRpc },
    });
    await finishLibraryExecution(reserved.executionId, result);
    return {
      executionId: reserved.executionId,
      versionId: version.version_id,
      contentHash: hash,
      status: result.status,
      output: result.output ?? null,
      errorCode: result.errorCode ?? null,
      durationMs: result.durationMs,
      traces: result.traces,
    };
  } catch (error) {
    const code = error instanceof BlueprintFlowError ? error.code : "provider";
    await finishLibraryExecution(reserved.executionId, {
      status: code === "timeout" ? "TIMEOUT" : "FAILED",
      errorCode: code,
      traces: [],
      durationMs: Date.now() - started,
      openaiRequests: 0,
      heliusRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    if (error instanceof BlueprintFlowError) throw error;
    throw new BlueprintFlowError(503, "provider");
  }
}

export async function remixPublishedSdk(input: {
  account: AccountIdentity;
  sdkId: string;
  versionId?: string | null;
}) {
  const version = await publishedVersion(input.sdkId, input.versionId ?? null);
  const validated = validateBlueprint(version.blueprint);
  if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
  const hash = contentHash(validated.blueprint);
  const copy = remixCopy({
    remixerAccountId: input.account.id,
    source: {
      sdkId: version.sdk_id,
      versionId: version.version_id,
      contentHash: version.content_hash,
      blueprintHash: hash,
      originatorAccountId: version.originator_account_id,
      originatorLabel: version.originator_label,
    },
  });
  if (!copy.ok) throw new BlueprintFlowError(400, copy.code);
  const blueprint = validated.blueprint;
  const created = await guard(() =>
    getSql().begin(async (tx) => {
      const drafts = await tx<{ id: string }[]>`
        insert into sdk_drafts (
          account_id,
          name,
          description,
          working_blueprint,
          content_hash,
          source_sdk_id,
          source_version_id,
          originator_account_id,
          originator_label
        )
        values (
          ${input.account.id},
          ${blueprint.name},
          ${blueprint.description},
          ${tx.json(jsonValue(blueprint))},
          ${copy.contentHash},
          ${copy.sourceSdkId},
          ${copy.sourceVersionId},
          ${copy.originatorAccountId},
          ${copy.originatorLabel}
        )
        returning id
      `;
      const draftId = drafts[0]?.id;
      if (!draftId) throw new BlueprintFlowError(503, "draft_unavailable");
      await tx`
        insert into builder_conversations (draft_id, account_id)
        values (${draftId}, ${input.account.id})
      `;
      const conversation = await tx<{ id: string }[]>`
        select id from builder_conversations
        where draft_id = ${draftId} and account_id = ${input.account.id}
      `;
      const conversationId = conversation[0]?.id;
      if (!conversationId) throw new BlueprintFlowError(503, "conversation_unavailable");
      await tx`
        insert into builder_messages (conversation_id, account_id, role, content, failed)
        values (
          ${conversationId},
          ${input.account.id},
          'assistant',
          ${`Remixed from ${blueprint.name}. The published source stays unchanged.`},
          false
        )
      `;
      return draftId;
    }),
  );
  return {
    draftId: created,
    saved: false as const,
    published: false as const,
    sourceSdkId: copy.sourceSdkId,
    sourceVersionId: copy.sourceVersionId,
    originatorLabel: copy.originatorLabel,
  };
}

export async function publishLibraryVersion(input: {
  origin: LibraryOrigin;
  name: string;
  description: string;
  blueprint: unknown;
  originatorLabel: string;
  originatorAccountId?: string | null;
  creatorAccountId?: string | null;
  parentSdkId?: string | null;
  sdkId?: string | null;
  listingId?: string | null;
  reviewed?: boolean;
}): Promise<{ sdkId: string; versionId: string; versionNumber: number; contentHash: string; created: boolean }> {
  const named = parseSdkIdentity(input.name, input.description);
  if (!named.ok) throw new BlueprintFlowError(400, named.code);
  if (!originAllowsName(input.origin, named.name)) throw new BlueprintFlowError(400, "name");
  if (input.origin === "community" && input.reviewed !== true) {
    throw new BlueprintFlowError(400, "review_required");
  }
  const label = input.originatorLabel.trim();
  if (label.length < 1 || label.length > 80) throw new BlueprintFlowError(400, "name");
  const validated = validateBlueprint(input.blueprint);
  if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
  const hash = contentHash(validated.blueprint);
  return guard(() =>
    getSql().begin((tx) =>
      writeLibraryPublication(tx, {
        origin: input.origin,
        named,
        label,
        blueprint: validated.blueprint,
        hash,
        originatorAccountId: input.originatorAccountId ?? null,
        creatorAccountId: input.creatorAccountId ?? null,
        parentSdkId: input.parentSdkId ?? null,
        sdkId: input.sdkId ?? null,
        listingId: input.listingId ?? null,
      }),
    ),
  );
}

type LibraryTx = postgres.TransactionSql;

async function writeLibraryPublication(
  tx: LibraryTx,
  input: {
    origin: LibraryOrigin;
    named: { name: string; description: string };
    label: string;
    blueprint: Blueprint;
    hash: string;
    originatorAccountId: string | null;
    creatorAccountId: string | null;
    parentSdkId: string | null;
    sdkId: string | null;
    listingId: string | null;
  },
): Promise<{ sdkId: string; versionId: string; versionNumber: number; contentHash: string; created: boolean }> {
  let sdkId = input.sdkId;
  const txBody = tx;
  if (sdkId) {
        if (!isPublicId(sdkId)) throw new BlueprintFlowError(404, "library_not_found");
        const existing = await txBody<{ id: string; origin: LibraryOrigin }[]>`
          select id, origin from library_sdks where id = ${sdkId} for update
        `;
        const listing = existing[0];
        if (!listing || listing.origin !== input.origin) throw new BlueprintFlowError(404, "library_not_found");
      }
      const versions = sdkId
        ? await txBody<{ version_number: number; content_hash: string; id: string }[]>`
            select id, version_number, content_hash
            from library_versions
            where sdk_id = ${sdkId}
            order by version_number asc
          `
        : [];
      const decision = nextLibraryVersion({
        validated: true,
        hash: input.hash,
        versions: versions.map((version) => ({
          versionNumber: version.version_number,
          contentHash: version.content_hash,
        })),
      });
      if (decision.action === "reject") throw new BlueprintFlowError(400, "blueprint_invalid");
      if (decision.action === "reuse") {
        const current = versions.find((version) => version.content_hash === input.hash);
        if (!current) throw new BlueprintFlowError(503, "version_unavailable");
        return {
          sdkId: sdkId ?? "",
          versionId: current.id,
          versionNumber: current.version_number,
          contentHash: input.hash,
          created: false,
        };
      }
      if (!sdkId) {
        const listingId = input.listingId ?? null;
        if (listingId && !isPublicId(listingId)) throw new BlueprintFlowError(400, "blueprint_invalid");
        const createdSdk = listingId
          ? await txBody<{ id: string }[]>`
              insert into library_sdks (
                id, origin, status, creator_account_id, originator_account_id, originator_label,
                parent_sdk_id, name, description
              )
              values (
                ${listingId},
                ${input.origin},
                'published',
                ${input.creatorAccountId ?? null},
                ${input.originatorAccountId ?? null},
                ${input.label},
                ${input.parentSdkId ?? null},
                ${input.named.name},
                ${input.named.description}
              )
              returning id
            `
          : await txBody<{ id: string }[]>`
              insert into library_sdks (
                origin, status, creator_account_id, originator_account_id, originator_label,
                parent_sdk_id, name, description
              )
              values (
                ${input.origin},
                'published',
                ${input.creatorAccountId ?? null},
                ${input.originatorAccountId ?? null},
                ${input.label},
                ${input.parentSdkId ?? null},
                ${input.named.name},
                ${input.named.description}
              )
              returning id
            `;
        sdkId = createdSdk[0]?.id ?? null;
        if (!sdkId) throw new BlueprintFlowError(503, "draft_unavailable");
      }
      const createdVersion = await txBody<{ id: string }[]>`
        insert into library_versions (sdk_id, version_number, content_hash, blueprint)
        values (${sdkId}, ${decision.versionNumber}, ${input.hash}, ${txBody.json(jsonValue(input.blueprint))})
        returning id
      `;
      const versionId = createdVersion[0]?.id;
      if (!versionId) throw new BlueprintFlowError(503, "version_unavailable");
      await txBody`
        update library_sdks
        set current_version_id = ${versionId},
            name = ${input.named.name},
            description = ${input.named.description},
            updated_at = now()
        where id = ${sdkId}
      `;
      return {
        sdkId,
        versionId,
        versionNumber: decision.versionNumber,
        contentHash: input.hash,
        created: true,
      };
}

export type CommunitySubmissionRecord = {
  id: string;
  status: "pending" | "approved" | "rejected";
  contentHash: string;
  originatorLabel: string;
  submitterIsOriginator: boolean;
  librarySdkId: string | null;
  note: string | null;
  remaining: number;
  created: boolean;
};

export async function listOwnSubmissions(account: AccountIdentity): Promise<{
  remaining: number;
  submissions: Array<{
    draftId: string;
    contentHash: string;
    status: "pending" | "approved" | "rejected";
    note: string | null;
    librarySdkId: string | null;
  }>;
}> {
  return guard(async () => {
    const day = utcDay();
    const usage = await getSql()<{ community_submissions: number }[]>`
      select community_submissions
      from usage_daily
      where account_id = ${account.id} and day = ${day}
    `;
    const rows = await getSql()<
      {
        draft_id: string;
        content_hash: string;
        status: "pending" | "approved" | "rejected";
        review_note: string | null;
        library_sdk_id: string | null;
      }[]
    >`
      select draft_id, content_hash, status, review_note, library_sdk_id
      from library_submissions
      where account_id = ${account.id}
      order by created_at desc
    `;
    return {
      remaining: Math.max(0, 3 - (usage[0]?.community_submissions ?? 0)),
      submissions: rows.map((row) => ({
        draftId: row.draft_id,
        contentHash: row.content_hash,
        status: row.status,
        note: row.review_note,
        librarySdkId: row.library_sdk_id,
      })),
    };
  });
}

export async function createCommunitySubmission(input: {
  account: AccountIdentity;
  draftId: string;
}): Promise<CommunitySubmissionRecord> {
  if (!isPublicId(input.draftId)) throw new BlueprintFlowError(404, "draft_not_found");
  return guard(() =>
    getSql().begin(async (tx) => {
      const drafts = await tx<
        {
          id: string;
          saved_at: Date | null;
          deleted_at: Date | null;
          saved_name: string | null;
          saved_description: string | null;
          saved_hash: string | null;
          originator_account_id: string | null;
          originator_label: string | null;
          source_sdk_id: string | null;
          source_version_id: string | null;
        }[]
      >`
        select
          id, saved_at, deleted_at, saved_name, saved_description, saved_hash,
          originator_account_id, originator_label, source_sdk_id, source_version_id
        from sdk_drafts
        where id = ${input.draftId} and account_id = ${input.account.id}
        for update
      `;
      const draft = drafts[0];
      if (!draft || draft.deleted_at) throw new BlueprintFlowError(404, "draft_not_found");
      const savedHash = draft.saved_hash;
      if (!savedHash) throw new BlueprintFlowError(400, "unsaved");
      const existing = await tx<
        {
          id: string;
          status: "pending" | "approved" | "rejected";
          content_hash: string;
          originator_label: string;
          originator_account_id: string | null;
          library_sdk_id: string | null;
          review_note: string | null;
        }[]
      >`
        select id, status, content_hash, originator_label, originator_account_id, library_sdk_id, review_note
        from library_submissions
        where draft_id = ${draft.id} and content_hash = ${savedHash}
      `;
      const day = utcDay();
      await tx`
        insert into usage_daily (account_id, day)
        values (${input.account.id}, ${day})
        on conflict (account_id, day) do nothing
      `;
      const usage = await tx<{ community_submissions: number }[]>`
        select community_submissions
        from usage_daily
        where account_id = ${input.account.id} and day = ${day}
        for update
      `;
      const used = usage[0]?.community_submissions ?? 0;
      const prior = existing[0];
      const quota = submissionQuota({ usedToday: used, sameRevisionExists: Boolean(prior) });
      if (prior) {
        return storedSubmission(prior, input.account.id, quota.action === "reject" ? 0 : quota.remaining, false);
      }
      if (quota.action === "reject") throw new BlueprintFlowError(429, "submission_quota");
      const versions = await tx<{ id: string; blueprint: Blueprint; content_hash: string }[]>`
        select blueprint_versions.id, blueprint_versions.blueprint, blueprint_versions.content_hash
        from blueprint_versions
        join executions on executions.version_id = blueprint_versions.id
        where blueprint_versions.draft_id = ${draft.id}
          and blueprint_versions.content_hash = ${savedHash}
          and executions.account_id = ${input.account.id}
          and executions.status = 'SUCCESS'
        limit 1
      `;
      const version = versions[0];
      const validated = version ? validateBlueprint(version.blueprint) : null;
      const hash = validated?.ok ? contentHash(validated.blueprint) : "";
      const eligible = submissionEligibility({
        owner: true,
        saved: draft.saved_at !== null,
        deleted: false,
        tested: Boolean(version) && hash === savedHash,
        validated: Boolean(validated?.ok) && hash === version?.content_hash,
      });
      if (!eligible.ok) throw new BlueprintFlowError(400, eligible.code);
      if (!validated?.ok || !version) throw new BlueprintFlowError(400, "blueprint_invalid");
      const named = parseSdkIdentity(draft.saved_name ?? "", draft.saved_description ?? "");
      if (!named.ok) throw new BlueprintFlowError(400, named.code);
      if (!originAllowsName("community", named.name)) throw new BlueprintFlowError(400, "reserved_name");
      const originator = trustedOriginator({
        ownerAccountId: input.account.id,
        ownerLabel: developerLabel(input.account.walletAddress),
        lineageAccountId: draft.originator_account_id,
        lineageLabel: draft.originator_label,
      });
      const inserted = await tx<{ id: string }[]>`
        insert into library_submissions (
          account_id, draft_id, version_id, content_hash, blueprint, name, description,
          originator_account_id, originator_label, source_sdk_id, source_version_id, status
        )
        values (
          ${input.account.id},
          ${draft.id},
          ${version.id},
          ${hash},
          ${tx.json(jsonValue(validated.blueprint))},
          ${named.name},
          ${named.description},
          ${originator.accountId},
          ${originator.label},
          ${draft.source_sdk_id},
          ${draft.source_version_id},
          'pending'
        )
        returning id
      `;
      const id = inserted[0]?.id;
      if (!id) throw new BlueprintFlowError(503, "draft_unavailable");
      await tx`
        update usage_daily
        set community_submissions = community_submissions + 1
        where account_id = ${input.account.id} and day = ${day}
      `;
      return {
        id,
        status: "pending" as const,
        contentHash: hash,
        originatorLabel: originator.label,
        submitterIsOriginator: originator.submitterIsOriginator,
        librarySdkId: null,
        note: null,
        remaining: quota.remaining,
        created: true,
      };
    }),
  );
}

export async function listPendingSubmissions(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    originatorLabel: string;
    submitterWallet: string;
    createdAt: string;
    contentHash: string;
    sourceSdkId: string | null;
    sourceVersionId: string | null;
    blueprint: Blueprint;
    executionId: string | null;
    executionFinishedAt: string | null;
  }>
> {
  return guard(async () => {
    const rows = await getSql()<
      {
        id: string;
        name: string;
        description: string;
        originator_label: string;
        wallet_address: string;
        created_at: Date;
        content_hash: string;
        source_sdk_id: string | null;
        source_version_id: string | null;
        blueprint: Blueprint;
        version_id: string;
        account_id: string;
        execution_id: string | null;
        finished_at: Date | null;
      }[]
    >`
      select
        library_submissions.id,
        library_submissions.name,
        library_submissions.description,
        library_submissions.originator_label,
        accounts.wallet_address,
        library_submissions.created_at,
        library_submissions.content_hash,
        library_submissions.source_sdk_id,
        library_submissions.source_version_id,
        library_submissions.blueprint,
        library_submissions.version_id,
        library_submissions.account_id,
        evidence.id as execution_id,
        evidence.finished_at
      from library_submissions
      join accounts on accounts.id = library_submissions.account_id
      left join lateral (
        select id, finished_at
        from executions
        where executions.version_id = library_submissions.version_id
          and executions.account_id = library_submissions.account_id
          and executions.status = 'SUCCESS'
        order by executions.finished_at desc nulls last
        limit 1
      ) evidence on true
      where library_submissions.status = 'pending'
      order by library_submissions.created_at asc, library_submissions.id asc
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      originatorLabel: row.originator_label,
      submitterWallet: row.wallet_address,
      createdAt: row.created_at.toISOString(),
      contentHash: row.content_hash,
      sourceSdkId: row.source_sdk_id,
      sourceVersionId: row.source_version_id,
      blueprint: row.blueprint,
      executionId: row.execution_id,
      executionFinishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    }));
  });
}

export async function approveCommunitySubmission(input: {
  reviewer: AccountIdentity;
  submissionId: string;
}): Promise<{ librarySdkId: string; libraryVersionId: string; created: boolean }> {
  if (!isPublicId(input.submissionId)) throw new BlueprintFlowError(404, "library_not_found");
  return guard(() =>
    getSql().begin(async (tx) => {
      const rows = await tx<
        {
          id: string;
          status: "pending" | "approved" | "rejected";
          account_id: string;
          draft_id: string;
          version_id: string;
          content_hash: string;
          blueprint: Blueprint;
          name: string;
          description: string;
          originator_account_id: string | null;
          originator_label: string;
          source_sdk_id: string | null;
          source_version_id: string | null;
          library_sdk_id: string | null;
          library_version_id: string | null;
        }[]
      >`
        select
          id, status, account_id, draft_id, version_id, content_hash, blueprint, name, description,
          originator_account_id, originator_label, source_sdk_id, source_version_id,
          library_sdk_id, library_version_id
        from library_submissions
        where id = ${input.submissionId}
        for update
      `;
      const submission = rows[0];
      if (!submission) throw new BlueprintFlowError(404, "library_not_found");
      const decision = reviewDecision(submission.status, "approve");
      if (decision === "closed") throw new BlueprintFlowError(409, "submission_closed");
      if (decision === "reuse" && submission.library_sdk_id && submission.library_version_id) {
        return {
          librarySdkId: submission.library_sdk_id,
          libraryVersionId: submission.library_version_id,
          created: false,
        };
      }
      const validated = validateBlueprint(submission.blueprint);
      if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
      const hash = contentHash(validated.blueprint);
      if (hash !== submission.content_hash) throw new BlueprintFlowError(400, "blueprint_invalid");
      if (!originAllowsName("community", submission.name)) throw new BlueprintFlowError(400, "reserved_name");
      const proof = await tx<{ id: string }[]>`
        select id
        from executions
        where version_id = ${submission.version_id}
          and account_id = ${submission.account_id}
          and status = 'SUCCESS'
        limit 1
      `;
      if (!proof[0]) throw new BlueprintFlowError(400, "test_required");
      const prior = await tx<{ library_sdk_id: string }[]>`
        select library_sdk_id
        from library_submissions
        where draft_id = ${submission.draft_id}
          and status = 'approved'
          and library_sdk_id is not null
        order by reviewed_at desc
        limit 1
      `;
      const named = parseSdkIdentity(submission.name, submission.description);
      if (!named.ok) throw new BlueprintFlowError(400, named.code);
      const published = await writeLibraryPublication(tx, {
        origin: "community",
        named,
        label: submission.originator_label,
        blueprint: validated.blueprint,
        hash,
        originatorAccountId: submission.originator_account_id,
        creatorAccountId: submission.account_id,
        parentSdkId: submission.source_sdk_id,
        sdkId: prior[0]?.library_sdk_id ?? null,
        listingId: null,
      });
      const updated = await tx<{ library_sdk_id: string; library_version_id: string }[]>`
        update library_submissions
        set status = 'approved',
            reviewed_at = now(),
            reviewer_account_id = ${input.reviewer.id},
            library_sdk_id = ${published.sdkId},
            library_version_id = ${published.versionId}
        where id = ${submission.id} and status = 'pending'
        returning library_sdk_id, library_version_id
      `;
      const row = updated[0];
      if (!row) throw new BlueprintFlowError(409, "submission_closed");
      return { librarySdkId: row.library_sdk_id, libraryVersionId: row.library_version_id, created: published.created };
    }),
  );
}

export async function rejectCommunitySubmission(input: {
  reviewer: AccountIdentity;
  submissionId: string;
  note: string;
}): Promise<{ status: "rejected"; note: string }> {
  if (!isPublicId(input.submissionId)) throw new BlueprintFlowError(404, "library_not_found");
  const note = input.note.trim();
  if (note.length < 1 || note.length > 500) throw new BlueprintFlowError(400, "review_note");
  return guard(() =>
    getSql().begin(async (tx) => {
      const rows = await tx<
        { id: string; status: "pending" | "approved" | "rejected"; review_note: string | null }[]
      >`
        select id, status, review_note
        from library_submissions
        where id = ${input.submissionId}
        for update
      `;
      const submission = rows[0];
      if (!submission) throw new BlueprintFlowError(404, "library_not_found");
      const decision = reviewDecision(submission.status, "reject");
      if (decision === "closed") throw new BlueprintFlowError(409, "submission_closed");
      if (decision === "reuse") return { status: "rejected" as const, note: submission.review_note ?? note };
      const updated = await tx<{ review_note: string }[]>`
        update library_submissions
        set status = 'rejected',
            reviewed_at = now(),
            reviewer_account_id = ${input.reviewer.id},
            review_note = ${note}
        where id = ${submission.id} and status = 'pending'
        returning review_note
      `;
      const row = updated[0];
      if (!row?.review_note) throw new BlueprintFlowError(409, "submission_closed");
      return { status: "rejected" as const, note: row.review_note };
    }),
  );
}

function storedSubmission(
  row: {
    id: string;
    status: "pending" | "approved" | "rejected";
    content_hash: string;
    originator_label: string;
    originator_account_id: string | null;
    library_sdk_id: string | null;
    review_note: string | null;
  },
  accountId: string,
  remaining: number,
  created: boolean,
): CommunitySubmissionRecord {
  return {
    id: row.id,
    status: row.status,
    contentHash: row.content_hash,
    originatorLabel: row.originator_label,
    submitterIsOriginator: row.originator_account_id === accountId,
    librarySdkId: row.library_sdk_id,
    note: row.review_note,
    remaining,
    created,
  };
}

export async function seedOfficialSdks(account: AccountIdentity): Promise<{
  listings: Array<{
    name: string;
    id: string;
    action: "create" | "reuse" | "attach" | "reject";
    code: string | null;
    versionId: string | null;
    versionNumber: number | null;
    contentHash: string | null;
  }>;
}> {
  const listings = [];
  for (const sdk of OFFICIAL_SDKS) {
    const validated = validateBlueprint(sdk.blueprint);
    if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
    const hash = contentHash(validated.blueprint);
    const rows = await guard(() =>
      getSql()<
        { id: string; name: string; content_hash: string | null }[]
      >`
        select library_sdks.id, library_sdks.name, library_versions.content_hash
        from library_sdks
        left join library_versions on library_versions.id = library_sdks.current_version_id
        where library_sdks.origin = 'official'
          and (library_sdks.name = ${sdk.name} or library_sdks.id = ${sdk.id}::uuid)
      `,
    );
    const existing = rows.length === 1 ? rows[0] : null;
    if (rows.length > 1 || (existing && existing.name !== sdk.name)) {
      listings.push(seedRow(sdk.name, sdk.id, "reject", "official_id"));
      continue;
    }
    const plan = officialSeedPlan({
      existing: existing ? { id: existing.id, contentHash: existing.content_hash } : null,
      sdk: { id: sdk.id, contentHash: hash },
    });
    if (plan.action === "reject") {
      listings.push(seedRow(sdk.name, sdk.id, "reject", plan.code));
      continue;
    }
    const published = await publishLibraryVersion({
      origin: "official",
      name: sdk.name,
      description: sdk.description,
      blueprint: validated.blueprint,
      originatorLabel: OFFICIAL_ORIGINATOR_LABEL,
      originatorAccountId: account.id,
      creatorAccountId: account.id,
      sdkId: plan.action === "create" ? null : sdk.id,
      listingId: plan.action === "create" ? sdk.id : null,
    });
    listings.push({
      name: sdk.name,
      id: published.sdkId,
      action: plan.action,
      code: null,
      versionId: published.versionId,
      versionNumber: published.versionNumber,
      contentHash: published.contentHash,
    });
  }
  return { listings };
}

function seedRow(
  name: string,
  id: string,
  action: "reject",
  code: string,
): {
  name: string;
  id: string;
  action: "reject";
  code: string;
  versionId: null;
  versionNumber: null;
  contentHash: null;
} {
  return { name, id, action, code, versionId: null, versionNumber: null, contentHash: null };
}

async function publishedVersion(sdkId: string, versionId: string | null): Promise<StoredVersion> {
  if (!isPublicId(sdkId) || (versionId !== null && !isPublicId(versionId))) {
    throw new BlueprintFlowError(404, "library_not_found");
  }
  return guard(() => loadVersion(sdkId, versionId));
}

async function loadVersion(sdkId: string, versionId: string | null): Promise<StoredVersion> {
  const rows = await getSql()<StoredVersion[]>`
    select
      library_sdks.id as sdk_id,
      library_sdks.origin,
      library_sdks.originator_account_id,
      library_sdks.originator_label,
      library_sdks.name,
      library_sdks.description,
      library_versions.id as version_id,
      library_versions.version_number,
      library_versions.content_hash,
      library_versions.blueprint
    from library_sdks
    join library_versions on library_versions.sdk_id = library_sdks.id
    where library_sdks.id = ${sdkId}
      and library_sdks.status = 'published'
      and (
        (${versionId}::uuid is null and library_versions.id = library_sdks.current_version_id)
        or library_versions.id = ${versionId}::uuid
      )
    limit 1
  `;
  const version = rows[0];
  if (!version) throw new BlueprintFlowError(404, "library_not_found");
  return version;
}

async function listVersionSummaries(sdkId: string) {
  return getSql()<
    { id: string; version_number: number; content_hash: string }[]
  >`
    select id, version_number, content_hash
    from library_versions
    where sdk_id = ${sdkId}
    order by version_number desc
  `;
}

function detailFrom(
  version: StoredVersion,
  versions: Array<{ id: string; version_number: number; content_hash: string }>,
): LibraryDetail {
  const blueprint = version.blueprint;
  return {
    ...cardFromVersion(version),
    inputs: publicInputs(blueprint),
    steps: blueprint.steps.map((step) => ({ id: step.id, op: step.op })),
    outputs: publicOutputs(blueprint),
    versions: versions.map((item) => ({
      id: item.id,
      versionNumber: item.version_number,
      contentHash: item.content_hash,
    })),
    blueprint,
  };
}

function cardFromRow(row: {
  id: string;
  name: string;
  description: string;
  origin: LibraryOrigin;
  originator_label: string;
  version_id: string;
  version_number: number;
  content_hash: string;
  capabilities: unknown;
}): LibraryCard {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    origin: row.origin,
    originatorLabel: row.originator_label,
    versionId: row.version_id,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function cardFromVersion(version: StoredVersion): LibraryCard {
  return cardFromRow({
    id: version.sdk_id,
    name: version.name,
    description: version.description,
    origin: version.origin,
    originator_label: version.originator_label,
    version_id: version.version_id,
    version_number: version.version_number,
    content_hash: version.content_hash,
    capabilities: version.blueprint.capabilities,
  });
}

function jsonValue(value: unknown): Parameters<ReturnType<typeof getSql>["json"]>[0] {
  return JSON.parse(JSON.stringify(value)) as Parameters<ReturnType<typeof getSql>["json"]>[0];
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BlueprintFlowError) throw error;
    const failure = databaseFailure(error);
    throw new BlueprintFlowError(503, failure === "missing_schema" ? "schema_missing" : "database_unavailable");
  }
}
