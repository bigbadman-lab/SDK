import type { Chain } from "./chain.ts";
import { COLLECTION_RECOVERY_APPROVAL, CONFIRMED_COLLECTION, recoverConfirmedCollection } from "./collection-recovery.ts";
import type { RewardsStore } from "./store.ts";

type Env = Record<string, string | undefined>;

export type RecoveryIo = {
  store?: RewardsStore;
  chain?: Chain;
};

const FLAGS = ["--operator", "--reason", "--approval"] as const;
const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;

type Args = { operator: string; reason: string; approval: string };

function rejected(code: string): { code: number; out: string } {
  return { code: 2, out: `rejected ${code}` };
}

function parseArgs(argv: string[]): Args | null {
  const values = new Map<string, string>();
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (!FLAGS.includes(name as (typeof FLAGS)[number])) return null;
    if (values.has(name)) return null;
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--")) return null;
    values.set(name, value);
  }
  const operator = values.get("--operator");
  const reason = values.get("--reason");
  const approval = values.get("--approval");
  if (!operator || !reason || !approval) return null;
  return { operator, reason, approval };
}

function financiallySuspended(env: Env): boolean {
  return env.REWARDS_LOOP_ENABLED === "false"
    && env.REWARDS_EXECUTION_AUTHORIZED === "false"
    && env.TREST_SIGNER_SUSPENDED === "true";
}

async function openLive(env: Env): Promise<{ store: RewardsStore; chain: Chain; close: () => Promise<void> } | null> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres") || !rpcUrl.startsWith("https://")) return null;
  const { createSql, postgresRewardsStore } = await import("./postgres.ts");
  const { heliusChain, heliusRpc } = await import("./chain.ts");
  const sql = createSql(databaseUrl);
  return {
    store: postgresRewardsStore(sql),
    chain: heliusChain((method, params) => heliusRpc(rpcUrl, method, params), rpcUrl),
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function cliMain(argv: string[], env: Env, io: RecoveryIo = {}): Promise<{ code: number; out: string }> {
  try {
    const args = parseArgs(argv);
    if (!args) return rejected("argument");
    if (env.TREST_COLLECTION_RECOVERY_AUTHORIZED !== "true") return rejected("authorisation");
    if (args.approval !== COLLECTION_RECOVERY_APPROVAL) return rejected("approval");
    if (!OPERATOR.test(args.operator)) return rejected("operator");
    if (args.reason.trim().length === 0 || args.reason.length > 240) return rejected("reason");
    if (env.TREST_DEPLOYER_ADDRESS !== CONFIRMED_COLLECTION.deployer) return rejected("deployer");
    if (!financiallySuspended(env)) return rejected("suspended");
    const live = io.store && io.chain ? null : await openLive(env);
    const store = io.store ?? live?.store;
    const chain = io.chain ?? live?.chain;
    if (!store || !chain) return rejected("configuration");
    try {
      const result = await recoverConfirmedCollection({
        authorised: true,
        approval: args.approval,
        operator: args.operator,
        reason: args.reason,
        store,
        chain,
      });
      if (result.ok) return { code: 0, out: result.duplicate ? "duplicate" : "ok" };
      return rejected(result.code);
    } finally {
      await live?.close();
    }
  } catch {
    return rejected("configuration");
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("collection-recovery-cli.ts") || entry.endsWith("collection-recovery-cli.js")) {
  void cliMain(process.argv, process.env).then((result) => {
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  });
}
