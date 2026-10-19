# SDK

SDK is a unified place to build a working SDK, test it, and launch a token paired with native $SDK. A verified launch automatically publishes the working, token-associated product. Community developers will be able to submit reusable SDKs without minting a token. Operator approval makes a library listing, not a launched product.

This repository is the Phase 03 site: a dark-first Agentframe layout, Solana wallet sign-in, and a private conversational Builder. A connected wallet is not a session until the server verifies a signature. A tested draft is not a launched product. The site does not mint tokens or pay rewards.

## Requirements

- Node.js 20.9 or newer
- npm

Pinned runtime versions are Next.js 16.3.8, React 19.2.8, and Tailwind CSS 4.3.3. The Next.js pin moved from 16.3.4 to 16.3.8 for the reviewed security advisories. Remaining audit items are recorded in `docs/decisions/PHASE_01_FOUNDATION.md`.

## Local setup

```bash
npm ci
npm run dev
```

Open the local URL printed by Next.js. Public pages render without environment variables. Wallet connection needs `NEXT_PUBLIC_REOWN_PROJECT_ID`. Sign-in also needs `APP_SESSION_SECRET`, `DATABASE_URL`, and the Phase 02 tables.

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

| Script                   | Purpose                     |
| ------------------------ | --------------------------- |
| `npm run dev`            | Development server          |
| `npm run build`          | Production build            |
| `npm start`              | Serve the production build  |
| `npm run typecheck`      | Strict TypeScript check     |
| `npm run lint`           | ESLint                      |
| `npm run test:auth`      | Wallet identity unit tests  |
| `npm run test:blueprint` | Blueprint engine unit tests |
| `npm run format`         | Prettier                    |

Recognized variable names live in `.env.example`. Leave them blank for local development. Do not commit `.env`, `.env.local`, keys, or database URLs.

## What works

- Homepage and About explain the product.
- Dark theme is the default. A control can switch to light, and another can pause motion. System reduced motion still wins.
- The homepage prompt opens `/build` after a verified sign-in. Signed-in Builder requests and tests need `OPENAI_API_KEY`, `HELIUS_RPC_URL`, and the Phase 03 tables. Without those tables the Builder says it is unavailable.
- A Solana wallet can connect in the header. Sign-in asks that wallet to sign a server-issued message. `/account` shows the server session after verification.
- `/library` is the public SDK Library. It lists only published SDKs. Saving a private draft does not publish it. Remix opens an unsaved private copy in the Builder.
- `supabase/migrations/` holds the foundation comment, the Phase 02 identity tables, the Phase 03 Builder tables, the Phase 04A Library tables, the Phase 04C submission table, and the Phase 04D API key table. `20261019133000_phase_03c_explicit_save.sql`, `20261019143000_phase_03d_soft_delete.sql`, and `20261019160000_phase_04a_library.sql` are already applied and must not be reapplied. `20261019180000_phase_04c_community_submissions.sql` and `20261019200000_phase_04d_api_keys.sql` are local until the operator applies them. This app does not apply migrations. The ten official SDKs are published through the operator seed.
- `packages/sdk-client` is the universal execution client. It is not published to NPM. Build and pack it locally. `/code` explains the API.

## What does not work

- Saving or testing a draft before the Phase 03 tables exist
- Anonymous Builder trials
- Token launch, minting, and automatic publication
- Community submission until `20261019180000_phase_04c_community_submissions.sql` is applied. After that, a saved tested SDK can be submitted, and only an operator approval publishes it.
- API keys and `POST /api/v1/sdk/execute` until `20261019200000_phase_04d_api_keys.sql` is applied and `API_KEY_PEPPER` is set. The client package is not on NPM.
- Feed, rewards, trading data, and the NPM client
Sign-in stores a session only after the server accepts a wallet signature. The Phase 02 tables are required. If they are missing, the sign-in routes say sign-in is unavailable and do not invent a session.

A private save does not publish an SDK. Community publication happens only after operator approval of the submitted revision. Token launch is not implemented.

## Deployment

The app is a normal Next.js server project and builds with `npm run build`. Public pages do not need provider secrets. Sign-in needs `DATABASE_URL`, `APP_SESSION_SECRET`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, and `NEXT_PUBLIC_SOLANA_NETWORK` in the host environment, plus the Phase 02 tables.

Set `NEXT_PUBLIC_APP_URL` to the real origin, including `https://`, before treating metadata, robots, or the sitemap as public. Until that value is set, pages ask not to be indexed and robots disallow crawling.

Apply the identity migration only after review:

```bash
npx supabase db push --dry-run
npx supabase db push
```

## Design credit

The interface retains the Agentframe template from React Bits Pro. See `LICENSE` and `docs/design.md`. The landscape photograph is credited on the About page. The wordmark is the text “SDK” until approved artwork is supplied.
