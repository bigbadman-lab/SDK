import { signingPhaseCopy, type SigningPhase } from "@/lib/launch/signing-phase";
import type { ReactNode } from "react";

export function LaunchSigningStatus({ phase }: { phase: SigningPhase }): ReactNode {
  const copy = signingPhaseCopy(phase);
  return (
    <p
      id="launch-not-ready"
      data-signing-phase={phase}
      data-submits="false"
      className="mt-4 text-[13px] leading-[1.5] text-muted-foreground"
    >
      {copy.body}
    </p>
  );
}
