import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import { PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { signedTransactionWire } from "../../../lib/rewards/inspect.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { classifySendFailure, sanitiseRpcDetail } from "./chain.ts";
import { buildSolCollection } from "./instructions.ts";

const PARENT = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";

test("RPC diagnostics keep a preflight rejection and redact URLs", () => {
  const classified = classifySendFailure({
    kind: "rpc",
    code: -32002,
    message: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1",
    logs: ["Program log: insufficient funds", "see https://rpc.example/v0?api-key=super-secret-value"],
  });
  assert.equal(classified.status, "preflight");
  assert.equal(classified.code, "rpc:-32002");
  assert.equal(classified.detail.includes("custom program error"), true);
  assert.equal(classified.detail.includes("insufficient funds"), true);
  assert.equal(classified.detail.includes("https://"), false);
  assert.equal(classified.detail.includes("super-secret-value"), false);
  assert.equal(classified.detail.includes("[redacted-url]"), true);
});

test("a transport timeout stays uncertain", () => {
  const classified = classifySendFailure({ kind: "transport", code: null, message: "timeout", logs: [] });
  assert.equal(classified.status, "uncertain");
  assert.equal(classified.code, "timeout");
});

test("blockhash expiry and an invalid transaction stay distinct from success", () => {
  assert.equal(classifySendFailure({ kind: "rpc", code: -32002, message: "Blockhash not found", logs: [] }).status, "expired");
  assert.equal(
    classifySendFailure({ kind: "rpc", code: -32002, message: "Transaction signature verification failure", logs: [] }).status,
    "rejected",
  );
  assert.equal(classifySendFailure({ kind: "http", code: 500, message: "http", logs: [] }).status, "uncertain");
  assert.equal(sanitiseRpcDetail("ok", []).length <= 240, true);
});

test("the collect instruction wire verifies the inspected message", async () => {
  const pair = nacl.sign.keyPair();
  const creator = new PublicKey(pair.publicKey).toBase58();
  const built = await buildSolCollection({ creator, ammVaultExists: false });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.instructions.map((instruction) => instruction.name), ["collectCreatorFeeV2"]);
  const blockhash = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const transaction = {
    feePayer: creator,
    recentBlockhash: blockhash,
    instructions: built.instructions.map((instruction) => ({
      programId: instruction.programId,
      keys: instruction.keys,
      data: instruction.data,
    })),
  };
  const signed = signInspected({
    secret: bs58.encode(pair.secretKey),
    expectedAddress: creator,
    suspended: false,
    transaction,
    policy: {
      kind: "collect",
      scope: "test",
      parentMint: PARENT,
      deployer: creator,
      recipient: creator,
      maxLamports: "0",
      maxRentLamports: "50000000",
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    },
  });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const wire = signedTransactionWire(transaction, signed.signature);
  assert.ok(wire);
  if (!wire) return;
  const parsed = Transaction.from(wire);
  assert.deepEqual(Buffer.from(parsed.serializeMessage()), Buffer.from(signed.message));
  assert.equal(nacl.sign.detached.verify(parsed.serializeMessage(), bs58.decode(signed.signature), pair.publicKey), true);
  assert.equal(parsed.instructions[0]?.programId.toBase58(), PUMP_PROGRAM_ID);
  assert.equal(parsed.feePayer?.toBase58(), creator);
  assert.equal(parsed.recentBlockhash, blockhash);
  assert.equal(parsed.signatures.length, 1);
});
