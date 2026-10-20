import { heliusChain, heliusRpc } from "./chain.ts";
import { createSql, postgresRewardsStore } from "./postgres.ts";
import { runCycle } from "./run.ts";

export function startRewardsLoop(input: { secret: string; expectedAddress: string; suspended: boolean }): void {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl || !rpcUrl) {
    console.error("rewards-worker inactive");
    return;
  }
  const store = postgresRewardsStore(createSql(databaseUrl));
  const chain = heliusChain((method, params) => heliusRpc(rpcUrl, method, params));
  const tick = (): void => {
    void runCycle({
      nowMs: Date.now(),
      holder: "rewards-worker",
      loopEnabled: true,
      authorised: true,
      suspended: input.suspended || process.env.TREST_SIGNER_SUSPENDED === "true",
      secret: input.secret,
      expectedAddress: input.expectedAddress,
      store,
      chain,
    }).catch(() => {
      console.error("rewards-worker cycle");
    });
  };
  tick();
  setInterval(tick, 300_000);
}
