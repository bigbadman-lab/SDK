# SDK launch readiness

Statuses mean what has been proven. A fixture test is not mainnet proof. A vault balance is not a collected fee. An accounting row is not a payout.

Current position: native `$SDK` launch is blocked. TREST has not been minted. No creator-fee collection, buyback, holder payout, or child-fee distribution has been confirmed on mainnet.

## Gate A — Infrastructure — PARTIAL

Read on 20 October 2026:

- `https://sdk.fund` returned 200.
- The transaction builder health check returned ok. Its status reported the database and RPC ok, the parent unregistered, and signing and broadcast false.
- The rewards worker health check returned HTTP ok with financial runtime suspended: signer suspended, signing false, broadcasts false, loop false, and execution unauthorised.
- `20261020260000_trest04_claims_child_fees_emergency.sql` is in the repository and applied only on disposable PostgreSQL. It was not applied to Supabase.
- Wallet signing for the launch rehearsal is implemented. Rewards signing stays suspended.
- `KILL_WALLET` is not set in this repository and is not read by the website.

## Gate B — Parent — BLOCKED

TREST is not minted. There is no registered TREST mint, no verified creator-fee recipient, and no real preflight against that mint. Production `$SDK` remains unregistered.

## Gate C — Child launch — BLOCKED

No TREST-paired child has been created. Phantom signing, the parent quote, fee-sharing configuration, shareholder percentages, admin revocation, and an initial buy are not proven on mainnet.

## Gate D — Child trading — BLOCKED

No SDK buy or sell has been confirmed against a TREST-paired child.

## Gate E — Child fee distribution — BLOCKED

The worker asks Pump SDK 4.2.0 for the full child-fee transaction: curve `sweepCreatorFee` when the curve bucket is nonzero, PumpSwap `sweepCreatorFee` and `transferCreatorFeesToPumpV2` after graduation, then Pump-program `distributeCreatorFeesV2`. It signs that transaction only when execution is authorised. Confirmation requires a non-shareholder quote debit and shareholder receipts that match the locked split. No child trade has generated fees, and no shareholder has received TREST. Community 60/25/15, Own 85/15, and Official 60/40 are locked in code and covered by fixtures. They are not mainnet distributions.

## Gate F — Native holder rewards — BLOCKED

The five-minute cycle, 30/30/40 split, buyback, snapshot, and SOL, parent-token, and Claim All paths exist and are fixture-tested. Account claims call the worker through `POST /v1/claims` when `REWARDS_WORKER_URL` and `REWARDS_WORKER_SECRET` are set. A suspended or unauthorised worker returns inactive and does not sign. The worker is suspended: signer suspended, signing false, broadcasts false, loop false, execution unauthorised. No TREST creator fee has been collected, no buyback has been confirmed, and no holder has been paid.

## Gate G — Emergency control — PARTIAL

`npm run kill-wallet -- --parent trest --dry-run` and `--execute` exist. Dry-run is the default and writes no transaction. `--execute` stays `execution_disabled` unless the worker has `KILL_WALLET_EXECUTION_AUTHORIZED=true`, a parent-specific signer, and an approval of at least 32 characters. That flag is unset. A shortfall against holder entitlements also requires `KILL_WALLET_LIABILITY_AUTHORITY=true`, which is unset and needs separate documented legal authority. The destination must be `KILL_WALLET` on the rewards worker; none is configured here. Ledger liabilities are reported and do not shrink the transferable balance. No mainnet sweep has been run. The worker remains suspended after a confirmed sweep.

## Gate H — Product readiness — BLOCKED

Account rewards and SDK Earnings render, and they do not present placeholder payments. The rest of this gate still needs the product surfaces exercised against a live TREST market. That market does not exist.

## Gate I — Final production approval — BLOCKED

Official `$SDK` launch stays blocked. Gates A–H do not have sufficient evidence. The production deployer key is not configured. Reward terms that would allow an emergency sweep of allocated holder balances are not approved. Nothing in this document authorises minting `$SDK`.
