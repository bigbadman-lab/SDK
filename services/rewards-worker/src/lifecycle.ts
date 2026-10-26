import { randomUUID } from "node:crypto";

import { admitTick } from "../../../lib/rewards/production.ts";

let stopping = false;
let busy = false;

export function instanceHolder(): string {
  return `rewards-${randomUUID()}`;
}

export function requestShutdown(): void {
  stopping = true;
}

export function shutdownRequested(): boolean {
  return stopping;
}

export function beginTick(): boolean {
  if (admitTick({ stopping, busy }) !== "run") return false;
  busy = true;
  return true;
}

export function endTick(): void {
  busy = false;
}
