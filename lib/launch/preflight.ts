export function preflightMessageBound(
  committedHash: string,
  transactionHash: string | null,
): { ok: true } | { ok: false; code: "message_changed" } {
  if (!transactionHash || transactionHash !== committedHash) return { ok: false, code: "message_changed" };
  return { ok: true };
}

export async function preflightChildLaunch(input: {
  registeredParent: string | null;
  transaction: string | null;
  simulate: (transaction: string) => Promise<boolean>;
}): Promise<
  { ok: true; simulated: true } | { ok: false; code: "parent_unregistered" | "simulation_failed" | "unavailable" }
> {
  if (!input.registeredParent) return { ok: false, code: "parent_unregistered" };
  if (!input.transaction) return { ok: false, code: "unavailable" };
  try {
    const passed = await input.simulate(input.transaction);
    return passed ? { ok: true, simulated: true } : { ok: false, code: "simulation_failed" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
