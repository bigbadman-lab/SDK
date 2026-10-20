import { accountingWindow } from "./ledger.ts";

export function nextUtcWindowDelay(nowMs: number): number {
  const window = accountingWindow(nowMs);
  if (!window) return 60_000;
  const delay = window.endMs - nowMs;
  return delay <= 0 ? 1_000 : delay;
}

export function ordinaryWorkAllowed(input: { suspended: boolean; emergencyFence: boolean }): boolean {
  return !input.suspended && !input.emergencyFence;
}
