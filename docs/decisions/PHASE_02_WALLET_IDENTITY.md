# Phase 02 — Wallet identity

Date: 18 October 2026.

Architecture source: `docs/architecture/SDK_MASTER_ARCHITECTURE_V1_1.md`. This phase does not rewrite that product model. A connected wallet is not an account until the server verifies a signature. No Builder, launch, rewards, Feed, or API-key work is included.

## Dependencies

Installed and locked, without changing the Next.js, React, or Tailwind pins:

- `@reown/appkit` 1.8.24
- `@reown/appkit-adapter-solana` 1.8.24
- `@solana/web3.js` 1.99.0
- `tweetnacl` 1.0.3
- `bs58` 6.0.0
- `postgres` 3.4.9

AppKit is Solana-only. Email, social login, swaps, onramp, send, receive, history, analytics, and Reown authentication are disabled. There is no second auth platform, no NextAuth, no Supabase Auth, and no Redis.

`next.config.ts` marks `pino-pretty`, `lokijs`, `encoding`, and `postgres` as server external packages so the AppKit wallet bundle can load under Turbopack. A webpack externals block was not added, because Next.js 16 rejects a webpack config unless Turbopack is configured as well.

## Routes

- `POST /api/auth/challenge` issues a single-use nonce and the exact message the wallet must sign.
- `POST /api/auth/verify` checks that signature, creates the account if needed, and sets the session cookie.
- `POST /api/auth/logout` revokes the stored token and clears the cookie.
- `GET /api/auth/session` reports the server session and rewrites the cookie when the inactivity window slides.
- `GET /account` shows the server-authenticated wallet, or a sign-in action when there is no session.

The header connects a wallet, then offers Sign in. Disconnect and a change to a different wallet revoke the server session. The first disconnected observation after a page load does not revoke a session, so a refresh can reconnect without logging the visitor out. Connecting a wallet does not create a session.

## Schema

`supabase/migrations/20261018170000_phase_02_wallet_identity.sql` creates:

- `accounts` — one row per canonical Solana address
- `login_challenges` — nonce, wallet, domain, network, exact message, expiry, and `consumed_at`
- `sessions` — HMAC hash of the session token, last seen, absolute expiry, revocation
- `auth_attempts` — bounded rate-limit rows

Row level security is enabled and forced. `public`, `anon`, and `authenticated` have no grants and no policies. The app uses the server `DATABASE_URL` role. Raw session tokens are not stored. No financial, Blueprint, Feed, or API-key tables were added.

The operator applied this migration. The connected database has `accounts`, `login_challenges`, `sessions`, and `auth_attempts`, with row level security enabled and forced. The server role can write those tables. For a new environment, review the file and run:

```bash
npx supabase db push --dry-run
npx supabase db push
```

If those tables are missing, challenge and verify respond that sign-in is unavailable. They do not invent a session.

## Security

- The nonce is 16 random bytes encoded as hexadecimal, expires after 5 minutes, and is bound to the wallet, origin, and configured network. The signed message uses the Sign In With Solana chain id (`mainnet`, `devnet`, or `testnet`). The stored network value stays `mainnet-beta`, `devnet`, or `testnet`.
- The server stores the message and verifies those exact bytes. The browser does not supply the message.
- Verification uses `tweetnacl.sign.detached.verify` on the canonical public key. A transaction is never the login.
- The nonce is locked with `SELECT … FOR UPDATE` and marked consumed only after the signature checks. A bad signature rolls back and leaves the nonce unused.
- Expired, reused, malformed, wrong-wallet, wrong-domain, and wrong-network challenges are rejected.
- The session token is 32 random bytes. The cookie stores the raw token. Postgres stores `HMAC-SHA256(token, APP_SESSION_SECRET)`.
- Cookie name `sdk_session`: HttpOnly, SameSite=Lax, Path=/. Secure is set when the request is HTTPS.
- Inactivity lifetime is 7 days. Absolute lifetime is 30 days. `last_seen_at` slides after one hour of activity, from `GET /api/auth/session` and the `touchSession` server action. Server Components do not set cookies.
- Cookie `Max-Age` is the shorter of 7 days and the remaining absolute lifetime.
- State-changing routes require an Origin whose host matches the request host. When `NEXT_PUBLIC_APP_URL` is set, that origin is allowed, and localhost is also allowed so local sign-in still works.
- Challenge and verify are rate limited in `auth_attempts`. Client errors stay generic. Logs record short codes only.
- `OPERATOR_WALLET_ADDRESS` is optional and server-only. No operator UI or hardcoded wallet list exists. Privileged actions stay unavailable until that value is provisioned.

## Environment

Names only. Values stay in `.env.local` or the host, never in git:

- `NEXT_PUBLIC_REOWN_PROJECT_ID` — wallet modal. If it is missing, the header says wallet connection is not configured.
- `NEXT_PUBLIC_SOLANA_NETWORK` — `mainnet-beta`, `devnet`, or `testnet`. Anything else uses `mainnet-beta`.
- `APP_SESSION_SECRET` — HMAC key for session tokens and rate-limit hashes.
- `DATABASE_URL` — Postgres connection used only on the server. The pool is max 1, prepared statements off, TLS required except for localhost.
- `NEXT_PUBLIC_APP_URL` — metadata and the production origin check.
- `OPERATOR_WALLET_ADDRESS` — optional future operator wallet.

`NEXT_PUBLIC_*` values are public by design. Session secrets, database URLs, and the operator wallet are not.

To create a local session secret without writing it into the repo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Test evidence

`npm run test:auth` covers canonical addresses, a real signature and tampered or wrong-key rejection, challenge expiry, reuse, domain, and network checks, session revocation, inactivity, absolute expiry, refresh, and the fact that the stored hash is not the raw token.

A local production server check covered the public homepage, the logged-out account page, the header Connect control, and the mobile menu. The wallet modal opened and listed wallets.

After the tables existed, an integration check against the running app and the connected database used throwaway Solana keypairs. A valid signature created an account and a hashed session, set an HttpOnly SameSite=Lax cookie, kept that session across a second read, and rendered `/account` as signed in for that address. A bad signature and a signature from another key were rejected without consuming the nonce. Replaying the successful signature was rejected. Logging out set `Max-Age=0` and revoked only that session; the other wallet’s session stayed active. A cookie for one wallet did not authenticate as the other wallet. The test rows were deleted afterward.

No browser wallet extension approved a message in that check. A later browser attempt created challenges and then never called verify. `useAppKitProvider` returns a Valtio tracking proxy. Calling `signMessage` on that proxy throws `TypeError: Cannot read private member` inside wallet-standard wallets such as Solflare, before a signature exists. Sign-in calls `signMessage` on the raw Solana provider from `ProviderController`, using the same UTF-8 challenge bytes the server verifies, and only when that provider’s account matches the connected address.

A Phantom click after that change reached `signMessage` with a raw provider, matching accounts, and an active click gesture. Phantom returned `The app's signature request cannot be shown due to invalid formatting` and did not open an approval prompt. The message followed the Sign In With Solana preamble, but its chain id was `mainnet-beta`, which that format does not accept, and its nonce was base64url, which can include `-` or `_`. The message now uses chain id `mainnet` for mainnet-beta and an alphanumeric nonce. The server still verifies the stored bytes. The operator approved that message in Phantom, reached a signed-in account, and the temporary sign-in trace was removed.

## Advisories

`npm audit` after the AppKit install reports 0 critical, 12 high, and 7 moderate. The previous toolchain findings remain: `brace-expansion`, `braces` through ESLint, `sharp`, and `source-map-js`. npm’s suggested ESLint downgrade to 14.2.35 was not applied.

New findings come through the Solana adapter: `bigint-buffer` (GHSA-3gc7-fjrx-p6mg), and moderate issues in `@solana/web3.js` via `jayson`, `stream-json`, and `uuid`. npm’s suggested fixes are a downgrade of the adapter to 1.7.14 or a major upgrade of `@solana/web3.js` to 3.1.0. Neither was applied. Next.js, React, and Tailwind stayed on the approved pins.

## Deferred

SDK execution, the conversational Builder, token launch, publication, community review, library listings, the Feed, rewards, trading data, API keys, and the NPM client. Future transaction signing is a separate approval from this login signature.
