import { publicChildLaunchesOpen } from "../../../lib/launch/public-launch.ts";
import { presentRewardsStatus } from "../../../lib/rewards/activation.ts";
import { loadActivationSnapshot } from "./sdk-activate-cli.ts";
import { createSql } from "./store.ts";

const invoked = process.argv[1]?.endsWith("sdk-rewards-status-cli.ts") === true;
if (invoked) {
  delete process.env.SDK_DEPLOYER_PRIVATE_KEY;
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) {
    const result = presentRewardsStatus({
      database: "unavailable",
      config: null,
      registration: null,
      chain: { ok: false, code: "not_checked" },
      signerAddress: null,
      worker: { ok: false, code: "unavailable" },
      unresolved: null,
      lastWindow: null,
      childLaunchesOpen: publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
      trestSuspended: null,
      trestRehearsalOpen: null,
    });
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  } else {
    const sql = createSql(databaseUrl);
    try {
      const result = presentRewardsStatus(await loadActivationSnapshot(sql));
      process.stdout.write(`${result.out}\n`);
      process.exitCode = result.code;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
