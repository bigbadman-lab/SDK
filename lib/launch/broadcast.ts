export type BroadcastOutcome = "accepted" | "rejected" | "timeout" | "unknown";

export async function broadcastSignedTransaction(input: {
  wire: Uint8Array;
  authorised: boolean;
  rpc: (wire: Uint8Array) => Promise<BroadcastOutcome>;
}): Promise<{ ok: true; outcome: BroadcastOutcome } | { ok: false; code: "inactive" }> {
  if (input.authorised !== true) return { ok: false, code: "inactive" };
  try {
    const outcome = await input.rpc(input.wire);
    if (outcome !== "accepted" && outcome !== "rejected" && outcome !== "timeout" && outcome !== "unknown") {
      return { ok: true, outcome: "unknown" };
    }
    return { ok: true, outcome };
  } catch {
    return { ok: true, outcome: "unknown" };
  }
}
