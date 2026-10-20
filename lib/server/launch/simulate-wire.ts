import "server-only";

import { messageHashOf } from "@/lib/launch/v1-signature";
import { preflightMessageBound } from "@/lib/launch/preflight";

export async function simulateExactWire(input: {
  transaction: string;
  committedHash: string;
}): Promise<{ ok: true; messageHash: string } | { ok: false; code: "message_changed" | "simulation_failed" | "unavailable" }> {
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(input.transaction, "base64");
  } catch {
    return { ok: false, code: "message_changed" };
  }
  const hash = await messageHashOf(bytes);
  const bound = preflightMessageBound(input.committedHash, hash);
  if (!bound.ok) return bound;
  const url = process.env.HELIUS_RPC_URL?.trim();
  if (!url) return { ok: false, code: "unavailable" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [input.transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "processed" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, code: "unavailable" };
    const body = (await response.json()) as { result?: { value?: { err?: unknown } } };
    if (body.result?.value?.err === null) return { ok: true, messageHash: input.committedHash };
    return { ok: false, code: "simulation_failed" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
