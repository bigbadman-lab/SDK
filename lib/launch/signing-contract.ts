export const SIGNING_PHASE = "05D";

export type SigningRejection = "message_changed" | "blockhash_changed";

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// Phase 05D sequence, not implemented here:
// 1. Load the unsigned v1 message from the authenticated builder.
// 2. Check it against the stored message hash, blockhash, metadata, source, parent, and buy.
// 3. Ask the matching Phantom Wallet Standard account to sign that message.
// 4. If the returned message or blockhash differs, reject the build and request a new one.
// 5. Only after that check passes, add the child-mint signature over those same bytes.
// 6. Verify both signatures, submit the base64 wire, and store the signature.
// This module does not sign, submit, or hold a private key.
export function acceptWalletSignedMessage(input: {
  committedMessage: Uint8Array;
  committedBlockhash: string;
  returnedMessage: Uint8Array;
  returnedBlockhash: string;
}): { ok: true } | { ok: false; code: SigningRejection } {
  if (input.returnedBlockhash !== input.committedBlockhash) {
    return { ok: false, code: "blockhash_changed" };
  }
  if (!equalBytes(input.committedMessage, input.returnedMessage)) {
    return { ok: false, code: "message_changed" };
  }
  return { ok: true };
}
