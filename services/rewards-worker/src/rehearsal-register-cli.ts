// Operator-only registration for one bounded TREST rehearsal.
// The rewards worker never imports this file. Do not set
// TREST_REHEARSAL_REGISTRATION_AUTHORIZED on Render. This command does not
// read a signing key, unsuspend a control, or broadcast.

import type postgres from "postgres";

import { WINDOW_MS } from "../../../lib/rewards/ledger.ts";
import { TREST_REHEARSAL_MINT, validRehearsalStarts, type RehearsalState, type RewardsStore } from "./store.ts";

type Database = ReturnType<typeof postgres>;

type Env = Record<string, string | undefined>;

export const REHEARSAL_APPROVAL = "TREST-07I-THREE-WINDOW-REHEARSAL";
export const SIX_WINDOW_APPROVAL = "TREST-07L-SIX-WINDOW-REHEARSAL";
export const DAY_REHEARSAL_APPROVAL = "TREST-08B-DAY-REHEARSAL";
export const DEFAULT_LEAD_MINUTES = 10;
export const MAX_LEAD_MINUTES = 180;
export const WORKER_SERVICE_ID = "srv-dbbrdfgu01pc738pd27g";
const WORKER_HEALTH_URL = "https://sdk-rewards-worker.onrender.com/health";
const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;
const VALUE_FLAGS = ["--approval", "--operator", "--reason", "--lead-minutes"] as const;

export type SuspensionEvidence = {
  loopEnabled: string;
  executionAuthorised: string;
  signerSuspended: string;
  runtime: string;
  loop: boolean;
  broadcasts: boolean;
  executionAuthorisedHealth: boolean;
};

export type RehearsalIo = {
  store?: RewardsStore;
  now?: () => Promise<number>;
  fence?: () => Promise<boolean>;
  suspension?: () => Promise<SuspensionEvidence | null>;
};

type Args = { approval: string; operator: string; reason: string; leadMinutes: number; dryRun: boolean };

function rejected(code: string): { code: number; out: string } {
  return { code: 2, out: `rejected ${code}` };
}

export function selectRehearsalWindows(nowMs: number, leadMinutes: number, windows: 3 | 6 | 288 = 3): number[] | null {
  if (!Number.isInteger(nowMs) || nowMs <= 0) return null;
  if (!Number.isInteger(leadMinutes) || leadMinutes < DEFAULT_LEAD_MINUTES || leadMinutes > MAX_LEAD_MINUTES) return null;
  const earliest = nowMs + leadMinutes * 60_000;
  const remainder = earliest % WINDOW_MS;
  const first = remainder === 0 ? earliest : earliest + (WINDOW_MS - remainder);
  const starts = validRehearsalStarts(Array.from({ length: windows }, (_, index) => first + WINDOW_MS * index));
  if (!starts || (starts[0] ?? 0) <= nowMs) return null;
  return starts;
}

function windowCount(approval: string): 3 | 6 | 288 | null {
  if (approval === REHEARSAL_APPROVAL) return 3;
  if (approval === SIX_WINDOW_APPROVAL) return 6;
  if (approval === DAY_REHEARSAL_APPROVAL) return 288;
  return null;
}

function parseLead(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_LEAD_MINUTES;
  if (!/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const lead = Number(value);
  if (!Number.isInteger(lead) || lead < DEFAULT_LEAD_MINUTES || lead > MAX_LEAD_MINUTES) return null;
  return lead;
}

function parseArgs(argv: string[]): Args | null | "lead" {
  const values = new Map<string, string>();
  let dryRun = false;
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (name === "--dry-run") {
      if (dryRun || equals !== -1) return null;
      dryRun = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(name as (typeof VALUE_FLAGS)[number])) return null;
    if (values.has(name)) return null;
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--")) return null;
    values.set(name, value);
  }
  const approval = values.get("--approval");
  const operator = values.get("--operator");
  const reason = values.get("--reason");
  if (!approval || !operator || !reason) return null;
  const leadMinutes = parseLead(values.get("--lead-minutes"));
  if (leadMinutes === null) return "lead";
  return { approval, operator, reason, leadMinutes, dryRun };
}

function suspended(evidence: SuspensionEvidence | null): evidence is SuspensionEvidence {
  return evidence !== null
    && evidence.loopEnabled === "false"
    && evidence.executionAuthorised === "false"
    && evidence.signerSuspended === "true"
    && evidence.runtime === "suspended"
    && evidence.loop === false
    && evidence.broadcasts === false
    && evidence.executionAuthorisedHealth === false;
}

function scheduleText(kind: "dry-run" | "ok" | "reconciled", nowMs: number, starts: readonly number[], existing: number, accepted: boolean): string {
  const labels = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const first = starts[0] ?? nowMs;
  const finalStart = starts[starts.length - 1] ?? first;
  const windowLines = starts.length > labels.length
    ? [
        `windows=${starts.length}`,
        `first=${new Date(first).toISOString()}`,
        `final=${new Date(finalStart + WINDOW_MS).toISOString()}`,
      ]
    : starts.map((start, index) => `${labels[index] ?? "window"}=${new Date(start).toISOString()}`);
  const lines = [
    kind,
    `database_utc=${new Date(nowMs).toISOString()}`,
    ...windowLines,
    `lead_ms=${first - nowMs}`,
    `existing=${existing}`,
    `accepted=${accepted ? "yes" : "no"}`,
  ];
  if (kind !== "dry-run") lines.push("claimed=0", "status=open");
  return lines.join("\n");
}

function matchesSchedule(state: RehearsalState, starts: readonly number[], generation: number): boolean {
  return state.status === "open"
    && state.generation === generation
    && state.processed.length === 0
    && state.blocksSideWork
    && state.windowStartsMs.length === starts.length
    && state.windowStartsMs.every((start, index) => start === starts[index]);
}

export async function databaseNow(sql: Database): Promise<number | null> {
  const rows = await sql.unsafe("select (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text as ms") as { ms: string }[];
  const ms = Number(rows[0]?.ms);
  return Number.isInteger(ms) && ms > 0 ? ms : null;
}

export async function rehearsalFencePresent(sql: Database): Promise<boolean> {
  const rows = await sql.unsafe(`
    select (
      to_regclass('public.reward_rehearsals') is not null
      and to_regclass('public.reward_rehearsal_windows') is not null
      and exists (select 1 from pg_constraint where conname = 'reward_rehearsals_identity_check')
      and exists (select 1 from pg_constraint where conname = 'reward_rehearsals_windows_check')
      and (
        exists (select 1 from pg_constraint where conname = 'reward_rehearsals_parent_unique')
        or exists (select 1 from pg_constraint where conname = 'reward_rehearsals_generation_unique')
      )
    ) as ok
  `) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

async function openDatabase(env: Env): Promise<{ sql: Database; store: RewardsStore; close: () => Promise<void> } | null> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) return null;
  const { createSql, postgresRewardsStore } = await import("./postgres.ts");
  const sql = createSql(databaseUrl);
  return { sql, store: postgresRewardsStore(sql), close: () => sql.end({ timeout: 5 }) };
}

async function readSuspension(env: Env): Promise<SuspensionEvidence | null> {
  const apiKey = env.RENDER_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  const host = (env.RENDER_API_HOST?.trim() || "https://api.render.com/v1").replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/services/${WORKER_SERVICE_ID}/env-vars?limit=100`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const flags = new Map<string, string>();
    for (const row of Array.isArray(body) ? body : []) {
      const item = row && typeof row === "object" && "envVar" in row ? row.envVar : row;
      if (!item || typeof item !== "object" || !("key" in item) || !("value" in item)) continue;
      if (typeof item.key === "string" && typeof item.value === "string") flags.set(item.key, item.value);
    }
    const healthResponse = await fetch(WORKER_HEALTH_URL);
    if (!healthResponse.ok) return null;
    const health: unknown = await healthResponse.json();
    if (!health || typeof health !== "object") return null;
    const record = health as Record<string, unknown>;
    return {
      loopEnabled: flags.get("REWARDS_LOOP_ENABLED") ?? "",
      executionAuthorised: flags.get("REWARDS_EXECUTION_AUTHORIZED") ?? "",
      signerSuspended: flags.get("TREST_SIGNER_SUSPENDED") ?? "",
      runtime: typeof record.runtime === "string" ? record.runtime : "",
      loop: record.loop === true,
      broadcasts: record.broadcasts === true,
      executionAuthorisedHealth: record.executionAuthorised === true,
    };
  } catch {
    return null;
  }
}

export async function cliMain(argv: string[], env: Env, io: RehearsalIo = {}): Promise<{ code: number; out: string }> {
  const live = { close: async () => undefined as void };
  let opened: { sql: Database; store: RewardsStore; close: () => Promise<void> } | null = null;
  try {
    const args = parseArgs(argv);
    if (args === "lead") return rejected("lead");
    if (!args) return rejected("argument");
    if (!args.dryRun && env.TREST_REHEARSAL_REGISTRATION_AUTHORIZED !== "true") return rejected("authorisation");
    const windows = windowCount(args.approval);
    if (!windows) return rejected("approval");
    if (!OPERATOR.test(args.operator)) return rejected("operator");
    if (args.reason.trim().length === 0 || args.reason.length > 240) return rejected("reason");
    opened = io.store && io.now && io.fence ? null : await openDatabase(env);
    const store = io.store ?? opened?.store;
    if (!store) return rejected("configuration");
    if (opened) live.close = opened.close;
    const evidence = io.suspension ? await io.suspension() : await readSuspension(env);
    if (!suspended(evidence)) return rejected(evidence ? "suspended" : "render");
    const fence = io.fence ? await io.fence() : opened ? await rehearsalFencePresent(opened.sql) : false;
    if (!fence) return rejected("fence");
    const control = await store.control(TREST_REHEARSAL_MINT, "test");
    if (!control?.suspended) return rejected("suspended");
    const existing = await store.rehearsalState(TREST_REHEARSAL_MINT, "test");
    if (!args.dryRun && existing?.status === "open") return rejected("existing");
    const nowMs = io.now ? await io.now() : opened ? await databaseNow(opened.sql) : null;
    if (nowMs === null) return rejected("clock");
    const starts = selectRehearsalWindows(nowMs, args.leadMinutes, windows);
    if (!starts) return rejected("schedule");
    const generation = existing ? existing.generation + 1 : 1;
    const accepted = existing?.status !== "open";
    if (args.dryRun) {
      return { code: 0, out: scheduleText("dry-run", nowMs, starts, existing ? 1 : 0, accepted) };
    }
    let registered: "ok" | "rejected" | "duplicate" | "lost";
    try {
      registered = await store.registerRehearsal({
        parentMint: TREST_REHEARSAL_MINT,
        scope: "test",
        windowStartsMs: starts,
        nowMs,
        requireUpcoming: true,
        generation,
      });
    } catch {
      registered = "lost";
    }
    const saved = await store.rehearsalState(TREST_REHEARSAL_MINT, "test");
    if (registered === "duplicate") return rejected("existing");
    if (registered === "lost") {
      if (saved && matchesSchedule(saved, starts, generation)) return { code: 0, out: scheduleText("reconciled", nowMs, starts, 1, true) };
      return rejected(saved ? "uncertain" : "registration");
    }
    if (registered !== "ok" || !saved || !matchesSchedule(saved, starts, generation)) return rejected(saved ? "uncertain" : "registration");
    return { code: 0, out: scheduleText("ok", nowMs, starts, existing ? 1 : 0, true) };
  } catch {
    return rejected("configuration");
  } finally {
    await live.close();
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("rehearsal-register-cli.ts") || entry.endsWith("rehearsal-register-cli.js")) {
  void cliMain(process.argv, process.env).then((result) => {
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  });
}
