# kill-wallet

Operator-only emergency command for the rewards worker. It is not an HTTP route and it is not available on the website or the transaction builder.

## Command

From `services/rewards-worker`:

```
npm run kill-wallet -- --parent trest --dry-run
npm run kill-wallet -- --parent trest --execute
```

Dry-run is the default. `--parent sdk` is rejected because this service signs only the TREST deployer. A destination argument is rejected. The destination is the `KILL_WALLET` environment variable on the Render rewards worker.

## What a dry-run reports

The public destination, the TREST deployer address, the technically transferable SOL after rent and a 5,000 lamport fee reserve, the deployer parent-token balance, and the accounting liabilities. Those liabilities are recorded. They do not reduce the transferable balance. Claimable holder balances make `shortfall=true`.

## What execution does in this phase

`--execute` returns `execution_disabled` while `KILL_WALLET_EXECUTION_AUTHORIZED` is not exactly `true`. That variable stays unset. An approval string, a private key, and a destination are not enough to broadcast.

When that variable is later set to `true`, execution still requires the TREST signer, an approval of at least 32 characters, no competing lock, and no in-flight claim or buyback. The command fences ordinary rewards, writes the intent to `emergency_sweeps`, and refuses to broadcast if that record cannot be written. It then broadcasts only the allowlisted SOL and parent-token transfers to `KILL_WALLET`, and fences again after confirmation so the worker stays suspended. Dry-run prints the plan and does not write the database.

A shortfall against outstanding holder entitlements returns `holder_liability_unauthorised` unless `KILL_WALLET_LIABILITY_AUTHORITY` is exactly `true`. That variable stays unset. It requires documented legal authority before anyone sets it. This phase does not sweep allocated holder entitlements.

A confirmed sweep must mark those liabilities unfunded. It must not mark them paid. An uncertain broadcast stays unresolved. A failed broadcast leaves the liabilities unchanged.

## Environment

Set on the rewards worker only:

- `KILL_WALLET`: the fixed public destination. Do not invent one, and do not put it on Vercel or the transaction builder.
- `TREST_DEPLOYER_ADDRESS`: the expected TREST signer.
- `TREST_SIGNER_SUSPENDED`: remains `true` for this phase.
- `REWARDS_LOOP_ENABLED`: remains `false`.
- `REWARDS_EXECUTION_AUTHORIZED`: remains `false`.

`KILL_WALLET_APPROVAL` is a one-time operator string of at least 32 characters. It is ignored while `KILL_WALLET_EXECUTION_AUTHORIZED` is unset.

`KILL_WALLET_EXECUTION_AUTHORIZED` and `KILL_WALLET_LIABILITY_AUTHORITY` stay unset. Do not set the liability flag in this deployment.

## Recovery

The command does not print a private key. It acquires no funds in dry-run. An execution, once a later phase enables it, must take the parent lock, set `EMERGENCY_FENCE=true` so collection, buybacks, and claims stop, record the plan before broadcast, and leave financial operations suspended after confirmation.
