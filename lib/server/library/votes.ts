import "server-only";

import type postgres from "postgres";

import { isPublicId } from "@/lib/library/library";
import { libraryVoteDecision } from "@/lib/library/votes";
import type { AccountIdentity } from "@/lib/server/auth";
import { BlueprintFlowError } from "@/lib/server/blueprint/service";
import { databaseFailure, getSql } from "@/lib/server/db";

export type LibraryVote = {
  count: number;
  voted: boolean;
  retryAt: string | null;
};

type VoteRow = {
  count: number;
  last_vote_at: Date | string | null;
  now: Date | string;
};

type VoteQuery = postgres.Sql | postgres.TransactionSql;

export async function readLibraryVote(sdkId: string, accountId: string | null): Promise<LibraryVote> {
  if (!isPublicId(sdkId)) throw new BlueprintFlowError(404, "library_not_found");
  if (accountId && !isPublicId(accountId)) throw new BlueprintFlowError(400, "vote");
  return guard(() => voteSnapshot(getSql(), sdkId, accountId));
}

export async function castLibraryVote(input: {
  account: AccountIdentity;
  sdkId: string;
}): Promise<LibraryVote & { accepted: boolean }> {
  if (!isPublicId(input.sdkId)) throw new BlueprintFlowError(404, "library_not_found");
  return guard(() =>
    getSql().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${input.account.id}), hashtext(${input.sdkId}))`;
      const published = await tx<{ id: string }[]>`
        select id
        from library_sdks
        where id = ${input.sdkId}::uuid and status = 'published'
      `;
      if (!published[0]) throw new BlueprintFlowError(404, "library_not_found");
      const inserted = await tx<{ id: string }[]>`
        insert into library_sdk_votes (sdk_id, account_id)
        select ${input.sdkId}::uuid, ${input.account.id}::uuid
        where not exists (
          select 1
          from library_sdk_votes
          where sdk_id = ${input.sdkId}::uuid
            and account_id = ${input.account.id}::uuid
            and created_at > now() - interval '24 hours'
        )
        returning id
      `;
      const vote = await voteSnapshot(tx, input.sdkId, input.account.id);
      return { ...vote, accepted: inserted.length === 1 };
    }),
  );
}

async function voteSnapshot(sql: VoteQuery, sdkId: string, accountId: string | null): Promise<LibraryVote> {
  const rows = await sql<VoteRow[]>`
    select
      (select count(*)::int from library_sdk_votes where sdk_id = ${sdkId}::uuid) as count,
      (
        select max(created_at)
        from library_sdk_votes
        where sdk_id = ${sdkId}::uuid
          and ${accountId}::uuid is not null
          and account_id = ${accountId}::uuid
      ) as last_vote_at,
      now() as now
  `;
  const row = rows[0];
  const last = row?.last_vote_at ? new Date(row.last_vote_at).getTime() : null;
  const decision = libraryVoteDecision({
    now: row?.now ? new Date(row.now).getTime() : Date.now(),
    lastVoteAt: last !== null && Number.isFinite(last) ? last : null,
  });
  return {
    count: row?.count ?? 0,
    voted: decision.action === "wait",
    retryAt: decision.action === "wait" ? new Date(decision.retryAt).toISOString() : null,
  };
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
