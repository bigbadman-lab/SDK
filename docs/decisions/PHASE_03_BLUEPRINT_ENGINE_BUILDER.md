# Phase 03 — Blueprint engine and Builder

Date: 18 October 2026.

Architecture source: `docs/architecture/SDK_MASTER_ARCHITECTURE_V1_1.md`. This phase does not rewrite that product model. Build and Test only. A tested draft is not a launched product. There is no Publish control, token mint, fee sharing, Feed, market data, API key, or NPM client.

Verdict: **PARTIAL**. The engine, private Builder API, and signed-out UI are in this tree. The Phase 03 migration has not been applied, so draft save, revision, and owner isolation are not proven against the database. A real wallet conversation was not completed in the browser.

## Engine

`runBlueprint` in `lib/blueprint/execute.ts` is the shared server path. A run is `SUCCESS` only when every step finishes and the declared output is present and inside the byte ceiling. A provider error, a nonconforming model result, a bad reference, or an oversized output is `FAILED` with no output. A provider abort or the wall-clock deadline is `TIMEOUT`. Quota and spend refusals stay on the HTTP response (`429`) and do not become a successful execution.

The Blueprint envelope is schema version `1.0`: name, description, inputs, ordered steps, outputs, limits, and capabilities. Draft ids, immutable version ids, and execution ids are separate database identities. The version row is keyed by the SHA-256 of the canonical JSON. Saving the same bytes again does not create a second version.

User inputs are `string`, `number`, `boolean`, `enum`, and `solanaAddress`. References are only `inputs.<field>` and `steps.<earlier>.result` with an optional dotted path. There is no seventh operation, loop, branch, parallel step, eval, free-form URL, or transaction submission.

| Operation | Adapter | Contract test |
| --- | --- | --- |
| `ai.generate` | OpenAI `gpt-4.1-mini` structured `text_v1` | Injected port returns a conforming object |
| `ai.analyze` | Same adapter, schema `analysis_v1` | Injected port |
| `solana.account` | Helius `getAccountInfo`, `getBalance`, `getTokenAccountsByOwner` | Injected port |
| `solana.transactions` | Helius `getSignaturesForAddress`, `getTransaction` | Injected port |
| `solana.token` | Helius `getAccountInfo`, `getTokenSupply`, `getTokenLargestAccounts` | Injected port; holder coverage `complete` is false |
| `data.transform` | Local select, filter, sort, aggregate, deduplicate, format, calculate | No provider |

Holder samples always report `coverage.complete: false` and `source: getTokenLargestAccounts`. Transforms do not execute strings. Division by zero leaves the row unchanged.

## Ceilings

Architecture ceilings: 5 steps, 5 OpenAI calls, 10 Helius calls, 60 seconds, 4,000 output tokens, 40,000 input characters, 128 KiB output, 100 transaction rows, 5 transform actions.

Chosen ceilings, not locked by the architecture: model `gpt-4.1-mini`; 20,000 combined tokens per run; $0.02 reserved before each paid OpenAI call; $1 estimated per account per UTC day; $20 estimated across all accounts per UTC day; 20 second provider deadline; 0 retries; JSON depth 6; 8,000 characters per Builder message; 2 concurrent runs; 20 drafts. Usage counters live in Postgres. The reserve uses the flat $0.02 estimate. The execution row also stores the provider's token counts when they are present.

Anonymous playground access is not built and is not advertised. API keys are not built. The future 100 runs/day key quota is unused.

## Persistence

`supabase/migrations/20261018193000_phase_03_blueprint_builder.sql` is local only. It was not applied.

It adds `sdk_drafts`, `builder_conversations`, `builder_messages`, `blueprint_versions`, `executions`, `execution_steps`, `usage_daily`, and `provider_spend_daily`. Row level security is enabled and forced. `public`, `anon`, and `authenticated` have no grants and no policies. Queries in the server API always include `account_id`. Another wallet receives the same not-available response as a missing draft. No financial tables were added.

Review the file, then apply it yourself:

```bash
npx supabase db push --dry-run
npx supabase db push
```

Until those tables exist, Builder routes respond that the Builder is unavailable. They do not invent a draft or a run.

## Routes

- `POST /api/builder/messages` — signed-in, same-origin. One correction attempt. An invalid model draft is not stored as a valid Blueprint.
- `GET /api/builder/drafts` and `GET /api/builder/drafts/[draftId]` — owner only.
- `POST /api/builder/drafts/[draftId]/test` — validates inputs, reserves quota and spend, runs `runBlueprint`, stores the trace.

Prompts, signatures, and provider payloads are not written to logs. Traces store step id, status, duration, request counts, and a short error code.

## Live evidence

`scripts/phase03-live.ts` is manual. It is not part of `npm run test:blueprint`. It reads local provider configuration and does not print secrets.

One real `ai.generate` run through `runBlueprint`: `SUCCESS`, model `gpt-4.1-mini`, 60 input tokens, 5 output tokens.

One real `solana.token` supply run for the USDC mint: `SUCCESS`, supply amount `7696629618540333`.

One real `getTokenSupply` against the System Program address: `FAILED`, error code `provider`. The run output was empty.

Draft revision, refresh persistence, and a second wallet's isolation still need the migration and a signed-in browser session.

## Checks

`npm run typecheck`, `npm run lint`, `npm run test:auth` (11), `npm run test:blueprint` (7), and `npm run build` passed.

## Left for the operator

After the migration:

1. Connect a wallet and approve sign-in.
2. Describe an SDK in the Builder and confirm the draft reloads after refresh.
3. Run Test SDK and confirm the execution id, status, and trace.
4. Sign in with a second wallet and confirm the first draft is not listed.
5. Log out.

Do not start Phase 04 from this change.

## Phase 03C — explicit save

Sending a Builder message used to insert an `sdk_drafts` row and list it on the account page. That row is now an unsaved workspace. My SDKs lists only rows with `saved_at`. A name is stored only after a `SUCCESS` execution whose blueprint version hash matches the current workspace. Refining the blueprint changes that hash, so the previous test no longer authorizes Save. Repeating the same save updates the same row.

`20261019133000` is recorded in `supabase_migrations.schema_migrations`. Do not reapply it. Unsaved workspaces older than 24 hours, and all but the four newest unsaved workspaces, are deleted on the next new description. Saved drafts and their executions are not deleted.

## Phase 03D — account actions

A confirmed save navigates to `/account?sdk=<id>&saved=1` and highlights that card. Launch on a saved card keeps the SDK id and tested version id and does not navigate. Delete sets `deleted_at` on that owner’s saved row. Versions and executions stay. A second delete of the same row is a no-op. Another wallet receives the same not-found response as a missing id.

`supabase/migrations/20261019143000_phase_03d_soft_delete.sql` is local only. It was not applied. Review it, then:

```bash
npx supabase db push --dry-run
npx supabase db push
```

Until `deleted_at` exists, Builder queries respond that the Builder is unavailable.

## Phase 03E — dedicated Builder

The homepage keeps the prompt. Send stores that prompt in session storage and opens `/build` with no query string. `/build` reads it once and starts one generation. A second mount during the same handoff waits on that same request. Refresh after generation uses `?draft=` and does not call the model again. Edit and Test from the account page open `/build`.
