import "server-only";

import { compileProposal, revisionTurns } from "@/lib/blueprint/compile";
import { runBlueprint } from "@/lib/blueprint/execute";
import { contentHash } from "@/lib/blueprint/json";
import {
  ACCOUNT_DAILY_USD,
  BUILDER_MESSAGES_PER_DAY,
  GLOBAL_DAILY_USD,
  MAX_BUILDER_MESSAGE_CHARS,
  MAX_CONCURRENT_RUNS,
  MAX_DRAFTS,
  OPENAI_RESERVE_USD,
  WEBSITE_RUNS_PER_DAY,
  type Blueprint,
} from "@/lib/blueprint/model";
import { deleteDecision, isSameSavedIdentity, parseSdkIdentity, saveAllowed } from "@/lib/blueprint/save";
import { validateBlueprint, validateInputsAgainst } from "@/lib/blueprint/validate";
import type { AccountIdentity } from "@/lib/server/auth";
import { databaseFailure, getSql } from "@/lib/server/db";
import { heliusRpc, openAiProposal, openAiStructured } from "@/lib/server/blueprint/providers";

export class BlueprintFlowError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listDrafts(account: AccountIdentity) {
  return guard(async () => {
    const rows = await getSql()<
      {
        id: string;
        saved_name: string | null;
        saved_description: string | null;
        revision: number;
        updated_at: Date;
        saved_hash: string | null;
        version_id: string | null;
        tested: boolean;
      }[]
    >`
      select
        sdk_drafts.id,
        sdk_drafts.saved_name,
        sdk_drafts.saved_description,
        sdk_drafts.revision,
        sdk_drafts.updated_at,
        sdk_drafts.saved_hash,
        blueprint_versions.id as version_id,
        exists (
          select 1
          from executions
          where executions.draft_id = sdk_drafts.id
            and executions.account_id = sdk_drafts.account_id
            and executions.version_id = blueprint_versions.id
            and executions.status = 'SUCCESS'
        ) as tested
      from sdk_drafts
      left join blueprint_versions
        on blueprint_versions.draft_id = sdk_drafts.id
        and blueprint_versions.content_hash = sdk_drafts.saved_hash
      where sdk_drafts.account_id = ${account.id}
        and sdk_drafts.saved_at is not null
        and sdk_drafts.deleted_at is null
      order by sdk_drafts.saved_at desc
      limit ${MAX_DRAFTS}
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.saved_name ?? "SDK",
      description: row.saved_description ?? "",
      revision: row.revision,
      updatedAt: row.updated_at.toISOString(),
      status: "saved_draft" as const,
      tested: row.tested === true,
      versionId: row.version_id,
      contentHash: row.saved_hash,
    }));
  });
}

export async function readDraft(account: AccountIdentity, draftId: string) {
  assertId(draftId);
  return guard(async () => {
    const draft = await ownedDraft(account.id, draftId);
    const messages = await getSql()<{ role: string; content: string; failed: boolean }[]>`
      select role, content, failed
      from builder_messages
      where conversation_id = (
        select id from builder_conversations where draft_id = ${draftId} and account_id = ${account.id}
      )
      order by created_at asc
      limit 40
    `;
    const run = await latestExecution(account.id, draftId, draft.content_hash);
    const source = await draftSource(account.id, draft.id);
    return {
      id: draft.id,
      revision: draft.revision,
      contentHash: draft.content_hash,
      blueprint: draft.working_blueprint,
      messages,
      source,
      saved: draft.saved_at !== null,
      savedName: draft.saved_name,
      savedDescription: draft.saved_description,
      dirty: draft.saved_hash !== null && draft.saved_hash !== draft.content_hash,
      tested: saveAllowed(draft.content_hash, run?.status === "SUCCESS" ? draft.content_hash : null),
      run,
    };
  });
}

export async function sendBuilderMessage(input: {
  account: AccountIdentity;
  draftId?: string;
  revision?: number;
  message: string;
  onStage?: (stage: "understanding" | "constructing" | "validating") => void;
}) {
  if (input.message.length < 1 || input.message.length > MAX_BUILDER_MESSAGE_CHARS) {
    throw new BlueprintFlowError(400, "message");
  }
  if (input.draftId) assertId(input.draftId);
  input.onStage?.("understanding");
  await guard(() => reserveCount(input.account.id, "builder_messages", BUILDER_MESSAGES_PER_DAY));
  await guard(() => reserveSpend(input.account.id, OPENAI_RESERVE_USD));
  const draft = input.draftId
    ? await guard(() => ownedDraft(input.account.id, input.draftId ?? ""))
    : null;
  const history = draft ? await guard(() => messageHistory(input.account.id, draft.id)) : [];
  const turns = revisionTurns(history, input.message, draft?.working_blueprint ?? null);
  let proposal: unknown;
  try {
    input.onStage?.("constructing");
    proposal = await openAiProposal(turns);
  } catch (error) {
    throw providerError(error);
  }
  input.onStage?.("validating");
  let compiled = compileProposal(proposal);
  if (!compiled.ok) {
    console.error(`[blueprint] generated ${compiled.code} ${compiled.path}`.trim());
    await guard(() => reserveSpend(input.account.id, OPENAI_RESERVE_USD));
    try {
      input.onStage?.("constructing");
      proposal = await openAiProposal([
        ...turns,
        { role: "assistant", content: "The previous blueprint was rejected." },
        {
          role: "user",
          content: `Correct the blueprint. Rejection: ${compiled.code} at ${compiled.path || "blueprint"}. Use lowercase snake_case ids. References must be inputs.<key> or steps.<earlier>.result.`,
        },
      ]);
    } catch (error) {
      throw providerError(error);
    }
    input.onStage?.("validating");
    compiled = compileProposal(proposal);
  }
  if (!compiled.ok) {
    console.error(`[blueprint] generated ${compiled.code} ${compiled.path}`.trim());
    if (input.draftId) {
      await guard(() =>
        recordMessages(input.account.id, input.draftId ?? "", input.message, compiled.ok ? "" : "The blueprint was not valid.", true),
      );
    }
    throw new BlueprintFlowError(400, blueprintFailureCode(compiled.code));
  }
  const blueprint = compiled.blueprint;
  const saved = await guard(() =>
    saveDraft({
      accountId: input.account.id,
      blueprint,
      userMessage: input.message,
      assistantMessage: compiled.reply,
      ...(input.draftId ? { draftId: input.draftId } : {}),
      ...(input.revision !== undefined ? { expectedRevision: input.revision } : {}),
    }),
  );
  return {
    ...saved,
    reply: compiled.reply,
    blueprint,
    contentHash: contentHash(blueprint),
    saved: saved.saved,
    tested: false,
  };
}

export async function saveNamedDraft(input: {
  account: AccountIdentity;
  draftId: string;
  name: string;
  description: string;
}) {
  assertId(input.draftId);
  const named = parseSdkIdentity(input.name, input.description);
  if (!named.ok) throw new BlueprintFlowError(400, named.code);
  return guard(() =>
    getSql().begin(async (tx) => {
      const rows = await tx<
        {
          id: string;
          working_blueprint: Blueprint;
          content_hash: string;
          saved_at: Date | null;
          saved_name: string | null;
          saved_description: string | null;
          saved_hash: string | null;
        }[]
      >`
        select id, working_blueprint, content_hash, saved_at, saved_name, saved_description, saved_hash
        from sdk_drafts
        where id = ${input.draftId}
          and account_id = ${input.account.id}
          and deleted_at is null
        for update
      `;
      const draft = rows[0];
      if (!draft) throw new BlueprintFlowError(404, "draft_not_found");
      const validated = validateBlueprint(draft.working_blueprint);
      if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
      const hash = contentHash(validated.blueprint);
      if (hash !== draft.content_hash) throw new BlueprintFlowError(400, "blueprint_invalid");
      if (
        isSameSavedIdentity(
          {
            savedHash: draft.saved_hash,
            savedName: draft.saved_name,
            savedDescription: draft.saved_description,
          },
          { hash, name: named.name, description: named.description },
        )
      ) {
        return { draftId: draft.id, name: named.name, description: named.description, saved: true };
      }
      const success = await tx<{ id: string }[]>`
        select executions.id
        from executions
        join blueprint_versions on blueprint_versions.id = executions.version_id
        where executions.draft_id = ${draft.id}
          and executions.account_id = ${input.account.id}
          and executions.status = 'SUCCESS'
          and blueprint_versions.content_hash = ${hash}
        limit 1
      `;
      if (!success[0] || !saveAllowed(hash, hash)) throw new BlueprintFlowError(400, "test_required");
      if (draft.saved_at === null) {
        const count = await tx<{ count: number }[]>`
          select count(*)::int as count
          from sdk_drafts
          where account_id = ${input.account.id}
            and saved_at is not null
            and deleted_at is null
            and id <> ${draft.id}
        `;
        if ((count[0]?.count ?? 0) >= MAX_DRAFTS) throw new BlueprintFlowError(429, "draft_limit");
      }
      await tx`
        update sdk_drafts
        set saved_at = now(),
            saved_name = ${named.name},
            saved_description = ${named.description},
            saved_hash = ${hash},
            updated_at = now()
        where id = ${draft.id} and account_id = ${input.account.id}
      `;
      return { draftId: draft.id, name: named.name, description: named.description, saved: true };
    }),
  );
}

export async function deleteSavedDraft(input: { account: AccountIdentity; draftId: string }) {
  assertId(input.draftId);
  return guard(() =>
    getSql().begin(async (tx) => {
      const rows = await tx<{ id: string; saved_at: Date | null; deleted_at: Date | null }[]>`
        select id, saved_at, deleted_at
        from sdk_drafts
        where id = ${input.draftId} and account_id = ${input.account.id}
        for update
      `;
      const draft = rows[0];
      const decision = deleteDecision(
        draft
          ? { owner: true, saved: draft.saved_at !== null, deleted: draft.deleted_at !== null }
          : null,
      );
      if (decision === "reject") throw new BlueprintFlowError(404, "draft_not_found");
      if (decision === "already_deleted") return { draftId: input.draftId, deleted: true };
      const updated = await tx<{ id: string }[]>`
        update sdk_drafts
        set deleted_at = now(), updated_at = now()
        where id = ${input.draftId}
          and account_id = ${input.account.id}
          and saved_at is not null
          and deleted_at is null
        returning id
      `;
      if (!updated[0]) throw new BlueprintFlowError(404, "draft_not_found");
      return { draftId: updated[0].id, deleted: true };
    }),
  );
}

export async function testDraft(input: {
  account: AccountIdentity;
  draftId: string;
  values: unknown;
}) {
  assertId(input.draftId);
  const draft = await guard(() => ownedDraft(input.account.id, input.draftId));
  const validated = validateBlueprint(draft.working_blueprint);
  if (!validated.ok) throw new BlueprintFlowError(400, "blueprint_invalid");
  const inputs = validateInputsAgainst(validated.blueprint, input.values);
  if (!inputs.ok) throw new BlueprintFlowError(400, inputs.issues[0]?.code ?? "inputs");
  const hash = contentHash(validated.blueprint);
  const aiSteps = validated.blueprint.steps.filter(
    (step) => step.op === "ai.generate" || step.op === "ai.analyze",
  ).length;
  if (aiSteps > 0) {
    await guard(() => reserveSpend(input.account.id, aiSteps * OPENAI_RESERVE_USD));
  }
  const reserved = await guard(() =>
    reserveRun({
      accountId: input.account.id,
      draftId: input.draftId,
      hash,
      blueprint: validated.blueprint,
    }),
  );
  const started = Date.now();
  try {
    const result = await runBlueprint({
      blueprint: validated.blueprint,
      values: inputs.values,
      startedAt: started,
      ports: {
        now: () => Date.now(),
        openai: openAiStructured,
        helius: heliusRpc,
      },
    });
    await guard(() => completeRun(reserved.executionId, result));
    return {
      executionId: reserved.executionId,
      versionId: reserved.versionId,
      contentHash: hash,
      status: result.status,
      output: result.output ?? null,
      errorCode: result.errorCode ?? null,
      durationMs: result.durationMs,
      traces: result.traces,
    };
  } catch (error) {
    const code = error instanceof BlueprintFlowError ? error.code : providerCode(error);
    await guard(() =>
      completeRun(reserved.executionId, {
        status: code === "timeout" ? "TIMEOUT" : "FAILED",
        errorCode: code,
        traces: [],
        durationMs: Date.now() - started,
        openaiRequests: 0,
        heliusRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    if (error instanceof BlueprintFlowError) throw error;
    throw providerError(error);
  }
}

async function reserveCount(
  accountId: string,
  column: "builder_messages" | "website_runs",
  limit: number,
): Promise<void> {
  const day = utcDay();
  const rows =
    column === "builder_messages"
      ? await getSql()<{ count: number }[]>`
          insert into usage_daily (account_id, day, builder_messages)
          values (${accountId}, ${day}, 1)
          on conflict (account_id, day) do update
            set builder_messages = usage_daily.builder_messages + 1
            where usage_daily.builder_messages < ${limit}
          returning builder_messages as count
        `
      : await getSql()<{ count: number }[]>`
          insert into usage_daily (account_id, day, website_runs)
          values (${accountId}, ${day}, 1)
          on conflict (account_id, day) do update
            set website_runs = usage_daily.website_runs + 1
            where usage_daily.website_runs < ${limit}
          returning website_runs as count
        `;
  if (!rows[0]) throw new BlueprintFlowError(429, "quota");
}

async function reserveSpend(accountId: string, amount: number): Promise<void> {
  const day = utcDay();
  const global = await getSql()<{ estimated_usd: string }[]>`
    insert into provider_spend_daily (day, estimated_usd)
    values (${day}, ${amount})
    on conflict (day) do update
      set estimated_usd = provider_spend_daily.estimated_usd + ${amount}
      where provider_spend_daily.estimated_usd + ${amount} <= ${GLOBAL_DAILY_USD}
    returning estimated_usd
  `;
  if (!global[0]) throw new BlueprintFlowError(429, "spend_limit");
  const account = await getSql()<{ estimated_usd: string }[]>`
    insert into usage_daily (account_id, day, estimated_usd)
    values (${accountId}, ${day}, ${amount})
    on conflict (account_id, day) do update
      set estimated_usd = usage_daily.estimated_usd + ${amount}
      where usage_daily.estimated_usd + ${amount} <= ${ACCOUNT_DAILY_USD}
    returning estimated_usd
  `;
  if (!account[0]) throw new BlueprintFlowError(429, "spend_limit");
}

export async function beginLibraryExecution(input: {
  accountId: string;
  libraryVersionId: string;
  aiSteps: number;
}): Promise<{ executionId: string }> {
  if (input.aiSteps > 0) {
    await guard(() => reserveSpend(input.accountId, input.aiSteps * OPENAI_RESERVE_USD));
  }
  return guard(() => reserveLibraryRun(input.accountId, input.libraryVersionId));
}

export async function finishLibraryExecution(
  executionId: string,
  result: {
    status: string;
    errorCode?: string;
    output?: unknown;
    traces: Array<{
      stepId: string;
      status: string;
      durationMs: number;
      providerRequests: number;
      errorCode?: string;
    }>;
    durationMs: number;
    openaiRequests: number;
    heliusRequests: number;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await guard(() => completeRun(executionId, result));
}

async function reserveLibraryRun(
  accountId: string,
  libraryVersionId: string,
): Promise<{ executionId: string }> {
  return getSql().begin(async (tx) => {
    const day = utcDay();
    await tx`
      insert into usage_daily (account_id, day)
      values (${accountId}, ${day})
      on conflict (account_id, day) do nothing
    `;
    const usage = await tx<{ website_runs: number }[]>`
      select website_runs
      from usage_daily
      where account_id = ${accountId} and day = ${day}
      for update
    `;
    if ((usage[0]?.website_runs ?? 0) >= WEBSITE_RUNS_PER_DAY) {
      throw new BlueprintFlowError(429, "quota");
    }
    await tx`
      update executions
      set status = 'TIMEOUT', error_code = 'timeout', finished_at = now()
      where account_id = ${accountId}
        and status = 'RUNNING'
        and started_at < now() - interval '70 seconds'
    `;
    const running = await tx<{ count: number }[]>`
      select count(*)::int as count
      from executions
      where account_id = ${accountId} and status = 'RUNNING'
    `;
    if ((running[0]?.count ?? 0) >= MAX_CONCURRENT_RUNS) {
      throw new BlueprintFlowError(429, "concurrency");
    }
    const executions = await tx<{ id: string }[]>`
      insert into executions (account_id, library_version_id, status)
      values (${accountId}, ${libraryVersionId}, 'RUNNING')
      returning id
    `;
    await tx`
      update usage_daily
      set website_runs = website_runs + 1
      where account_id = ${accountId} and day = ${day}
    `;
    const executionId = executions[0]?.id;
    if (!executionId) throw new BlueprintFlowError(503, "execution_unavailable");
    return { executionId };
  });
}

async function reserveRun(input: {
  accountId: string;
  draftId: string;
  hash: string;
  blueprint: Blueprint;
}): Promise<{ executionId: string; versionId: string }> {
  return getSql().begin(async (tx) => {
    const day = utcDay();
    await tx`
      insert into usage_daily (account_id, day)
      values (${input.accountId}, ${day})
      on conflict (account_id, day) do nothing
    `;
    const usage = await tx<{ website_runs: number }[]>`
      select website_runs
      from usage_daily
      where account_id = ${input.accountId} and day = ${day}
      for update
    `;
    const used = usage[0]?.website_runs ?? 0;
    if (used >= WEBSITE_RUNS_PER_DAY) throw new BlueprintFlowError(429, "quota");
    await tx`
      update executions
      set status = 'TIMEOUT', error_code = 'timeout', finished_at = now()
      where account_id = ${input.accountId}
        and status = 'RUNNING'
        and started_at < now() - interval '70 seconds'
    `;
    const running = await tx<{ count: number }[]>`
      select count(*)::int as count
      from executions
      where account_id = ${input.accountId} and status = 'RUNNING'
    `;
    if ((running[0]?.count ?? 0) >= MAX_CONCURRENT_RUNS) {
      throw new BlueprintFlowError(429, "concurrency");
    }
    const versions = await tx<{ id: string }[]>`
      insert into blueprint_versions (draft_id, account_id, content_hash, blueprint)
      values (${input.draftId}, ${input.accountId}, ${input.hash}, ${tx.json(jsonValue(input.blueprint))})
      on conflict (draft_id, content_hash) do update
        set content_hash = excluded.content_hash
      returning id
    `;
    const versionId = versions[0]?.id;
    if (!versionId) throw new BlueprintFlowError(503, "version_unavailable");
    const executions = await tx<{ id: string }[]>`
      insert into executions (account_id, draft_id, version_id, status)
      values (${input.accountId}, ${input.draftId}, ${versionId}, 'RUNNING')
      returning id
    `;
    await tx`
      update usage_daily
      set website_runs = website_runs + 1
      where account_id = ${input.accountId} and day = ${day}
    `;
    const executionId = executions[0]?.id;
    if (!executionId) throw new BlueprintFlowError(503, "execution_unavailable");
    return { executionId, versionId };
  });
}

async function completeRun(
  executionId: string,
  result: {
    status: string;
    errorCode?: string;
    output?: unknown;
    traces: Array<{
      stepId: string;
      status: string;
      durationMs: number;
      providerRequests: number;
      errorCode?: string;
    }>;
    durationMs: number;
    openaiRequests: number;
    heliusRequests: number;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  const sql = getSql();
  await sql`
    update executions
    set status = ${result.status},
        error_code = ${result.errorCode ?? null},
        output = ${result.output === undefined ? null : sql.json(jsonValue(result.output))},
        openai_requests = ${result.openaiRequests},
        helius_requests = ${result.heliusRequests},
        input_tokens = ${result.inputTokens},
        output_tokens = ${result.outputTokens},
        estimated_usd = ${(result.openaiRequests * OPENAI_RESERVE_USD).toFixed(6)},
        finished_at = now()
    where id = ${executionId}
  `;
  for (const [index, trace] of result.traces.entries()) {
    await sql`
      insert into execution_steps (
        execution_id, position, step_id, status, duration_ms, provider_requests, error_code
      )
      values (
        ${executionId},
        ${index},
        ${trace.stepId},
        ${trace.status},
        ${trace.durationMs},
        ${trace.providerRequests},
        ${trace.errorCode ?? null}
      )
    `;
  }
}

async function saveDraft(input: {
  accountId: string;
  draftId?: string;
  expectedRevision?: number;
  blueprint: Blueprint;
  userMessage: string;
  assistantMessage: string;
}): Promise<{ draftId: string; revision: number; saved: boolean }> {
  const hash = contentHash(input.blueprint);
  return getSql().begin(async (tx) => {
    let draftId = input.draftId;
    let revision = 1;
    let saved = false;
    if (!draftId) {
      await tx`
        delete from sdk_drafts
        where account_id = ${input.accountId}
          and saved_at is null
          and deleted_at is null
          and updated_at < now() - interval '24 hours'
      `;
      await tx`
        delete from sdk_drafts
        where id in (
          select id from sdk_drafts
          where account_id = ${input.accountId}
            and saved_at is null
            and deleted_at is null
          order by updated_at desc
          offset 4
        )
      `;
      const created = await tx<{ id: string }[]>`
        insert into sdk_drafts (account_id, name, description, working_blueprint, content_hash)
        values (
          ${input.accountId},
          ${input.blueprint.name},
          ${input.blueprint.description},
          ${tx.json(jsonValue(input.blueprint))},
          ${hash}
        )
        returning id
      `;
      draftId = created[0]?.id;
      if (!draftId) throw new BlueprintFlowError(503, "draft_unavailable");
      await tx`
        insert into builder_conversations (draft_id, account_id)
        values (${draftId}, ${input.accountId})
      `;
    } else {
      const current = await tx<{ revision: number; saved_at: Date | null }[]>`
        select revision, saved_at from sdk_drafts
        where id = ${draftId}
          and account_id = ${input.accountId}
          and deleted_at is null
        for update
      `;
      if (!current[0]) throw new BlueprintFlowError(404, "draft_not_found");
      if (input.expectedRevision !== undefined && current[0].revision !== input.expectedRevision) {
        throw new BlueprintFlowError(409, "revision_conflict");
      }
      saved = current[0].saved_at !== null;
      const updated = await tx<{ revision: number }[]>`
        update sdk_drafts
        set working_blueprint = ${tx.json(jsonValue(input.blueprint))},
            content_hash = ${hash},
            revision = revision + 1,
            updated_at = now()
        where id = ${draftId} and account_id = ${input.accountId}
        returning revision
      `;
      revision = updated[0]?.revision ?? revision;
    }
    const conversation = await tx<{ id: string }[]>`
      select id from builder_conversations
      where draft_id = ${draftId} and account_id = ${input.accountId}
    `;
    const conversationId = conversation[0]?.id;
    if (!conversationId) throw new BlueprintFlowError(503, "conversation_unavailable");
    await tx`
      insert into builder_messages (conversation_id, account_id, role, content, failed)
      values
        (${conversationId}, ${input.accountId}, 'user', ${input.userMessage}, false),
        (${conversationId}, ${input.accountId}, 'assistant', ${input.assistantMessage}, false)
    `;
    return { draftId, revision, saved };
  });
}

async function recordMessages(
  accountId: string,
  draftId: string,
  userMessage: string,
  assistantMessage: string,
  failed: boolean,
): Promise<void> {
  const conversation = await getSql()<{ id: string }[]>`
    select id from builder_conversations
    where draft_id = ${draftId} and account_id = ${accountId}
  `;
  const conversationId = conversation[0]?.id;
  if (!conversationId) return;
  await getSql()`
    insert into builder_messages (conversation_id, account_id, role, content, failed)
    values
      (${conversationId}, ${accountId}, 'user', ${userMessage}, ${failed}),
      (${conversationId}, ${accountId}, 'assistant', ${assistantMessage}, ${failed})
  `;
}

async function messageHistory(accountId: string, draftId: string) {
  await ownedDraft(accountId, draftId);
  const rows = await getSql()<{ role: "user" | "assistant"; content: string }[]>`
    select role, content
    from builder_messages
    where conversation_id = (
      select id from builder_conversations where draft_id = ${draftId} and account_id = ${accountId}
    )
      and failed = false
    order by created_at asc
    limit 20
  `;
  return rows;
}

async function draftSource(accountId: string, draftId: string) {
  try {
    const rows = await getSql()<
      {
        source_sdk_id: string | null;
        source_version_id: string | null;
        originator_label: string | null;
      }[]
    >`
      select source_sdk_id, source_version_id, originator_label
      from sdk_drafts
      where id = ${draftId} and account_id = ${accountId} and deleted_at is null
    `;
    const row = rows[0];
    if (!row?.source_sdk_id || !row.source_version_id || !row.originator_label) return null;
    return {
      sdkId: row.source_sdk_id,
      versionId: row.source_version_id,
      originatorLabel: row.originator_label,
    };
  } catch (error) {
    if (databaseFailure(error) === "missing_schema") return null;
    throw error;
  }
}

async function ownedDraft(accountId: string, draftId: string) {
  const rows = await getSql()<
    {
      id: string;
      revision: number;
      content_hash: string;
      working_blueprint: Blueprint;
      saved_at: Date | null;
      saved_name: string | null;
      saved_description: string | null;
      saved_hash: string | null;
    }[]
  >`
    select id, revision, content_hash, working_blueprint, saved_at, saved_name, saved_description, saved_hash
    from sdk_drafts
    where id = ${draftId}
      and account_id = ${accountId}
      and deleted_at is null
  `;
  const draft = rows[0];
  if (!draft) throw new BlueprintFlowError(404, "draft_not_found");
  return draft;
}

async function latestExecution(accountId: string, draftId: string, hash: string) {
  const rows = await getSql()<
    {
      id: string;
      status: string;
      error_code: string | null;
      output: unknown;
      started_at: Date;
      finished_at: Date | null;
    }[]
  >`
    select executions.id, executions.status, executions.error_code, executions.output,
           executions.started_at, executions.finished_at
    from executions
    join blueprint_versions on blueprint_versions.id = executions.version_id
    where executions.draft_id = ${draftId}
      and executions.account_id = ${accountId}
      and blueprint_versions.content_hash = ${hash}
    order by executions.started_at desc
    limit 1
  `;
  const execution = rows[0];
  if (!execution) return null;
  const steps = await getSql()<
    { step_id: string; status: string; duration_ms: number; error_code: string | null }[]
  >`
    select step_id, status, duration_ms, error_code
    from execution_steps
    where execution_id = ${execution.id}
    order by position asc
  `;
  const finished = execution.finished_at?.getTime() ?? execution.started_at.getTime();
  return {
    executionId: execution.id,
    status: execution.status,
    errorCode: execution.error_code,
    output: execution.output,
    durationMs: Math.max(0, finished - execution.started_at.getTime()),
    traces: steps.map((step) => ({
      stepId: step.step_id,
      status: step.status,
      durationMs: step.duration_ms,
      ...(step.error_code ? { errorCode: step.error_code } : {}),
    })),
  };
}

function assertId(value: string): void {
  if (!UUID.test(value)) throw new BlueprintFlowError(400, "draft_invalid");
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function jsonValue(value: unknown): Parameters<ReturnType<typeof getSql>["json"]>[0] {
  return JSON.parse(JSON.stringify(value)) as Parameters<ReturnType<typeof getSql>["json"]>[0];
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

function providerError(error: unknown): BlueprintFlowError {
  const code = providerCode(error);
  if (code === "provider_unconfigured") return new BlueprintFlowError(503, code);
  if (code === "model_refused") return new BlueprintFlowError(400, code);
  return new BlueprintFlowError(503, "provider");
}

function blueprintFailureCode(code: string): string {
  if (code === "operation") return "unsupported_operation";
  if (
    code === "reference" ||
    code === "forward_reference" ||
    code === "self_reference" ||
    code === "unknown_input"
  ) {
    return "invalid_reference";
  }
  if (
    code === "mode" ||
    code === "transform_action" ||
    code === "task" ||
    code === "config_type" ||
    code === "fields"
  ) {
    return "unsupported_configuration";
  }
  return "blueprint_invalid";
}

function providerCode(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message === "provider_unconfigured") return "provider_unconfigured";
  if (error instanceof Error && error.message === "model_refused") return "model_refused";
  return "provider";
}
