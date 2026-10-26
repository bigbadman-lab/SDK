import { acceptOfficialMint } from "../sdk/official.ts";

export type PublicLaunchAvailability = "unregistered" | "inactive" | "open" | "unavailable";

export type PublicLaunchGate = {
  open: boolean;
  availability: PublicLaunchAvailability;
  mint: string | null;
  rewardsActive: boolean;
};

export function decidePublicLaunchGate(input: {
  present: boolean;
  mint: string | null;
  launchesActive: boolean | null;
  rewardsActive: boolean | null;
  schema: "ready" | "missing";
}): PublicLaunchGate {
  const rewardsActive = input.rewardsActive === true;
  if (input.schema === "missing") {
    return { open: false, availability: "unavailable", mint: null, rewardsActive };
  }
  const accepted = input.present ? acceptOfficialMint(input.mint, null) : null;
  if (!input.present || !accepted || input.launchesActive === null) {
    return { open: false, availability: "unregistered", mint: null, rewardsActive };
  }
  if (input.launchesActive !== true) {
    return { open: false, availability: "inactive", mint: accepted.mint, rewardsActive };
  }
  return { open: true, availability: "open", mint: accepted.mint, rewardsActive };
}

export function publicRecoveryAdmission(input: {
  gateOpen: boolean;
  submissionFound: boolean;
}): "reconcile" | "closed" | "ready_to_build" {
  if (input.submissionFound) return "reconcile";
  if (!input.gateOpen) return "closed";
  return "ready_to_build";
}

export function closedLaunchCopy(availability: PublicLaunchAvailability): string {
  if (availability === "unregistered") {
    return "Token launching opens when the official $SDK mint is registered.";
  }
  if (availability === "unavailable") return "Launching is temporarily unavailable.";
  if (availability === "open") return "Public launches are paired with the canonical $SDK mint.";
  return "Public launches stay paired with $SDK. Launching is not active yet.";
}
