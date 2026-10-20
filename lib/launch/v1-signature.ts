import {
  getAddressFromPublicKey,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  verifySignature,
  type Address,
  type Transaction,
} from "@solana/kit";

import { acceptWalletSignedMessage } from "./signing-contract.ts";

export type SignatureCode =
  | "blockhash_changed"
  | "expired"
  | "hash"
  | "message_changed"
  | "mint"
  | "signature"
  | "signer"
  | "version";

const PACKET_LIMIT = 4096;
const ACCOUNT_LIMIT = 64;

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bufferSource(bytes));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decode(bytes: Uint8Array): Transaction | null {
  try {
    return getTransactionDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function compiled(transaction: Transaction) {
  try {
    return getCompiledTransactionMessageDecoder().decode(Uint8Array.from(transaction.messageBytes));
  } catch {
    return null;
  }
}

export async function finishLaunchSignatures(input: {
  committedTransaction: Uint8Array;
  walletSignedTransaction: Uint8Array;
  mint: CryptoKeyPair;
  walletAddress: string;
  mintAddress: string;
  messageHash: string;
  blockhash: string;
  expiresAt: number;
  now: number;
}): Promise<
  | { ok: true; transaction: Uint8Array; signers: [string, string] }
  | { ok: false; code: SignatureCode }
> {
  if (input.now >= input.expiresAt) return { ok: false, code: "expired" };
  const committed = decode(input.committedTransaction);
  const returned = decode(input.walletSignedTransaction);
  if (!committed || !returned) return { ok: false, code: "message_changed" };
  const committedMessage = compiled(committed);
  const returnedMessage = compiled(returned);
  if (!committedMessage || !returnedMessage) return { ok: false, code: "message_changed" };
  if (committedMessage.version !== 1 || returnedMessage.version !== 1) {
    return { ok: false, code: "version" };
  }
  const signers = returnedMessage.staticAccounts.slice(0, returnedMessage.header.numSignerAccounts);
  if (signers.length !== 2 || returnedMessage.staticAccounts.length > ACCOUNT_LIMIT) {
    return { ok: false, code: "signer" };
  }
  const wallet = signers[0];
  const mint = signers[1];
  if (!wallet || !mint) return { ok: false, code: "signer" };
  if (wallet !== input.walletAddress || mint !== input.mintAddress) {
    return { ok: false, code: "mint" };
  }
  const minted = await getAddressFromPublicKey(input.mint.publicKey);
  if (minted !== input.mintAddress) return { ok: false, code: "mint" };
  const committedBytes = Uint8Array.from(committed.messageBytes);
  const returnedBytes = Uint8Array.from(returned.messageBytes);
  const accepted = acceptWalletSignedMessage({
    committedMessage: committedBytes,
    committedBlockhash: String(committedMessage.lifetimeToken),
    returnedMessage: returnedBytes,
    returnedBlockhash: String(returnedMessage.lifetimeToken),
  });
  if (!accepted.ok) return accepted;
  if (String(returnedMessage.lifetimeToken) !== input.blockhash) {
    return { ok: false, code: "blockhash_changed" };
  }
  if ((await digest(returnedBytes)) !== input.messageHash) return { ok: false, code: "hash" };
  const walletSignature = returned.signatures[wallet as Address];
  if (!walletSignature) return { ok: false, code: "signature" };
  const walletKey = await getPublicKeyFromAddress(wallet);
  const walletOk = await verifySignature(walletKey, walletSignature, returnedBytes);
  if (!walletOk) return { ok: false, code: "signature" };
  const signed = await partiallySignTransaction([input.mint], returned);
  const mintSignature = signed.signatures[mint as Address];
  if (!mintSignature) return { ok: false, code: "signature" };
  const mintOk = await verifySignature(input.mint.publicKey, mintSignature, Uint8Array.from(signed.messageBytes));
  if (!mintOk) return { ok: false, code: "signature" };
  const wire = Uint8Array.from(getTransactionEncoder().encode(signed));
  if (wire.byteLength > PACKET_LIMIT) return { ok: false, code: "signer" };
  const finalMessage = Uint8Array.from(signed.messageBytes);
  if (finalMessage.byteLength !== returnedBytes.byteLength || finalMessage.some((byte, index) => byte !== returnedBytes[index])) {
    return { ok: false, code: "message_changed" };
  }
  return { ok: true, transaction: wire, signers: [wallet, mint] };
}

export async function messageHashOf(transaction: Uint8Array): Promise<string | null> {
  const decoded = decode(transaction);
  if (!decoded) return null;
  return digest(Uint8Array.from(decoded.messageBytes));
}

export async function verifySignedCommitment(input: {
  transaction: Uint8Array;
  walletAddress: string;
  mintAddress: string;
  messageHash: string;
  blockhash: string;
  expiresAt: number;
  now: number;
  metadataUri: string;
  committedMetadataUri: string;
  buyAmount: string;
  committedBuyAmount: string;
  shareholders: readonly { address: string; shareBps: number }[];
  committedShareholders: readonly { address: string; shareBps: number }[];
}): Promise<{ ok: true; signers: [string, string] } | { ok: false; code: SignatureCode | "lineage" }> {
  if (input.now >= input.expiresAt) return { ok: false, code: "expired" };
  if (input.metadataUri !== input.committedMetadataUri || input.buyAmount !== input.committedBuyAmount) {
    return { ok: false, code: "lineage" };
  }
  const shareholderKey = (rows: readonly { address: string; shareBps: number }[]) =>
    rows.map((row) => `${row.address}:${row.shareBps}`).join(",");
  if (shareholderKey(input.shareholders) !== shareholderKey(input.committedShareholders)) {
    return { ok: false, code: "lineage" };
  }
  const decoded = decode(input.transaction);
  if (!decoded) return { ok: false, code: "message_changed" };
  const message = compiled(decoded);
  if (!message || message.version !== 1) return { ok: false, code: "version" };
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  if (signers.length !== 2) return { ok: false, code: "signer" };
  const wallet = signers[0];
  const mint = signers[1];
  if (!wallet || !mint || wallet !== input.walletAddress || mint !== input.mintAddress) {
    return { ok: false, code: "mint" };
  }
  const bytes = Uint8Array.from(decoded.messageBytes);
  if (String(message.lifetimeToken) !== input.blockhash) return { ok: false, code: "blockhash_changed" };
  if ((await digest(bytes)) !== input.messageHash) return { ok: false, code: "hash" };
  const walletSignature = decoded.signatures[wallet as Address];
  const mintSignature = decoded.signatures[mint as Address];
  if (!walletSignature || !mintSignature) return { ok: false, code: "signature" };
  const walletOk = await verifySignature(await getPublicKeyFromAddress(wallet), walletSignature, bytes);
  const mintOk = await verifySignature(await getPublicKeyFromAddress(mint), mintSignature, bytes);
  if (!walletOk || !mintOk) return { ok: false, code: "signature" };
  return { ok: true, signers: [wallet, mint] };
}
