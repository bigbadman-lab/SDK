# Production launch runbook

Local commands only become production writes when pointed at the production database with `--execute` and the matching approval token. Dry-run is the default and writes nothing. None of these commands signs or broadcasts a transaction.

Approved worker revision: `840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab`.

Production compatibility contract: `sdk-production-v1`.

`--revision` is the rewards worker Git SHA. The website and builder may run different commits when each health endpoint reports `compatibility=sdk-production-v1` and a real 40-character Git revision. A matching Git SHA does not replace a missing compatibility contract.

Platform wallet: `DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC`.

Load `DATABASE_URL` and `HELIUS_RPC_URL` from the operator environment before each command. The npm scripts do not read `.env.local` by themselves.

`rewards_active`, `child_fees_active`, and `launches_active` are independent. Stage 3 may run while parent rewards are already active. `rewards=` in command output is the current flag, not a precondition. Stop a Stage 3 command if it changes `rewards_active`.

## Stop conditions

Stop before `--execute` when any of these is true:

- The dry-run verification is not `ready` (an idempotent repeat of the same flag is the exception).
- The dry-run reports `writes` other than `0`.
- The worker `/health` revision does not exactly equal `--revision`, or that revision is missing or not 40 hex characters.
- Website `/api/health` or builder `/health` reports a missing, `unverified`, or non-40-hex revision.
- Any of the three health endpoints omits `compatibility` or reports a value other than `sdk-production-v1`.
- The canonical mint is missing, divergent, or the historical TREST mint.
- A command would change a flag other than the one named in that command.
- Child-fee health is not operational before public-launch activation.
- Submitted or uncertain transactions are still unresolved before turning a flag back on.

An already submitted blockchain transaction cannot be canceled by clearing a database flag. Reconcile it from its signature before reactivation.

## 1. Registration

```sh
npm run sdk:register -- --mint <MINT> --deployer DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC --fee-recipient DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC --fee-mode single_recipient --operator <OPERATOR>
npm run sdk:register -- --execute --approval SDK-PROD-01-REGISTER --mint <MINT> --deployer DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC --fee-recipient DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC --fee-mode single_recipient --operator <OPERATOR>
npm run sdk:status
```

Stop unless the dry-run says `validation=ready` and `writes=0`. After execute, `sdk:status`, website `/api/health`, and builder `/status` must show the mint with all three flags false. No service redeploy is required for that read.

## 2. Render environment, then parent rewards

The worker revision pin is `840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab` until the compatibility release below is deployed to the worker. After that deploy, `--revision` is the new worker SHA. Change environment variables only through a new deploy of the pinned worker commit. A restart keeps the previous environment snapshot.

1. Set `REWARDS_LOOP_ENABLED=true` and `REWARDS_EXECUTION_AUTHORIZED=true`. Leave `SDK_SIGNER_SUSPENDED=true`. Deploy the approved commit. The loop stays stopped.
2. Confirm worker health: signer suspended, `executionAuthorised` false, broadcasts false.
3. Set `SDK_SIGNER_SUSPENDED=false`. Deploy the same commit. The loop can start. Parent broadcasts stay off while `rewards_active` is false.
4. Confirm health: signer matched, loop running, broadcasts disabled, rewards inactive, claims closed, reconciliation clear.

```sh
npm run sdk:rewards-status
npm run sdk:activate-rewards -- --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-rewards -- --execute --approval SDK-PROD-02-ACTIVATE --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
```

Activation sets only `rewards_active=true`. It requires the pinned worker revision, `sdk-production-v1` on that worker, a clear reconciliation, and closed child launches. It does not change `child_fees_active` or `launches_active`. A missing worker compatibility contract blocks activation even when the Git SHA matches.

## 3. Child fees, then public launches

Parent rewards may already be active. Do not stop because `rewards=active`.

```sh
npm run sdk:activate-launches -- --status
npm run sdk:activate-launches -- --enable-child-fees --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-launches -- --enable-child-fees --execute --approval SDK-PROD-03-ENABLE-CHILD-FEES --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-launches -- --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-launches -- --execute --approval SDK-PROD-03-ACTIVATE --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
```

Enable sets only `child_fees_active`. Public activation sets only `launches_active`, and only after child fees are operational. The row lock serializes a concurrent parent-reward change. The launch statement does not write `rewards_active`; if that flag changes between the locked read and the update, the statement rolls back.

Before the public-launch execute, confirm the worker revision still equals `--revision` and that website, builder, and worker health each report `compatibility=sdk-production-v1` with a real Git revision. The preflight records the website and builder revisions. They do not have to equal the worker. The website and builder must still report signing false and broadcast false. The website must report `launchGate=database` and `trestFallback=false`.

## 4. Emergency shutdown

Each flag stays independently controllable. Dry-run each command first by omitting `--execute`. `--revision` must still be a 40-character worker SHA. Closing launches, disabling child fees, and deactivating parent rewards do not require the website to be available or on the same contract. Deactivation does not require a healthy worker.

```sh
npm run sdk:activate-launches -- --close-launches --execute --approval SDK-PROD-03-CLOSE-LAUNCHES --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-launches -- --disable-child-fees --execute --approval SDK-PROD-03-DISABLE-CHILD-FEES --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
npm run sdk:activate-rewards -- --deactivate --execute --approval SDK-PROD-02-DEACTIVATE --revision 840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab
```

Then suspend the Render worker for an immediate process stop, or deploy `sdk-rewards-worker` again at the approved commit with `REWARDS_LOOP_ENABLED=false`, `REWARDS_EXECUTION_AUTHORIZED=false`, and `SDK_SIGNER_SUSPENDED=true`.

Deactivation sets only `rewards_active=false`. It preserves the canonical mint, child-fee and launch flags, holder liabilities, confirmed claims, and submitted or uncertain intents. Clearing the flag does not cancel an already submitted blockchain transaction. Reconcile those signatures before any reactivation.

The worker reads `rewards_active` and `child_fees_active` again immediately before it authorises a new financial submission. A flag that was true at the start of the five-minute cycle does not authorise a submission after the flag is cleared.

## 5. Compatibility deployment

The services currently running `840c8a0d7c2ab8ebfd3afc16f1d15ad92c0d49ab` do not advertise `sdk-production-v1`. Activation stays blocked until all three do. Deploy in this order:

1. Commit and push the compatibility implementation.
2. Let the website and transaction builder deploy that revision.
3. Deploy that same revision once, manually, to the rewards worker. Leave financial execution disabled: `SDK_SIGNER_SUSPENDED=true`, `REWARDS_LOOP_ENABLED=false`, and `REWARDS_EXECUTION_AUTHORIZED=false` until the later rewards runbook steps.
4. Confirm website `/api/health`, builder `/health`, and worker `/health` each report `compatibility` `sdk-production-v1` and their own real Git revision.
5. Confirm the worker health still shows signer suspended, execution unauthorised, and broadcasts disabled.
6. Record the deployed worker SHA and use it as `--revision` from then on.

After that worker deploy, a later website commit does not require another worker deployment. The website and builder may move ahead when they still report `sdk-production-v1` and a real revision. The worker stays pinned to the recorded SHA. A service that omits the contract, or reports a different contract, blocks activation even if its Git SHA matches.
