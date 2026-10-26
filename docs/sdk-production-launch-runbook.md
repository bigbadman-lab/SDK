# Production launch runbook

Local commands only become production writes when pointed at the production database with `--execute` and the matching approval token. Dry-run is the default and writes nothing. None of these commands signs or broadcasts a transaction.

Approved revision: `988fe0c1b0b98d2b664a6fe1586d3789a36de535`.

Platform wallet: `DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC`.

Load `DATABASE_URL` and `HELIUS_RPC_URL` from the operator environment before each command. The npm scripts do not read `.env.local` by themselves.

`rewards_active`, `child_fees_active`, and `launches_active` are independent. Stage 3 may run while parent rewards are already active. `rewards=` in command output is the current flag, not a precondition. Stop a Stage 3 command if it changes `rewards_active`.

## Stop conditions

Stop before `--execute` when any of these is true:

- The dry-run verification is not `ready` (an idempotent repeat of the same flag is the exception).
- The dry-run reports `writes` other than `0`.
- Website `/api/health`, builder `/health`, and worker `/health` do not all report revision `988fe0c1b0b98d2b664a6fe1586d3789a36de535`.
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

The worker revision is already `988fe0c1b0b98d2b664a6fe1586d3789a36de535`. Change environment variables only through a new deploy of that same commit. A restart keeps the previous environment snapshot.

1. Set `REWARDS_LOOP_ENABLED=true` and `REWARDS_EXECUTION_AUTHORIZED=true`. Leave `SDK_SIGNER_SUSPENDED=true`. Deploy the approved commit. The loop stays stopped.
2. Confirm worker health: signer suspended, `executionAuthorised` false, broadcasts false.
3. Set `SDK_SIGNER_SUSPENDED=false`. Deploy the same commit. The loop can start. Parent broadcasts stay off while `rewards_active` is false.
4. Confirm health: signer matched, loop running, broadcasts disabled, rewards inactive, claims closed, reconciliation clear.

```sh
npm run sdk:rewards-status
npm run sdk:activate-rewards -- --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-rewards -- --execute --approval SDK-PROD-02-ACTIVATE --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
```

Activation sets only `rewards_active=true`. It requires the worker revision, a clear reconciliation, and closed child launches. It does not change `child_fees_active` or `launches_active`.

## 3. Child fees, then public launches

Parent rewards may already be active. Do not stop because `rewards=active`.

```sh
npm run sdk:activate-launches -- --status
npm run sdk:activate-launches -- --enable-child-fees --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-launches -- --enable-child-fees --execute --approval SDK-PROD-03-ENABLE-CHILD-FEES --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-launches -- --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-launches -- --execute --approval SDK-PROD-03-ACTIVATE --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
```

Enable sets only `child_fees_active`. Public activation sets only `launches_active`, and only after child fees are operational. The row lock serializes a concurrent parent-reward change. The launch statement does not write `rewards_active`; if that flag changes between the locked read and the update, the statement rolls back.

Confirm website, builder, and worker revisions again before the public-launch execute. The website and builder must still report signing false and broadcast false.

## 4. Emergency shutdown

Use the same revision on every execute. Each flag stays independently controllable. Dry-run each command first by omitting `--execute`. Deactivation does not require a healthy worker.

```sh
npm run sdk:activate-launches -- --close-launches --execute --approval SDK-PROD-03-CLOSE-LAUNCHES --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-launches -- --disable-child-fees --execute --approval SDK-PROD-03-DISABLE-CHILD-FEES --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
npm run sdk:activate-rewards -- --deactivate --execute --approval SDK-PROD-02-DEACTIVATE --revision 988fe0c1b0b98d2b664a6fe1586d3789a36de535
```

Then suspend the Render worker for an immediate process stop, or deploy `sdk-rewards-worker` again at the approved commit with `REWARDS_LOOP_ENABLED=false`, `REWARDS_EXECUTION_AUTHORIZED=false`, and `SDK_SIGNER_SUSPENDED=true`.

Deactivation sets only `rewards_active=false`. It preserves the canonical mint, child-fee and launch flags, holder liabilities, confirmed claims, and submitted or uncertain intents. Clearing the flag does not cancel an already submitted blockchain transaction. Reconcile those signatures before any reactivation.

The worker reads `rewards_active` and `child_fees_active` again immediately before it authorises a new financial submission. A flag that was true at the start of the five-minute cycle does not authorise a submission after the flag is cleared.
