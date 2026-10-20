import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { derivedDeployerAddress, inspectDeployerSigner, rewardsHealth } from "./signer.ts";

function secretKey(): { secret: string; address: string } {
  const pair = nacl.sign.keyPair();
  return {
    secret: bs58.encode(pair.secretKey),
    address: new PublicKey(pair.publicKey).toBase58(),
  };
}

test("a deployer signer matches only its derived address and stays out of responses", () => {
  const signer = secretKey();
  const other = secretKey();
  assert.equal(derivedDeployerAddress(signer.secret), signer.address);
  assert.deepEqual(inspectDeployerSigner({ secret: signer.secret, expectedAddress: signer.address, suspended: false }), {
    ok: true,
    signer: "matched",
  });
  const mismatch = inspectDeployerSigner({ secret: signer.secret, expectedAddress: other.address, suspended: false });
  const malformed = inspectDeployerSigner({ secret: "not-a-key", expectedAddress: signer.address, suspended: false });
  const encoded = inspectDeployerSigner({ secret: "[1,2,3]", expectedAddress: signer.address, suspended: false });
  const unbound = inspectDeployerSigner({ secret: signer.secret, expectedAddress: null, suspended: false });
  assert.equal(mismatch.ok, false);
  assert.equal(malformed.ok, false);
  assert.equal(encoded.ok, false);
  assert.equal(unbound.ok, false);
  if (mismatch.ok || malformed.ok || encoded.ok || unbound.ok) return;
  assert.equal(mismatch.code, "signer_mismatch");
  assert.equal(malformed.code, "signer_malformed");
  assert.equal(encoded.code, "signer_malformed");
  assert.equal(unbound.code, "signer_unbound");
  assert.deepEqual(inspectDeployerSigner({ secret: null, expectedAddress: null, suspended: false }), {
    ok: true,
    signer: "unconfigured",
  });
  assert.deepEqual(inspectDeployerSigner({ secret: signer.secret, expectedAddress: signer.address, suspended: true }), {
    ok: true,
    signer: "suspended",
  });
  const health = rewardsHealth("matched");
  assert.equal(health.http, "ok");
  assert.equal(health.runtime, "inactive");
  assert.equal(health.signing, false);
  assert.equal(health.broadcasts, false);
  assert.equal(rewardsHealth("suspended").runtime, "suspended");
  assert.equal(rewardsHealth("unconfigured").runtime, "unconfigured");
  const ready = rewardsHealth("matched", true);
  assert.equal(ready.runtime, "ready");
  assert.equal(ready.signing, false);
  assert.equal(ready.loop, true);
  assert.equal(JSON.stringify(health).includes(signer.secret), false);
  assert.equal(JSON.stringify(inspectDeployerSigner({ secret: signer.secret, expectedAddress: other.address, suspended: false })).includes(signer.secret), false);
});
