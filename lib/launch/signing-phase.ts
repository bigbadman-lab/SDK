export type SigningPhase =
  | "unavailable"
  | "ready_to_sign"
  | "awaiting_wallet"
  | "wallet_rejected"
  | "signed"
  | "expired"
  | "invalidated"
  | "service_unavailable";

export type LaunchLifecycle =
  | SigningPhase
  | "preparing"
  | "submitting"
  | "awaiting_confirmation"
  | "verifying"
  | "verified"
  | "recovering"
  | "failed";

export function launchLifecycleCopy(phase: LaunchLifecycle): { title: string; body: string; verified: boolean } {
  if (phase === "preparing") return { title: "Preparing", body: "The launch is being prepared. Nothing has been signed.", verified: false };
  if (phase === "submitting") return { title: "Submitting", body: "The signed transaction is waiting for an authorised submission.", verified: false };
  if (phase === "awaiting_confirmation") return { title: "Awaiting confirmation", body: "A signature was submitted. Confirmation is still outstanding.", verified: false };
  if (phase === "verifying") return { title: "Verifying on-chain", body: "The transaction is being checked against the chain. It is not verified yet.", verified: false };
  if (phase === "verified") return { title: "Verified", body: "The recorded chain evidence matches the committed launch.", verified: true };
  if (phase === "recovering") return { title: "Recovering", body: "The network outcome is unresolved. The original mint is unchanged.", verified: false };
  if (phase === "failed") return { title: "Failed", body: "The recorded evidence shows this launch did not succeed.", verified: false };
  const signing = signingPhaseCopy(phase);
  return { title: signing.title, body: signing.body, verified: false };
}

export function signingPhaseCopy(phase: SigningPhase): {
  title: string;
  body: string;
  submits: false;
} {
  if (phase === "ready_to_sign") {
    return {
      title: "Ready to sign",
      body: "Phantom can approve this launch. It will not be submitted.",
      submits: false,
    };
  }
  if (phase === "awaiting_wallet") {
    return {
      title: "Awaiting Phantom approval",
      body: "Approve the transaction in Phantom. Nothing is sent to the network.",
      submits: false,
    };
  }
  if (phase === "wallet_rejected") {
    return {
      title: "Wallet rejected",
      body: "Phantom declined the transaction. No network request was made.",
      submits: false,
    };
  }
  if (phase === "signed") {
    return {
      title: "Signing complete",
      body: "Both signatures are present. The transaction has not been submitted.",
      submits: false,
    };
  }
  if (phase === "expired" || phase === "invalidated") {
    return {
      title: "Transaction invalid or expired",
      body: "This build can no longer be signed. Request a fresh transaction for the same mint.",
      submits: false,
    };
  }
  if (phase === "service_unavailable") {
    return {
      title: "Service unavailable",
      body: "The transaction builder is unavailable. Nothing was signed or submitted.",
      submits: false,
    };
  }
  return {
    title: "Launch unavailable",
    body: "Token creation requires wallet approval. On-chain launching is not available yet.",
    submits: false,
  };
}
