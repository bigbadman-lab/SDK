import { nativeCollectionInstruction, pumpCreatorFeeDistribution, verifyChildSharing } from "../../../lib/rewards/child-fees.ts";
import type { FeeCategory } from "../../../lib/launch/fees.ts";
import { accountingWindow } from "../../../lib/rewards/ledger.ts";
import { ordinaryWorkAllowed } from "../../../lib/rewards/schedule.ts";

export type ChildCandidate = {
  mint: string;
  quoteMint: string;
  scope: "production" | "test";
  category: FeeCategory;
  launcher: string;
  originator: string | null;
};

export type ChildInstruction = {
  programId: string;
  data: number[];
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
};

export async function serviceChildFees(input: {
  nowMs: number;
  authorised: boolean;
  suspended: boolean;
  emergencyFence: boolean;
  children: readonly ChildCandidate[];
  completedKeys: readonly string[];
  readConfig: (child: ChildCandidate) => Promise<{ adminRevoked: boolean; shareholders: { address: string; shareBps: number }[] } | null>;
  prepare: (child: ChildCandidate) => Promise<readonly ChildInstruction[] | null>;
  submit?: (
    child: ChildCandidate,
    key: string,
    instructions: readonly ChildInstruction[],
    shareholders: readonly { address: string; shareBps: number }[],
  ) => Promise<{ status: "confirmed"; receipts: readonly { address: string; amount: string }[] } | { status: "failed" | "uncertain" | "unreconciled" }>;
}): Promise<{ ok: true; verified: number; submitted: number } | { ok: false; code: "inactive" | "suspended" | "window" }> {
  if (!input.authorised) return { ok: false, code: "inactive" };
  if (!ordinaryWorkAllowed({ suspended: input.suspended, emergencyFence: input.emergencyFence })) {
    return { ok: false, code: "suspended" };
  }
  const window = accountingWindow(input.nowMs);
  if (!window) return { ok: false, code: "window" };
  let verified = 0;
  let submitted = 0;
  for (const child of input.children) {
    try {
      const key = `child:${child.scope}:${child.mint}:${window.startMs}`;
      if (input.completedKeys.includes(key)) continue;
      const observed = await input.readConfig(child);
      if (!observed) continue;
      const sharing = verifyChildSharing({
        category: child.category,
        launcherWallet: child.launcher,
        originatorWallet: child.originator,
        observed: observed.shareholders,
        adminRevoked: observed.adminRevoked,
      });
      if (!sharing.ok) continue;
      const instructions = await input.prepare(child);
      if (!instructions || instructions.length === 0) continue;
      if (instructions.some((instruction) => nativeCollectionInstruction(instruction.data))) continue;
      if (!instructions.some((instruction) => pumpCreatorFeeDistribution(instruction.programId, instruction.data))) continue;
      verified += 1;
      if (!input.submit) continue;
      const result = await input.submit(child, key, instructions, sharing.shareholders);
      if (result.status === "confirmed" && result.receipts.length > 0) submitted += 1;
    } catch {
      continue;
    }
  }
  return { ok: true, verified, submitted };
}
