# Phase 01 — Foundation

Date: 18 October 2026.

Architecture source: `docs/architecture/SDK_MASTER_ARCHITECTURE_V1_1.md`. This phase does not rewrite that product model.

## Retained from Agentframe

- Next.js App Router, strict TypeScript, Tailwind CSS v4, Motion, next-themes, and Lucide.
- Pinned versions: Next.js 16.3.8, React 19.2.8, Tailwind CSS 4.3.3. Next.js and `eslint-config-next` moved from 16.3.4 to 16.3.8 after operator approval. React and Tailwind stayed on the template pins.
- Serif display type, Geist, Geist Mono, cobalt accent, hairline borders, 1100px measure, sticky header, skip link, focus outlines, and reduced-motion behavior.
- Pixel landscape and its local photograph.
- Native dialog navigation, theme switch, and motion pause control.
- React Bits Pro license file.

## Removed as mock or misleading

- Timed playground playback, scenario runs, and fabricated status lines.
- Pricing, plan dialogs, comparison tables, and subscription routes.
- Testimonials, fictional customer marks, sample statistics, and field notes.
- Agent-harness claims: autonomous runs, MCP integrations, persistent agent memory, workspaces, and completed operations.
- Agentframe name, geometric mark, favicon artwork, and `example.com` as a production origin.
- Remote Unsplash article images. The landscape credit remains.

## Changed for SDK

- Product name SDK, native ticker $SDK, and the two journeys: Build → Test → Launch (automatic publication), and Build → Test → Submit → operator approval → available for launch, with no token required.
- Dark is the initial theme. Light remains available from the appearance control.
- The Builder is an introduction. Example prompts can be selected. The request control is disabled and does not call an API.
- Homepage, About, navigation, footer, 404, manifest, icon, robots, and sitemap describe only the current site.
- `lib/server/env.ts` checks configuration when a specific integration function is called. Those functions are not called by the public pages.
- `lib/server/database.ts` can report whether `DATABASE_URL` looks like Postgres. It does not connect or print the string.
- `supabase/migrations/20261018120000_phase_01_foundation.sql` versions the migration directory without product or financial tables.
- `.env.example` lists approved names with blank or non-secret examples. `.gitignore` ignores `.env*` except `.env.example`.
- `server-only` 0.0.1 was added so secret-bearing modules fail the build if a client component imports them. React and Tailwind pins were not changed. Next.js and `eslint-config-next` were later set to 16.3.8.

## Intentionally deferred

- Blueprint engine, six operations, and the ten official SDKs.
- Reown wallet auth and sessions are implemented in Phase 02. The NPM client remains deferred.
- Supabase application schema, and any applied migration or live connection.
- Render transaction builder, native rewards worker, Redis, queues, and a second UI framework.
- Token launch, royalties, canonical mint, Feed, market data, and rewards UI. Operator recovery copy is not shown.
- Vercel project linking and a preview URL.

## Security review

Operator approval moved `next` and `eslint-config-next` from 16.3.4 to 16.3.8. That clears the Next.js advisories from the Phase 01 audit, including the critical `next/og` ImageResponse issue. The site still does not use `next/og` ImageResponse.

`npm audit` after that install reports 8 high findings and no critical findings. They are transitive toolchain packages: `brace-expansion`, `braces` through `micromatch` / `fast-glob` / `eslint-config-next`, `sharp`, and `source-map-js`. npm’s suggested ESLint downgrade to 14.2.35 was not applied. React 19.2.8 and Tailwind CSS 4.3.3 are unchanged.

## Database connectivity

No local `DATABASE_URL` is required, and Phase 01 does not open a connection or apply the migration. The foundation file is one idempotent `comment on schema public`. It creates no tables and deletes nothing. A local `psql` client is installed, and nothing is listening on the Postgres socket, so the statement has not been applied. Live database connectivity stays blocked until an operator configures Supabase outside this chat and explicitly asks for a check.
