# SDK

SDK is a unified place to build a working SDK, test it, and launch a token paired with native $SDK. A verified launch automatically publishes the working, token-associated product. Community developers will be able to submit reusable SDKs without minting a token. Operator approval makes a library listing, not a launched product.

This repository is the Phase 01 foundation: a dark-first site on the Agentframe visual system, safe server configuration, and a versioned database migration boundary. It does not run SDKs, connect wallets, mint tokens, or pay rewards.

## Requirements

- Node.js 20.9 or newer
- npm

Pinned runtime versions are Next.js 16.3.8, React 19.2.8, and Tailwind CSS 4.3.3. The Next.js pin moved from 16.3.4 to 16.3.8 for the reviewed security advisories. Remaining audit items are recorded in `docs/decisions/PHASE_01_FOUNDATION.md`.

## Local setup

```bash
npm ci
npm run dev
```

Open the local URL printed by Next.js. The pages render with no environment variables.

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

| Script              | Purpose                    |
| ------------------- | -------------------------- |
| `npm run dev`       | Development server         |
| `npm run build`     | Production build           |
| `npm start`         | Serve the production build |
| `npm run typecheck` | Strict TypeScript check    |
| `npm run lint`      | ESLint                     |
| `npm run format`    | Prettier                   |

Recognized variable names live in `.env.example`. Leave them blank for local development. Do not commit `.env`, `.env.local`, keys, or database URLs.

## What works

- Homepage and About explain the product.
- Dark theme is the default. A control can switch to light, and another can pause motion. System reduced motion still wins.
- The Builder panel shows inert example prompts. The request control stays disabled.
- Server configuration is checked only when a later integration calls it. The public pages do not need secrets.
- `supabase/migrations/` holds one foundation migration. It creates no product or financial tables, and this app does not apply it.

## What does not work

- Conversational Builder, SDK execution, and tests
- Wallet sign-in
- Token launch, minting, and automatic publication
- Community submission and operator review
- Library, Feed, rewards, trading data, and the NPM client
- Production deployment

There is no separate publish action. Publication happens only after a verified token launch, which is not implemented.

## Deployment

The app is a normal Next.js server project. A Vercel project can be created from `https://github.com/bigbadman-lab/SDK` and built with `npm run build`. No provider environment variables are required for the current pages.

Set `NEXT_PUBLIC_APP_URL` to the real origin, including `https://`, before treating metadata, robots, or the sitemap as public. Until that value is set, pages ask not to be indexed and robots disallow crawling, because no production domain is configured.

This repository is not linked to a Vercel project from Phase 01. Connecting an account, choosing the project, and confirming a preview URL is an operator step.

## Design credit

The interface retains the Agentframe template from React Bits Pro. See `LICENSE` and `docs/design.md`. The landscape photograph is credited on the About page. The wordmark is the text “SDK” until approved artwork is supplied.
