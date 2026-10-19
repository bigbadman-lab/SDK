import assert from "node:assert/strict";
import test from "node:test";

import { acceptWalletSignedMessage } from "./signing-contract.ts";

const message = Uint8Array.of(1, 2, 3, 4);
const blockhash = "11111111111111111111111111111111";

test("a wallet return is accepted only when the message and blockhash are unchanged", () => {
  assert.deepEqual(
    acceptWalletSignedMessage({
      committedMessage: message,
      committedBlockhash: blockhash,
      returnedMessage: message,
      returnedBlockhash: blockhash,
    }),
    { ok: true },
  );
  assert.deepEqual(
    acceptWalletSignedMessage({
      committedMessage: message,
      committedBlockhash: blockhash,
      returnedMessage: Uint8Array.of(1, 2, 3, 5),
      returnedBlockhash: blockhash,
    }),
    { ok: false, code: "message_changed" },
  );
  assert.deepEqual(
    acceptWalletSignedMessage({
      committedMessage: message,
      committedBlockhash: blockhash,
      returnedMessage: message,
      returnedBlockhash: "22222222222222222222222222222222",
    }),
    { ok: false, code: "blockhash_changed" },
  );
});
