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

const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

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
  if (
    String(committedMessage.lifetimeToken) !== input.blockhash ||
    String(returnedMessage.lifetimeToken) !== input.blockhash
  ) {
    return { ok: false, code: "blockhash_changed" };
  }
  if ((await digest(committedBytes)) !== input.messageHash) return { ok: false, code: "hash" };
  const preserved =
    bytesEqual(committedBytes, returnedBytes) ||
    phantomPreservedLaunch(committedMessage as V1Message, returnedMessage as V1Message);
  if (!preserved) return { ok: false, code: "message_changed" };
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
  committedTransaction?: Uint8Array;
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
  if ((await digest(bytes)) !== input.messageHash) {
    const stored = input.committedTransaction ? decode(input.committedTransaction) : null;
    const storedMessage = stored ? compiled(stored) : null;
    if (!stored || !storedMessage || storedMessage.version !== 1) return { ok: false, code: "hash" };
    const storedBytes = Uint8Array.from(stored.messageBytes);
    if ((await digest(storedBytes)) !== input.messageHash) return { ok: false, code: "hash" };
    if (!phantomPreservedLaunch(storedMessage as V1Message, message as V1Message)) {
      return { ok: false, code: "message_changed" };
    }
  }
  const walletSignature = decoded.signatures[wallet as Address];
  const mintSignature = decoded.signatures[mint as Address];
  if (!walletSignature || !mintSignature) return { ok: false, code: "signature" };
  const walletOk = await verifySignature(await getPublicKeyFromAddress(wallet), walletSignature, bytes);
  const mintOk = await verifySignature(await getPublicKeyFromAddress(mint), mintSignature, bytes);
  if (!walletOk || !mintOk) return { ok: false, code: "signature" };
  return { ok: true, signers: [wallet, mint] };
}

type V1Message = {
  configMask: number;
  configValues: readonly { kind: string; value: number | bigint }[];
  header: {
    numSignerAccounts: number;
    numReadonlySignerAccounts: number;
    numReadonlyNonSignerAccounts: number;
  };
  staticAccounts: readonly string[];
  instructionHeaders: readonly { programAccountIndex: number }[];
  instructionPayloads: readonly {
    instructionAccountIndices: ArrayLike<number>;
    instructionData: ArrayLike<number>;
  }[];
  lifetimeToken: unknown;
};

function bytesEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function accountWritable(message: V1Message, index: number): boolean {
  const writableSigners = message.header.numSignerAccounts - message.header.numReadonlySignerAccounts;
  const readonlyTail = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
  return index < writableSigners || (index >= message.header.numSignerAccounts && index < readonlyTail);
}

function phantomPreservedLaunch(committed: V1Message, returned: V1Message): boolean {
  if (String(committed.lifetimeToken) !== String(returned.lifetimeToken)) return false;
  if (committed.configMask !== returned.configMask || committed.configValues.length !== returned.configValues.length) {
    return false;
  }
  const sameConfig = committed.configValues.every((item, index) => {
    const other = returned.configValues[index];
    if (!other || item.kind !== other.kind) return false;
    return item.kind === "u64" || item.value === other.value;
  });
  if (!sameConfig) return false;
  const committedSigners = committed.staticAccounts.slice(0, committed.header.numSignerAccounts);
  const returnedSigners = returned.staticAccounts.slice(0, returned.header.numSignerAccounts);
  if (committedSigners.length !== returnedSigners.length || committedSigners.some((account, index) => account !== returnedSigners[index])) {
    return false;
  }
  for (let index = 0; index < committed.staticAccounts.length; index += 1) {
    const account = committed.staticAccounts[index];
    const returnedIndex = returned.staticAccounts.indexOf(account ?? "");
    if (returnedIndex < 0) return false;
    if (accountWritable(committed, index) !== accountWritable(returned, returnedIndex)) return false;
    if ((index < committed.header.numSignerAccounts) !== (returnedIndex < returned.header.numSignerAccounts)) return false;
  }
  for (let index = 0; index < returned.staticAccounts.length; index += 1) {
    const account = returned.staticAccounts[index];
    if (account && !committed.staticAccounts.includes(account) && index < returned.header.numSignerAccounts) return false;
  }
  if (returned.instructionPayloads.length < committed.instructionPayloads.length) return false;
  for (let index = 0; index < committed.instructionPayloads.length; index += 1) {
    if (!sameInstruction(committed, returned, index)) return false;
  }
  for (let index = committed.instructionPayloads.length; index < returned.instructionPayloads.length; index += 1) {
    const header = returned.instructionHeaders[index];
    if (!header || returned.staticAccounts[header.programAccountIndex] !== LIGHTHOUSE_PROGRAM) return false;
  }
  return true;
}

function sameInstruction(committed: V1Message, returned: V1Message, index: number): boolean {
  const committedHeader = committed.instructionHeaders[index];
  const returnedHeader = returned.instructionHeaders[index];
  const committedPayload = committed.instructionPayloads[index];
  const returnedPayload = returned.instructionPayloads[index];
  if (!committedHeader || !returnedHeader || !committedPayload || !returnedPayload) return false;
  if (committed.staticAccounts[committedHeader.programAccountIndex] !== returned.staticAccounts[returnedHeader.programAccountIndex]) {
    return false;
  }
  if (!bytesEqual(committedPayload.instructionData, returnedPayload.instructionData)) return false;
  const committedAccounts = Array.from(committedPayload.instructionAccountIndices);
  const returnedAccounts = Array.from(returnedPayload.instructionAccountIndices);
  if (committedAccounts.length !== returnedAccounts.length) return false;
  return committedAccounts.every((accountIndex, key) => {
    const returnedIndex = returnedAccounts[key];
    return returnedIndex !== undefined && committed.staticAccounts[accountIndex] === returned.staticAccounts[returnedIndex];
  });
}
