import { generateKeyPair, getAddressFromPublicKey, signBytes } from "@solana/kit";

export type MintSigner = {
  publicKey: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  discard: () => void;
};

export async function generateMintSigner(): Promise<MintSigner> {
  const held = await holdMintSigner();
  return { publicKey: held.publicKey, sign: held.sign, discard: held.discard };
}

const remembered = new Map<string, MintSigner & { keypair: () => CryptoKeyPair | null }>();

export function heldMint(launchId: string): (MintSigner & { keypair: () => CryptoKeyPair | null }) | null {
  return remembered.get(launchId) ?? null;
}

export async function rememberMint(launchId: string): Promise<MintSigner & { keypair: () => CryptoKeyPair | null }> {
  const current = remembered.get(launchId);
  if (current) return current;
  const held = await holdMintSigner();
  remembered.set(launchId, held);
  return held;
}

export async function holdMintSigner(): Promise<MintSigner & { keypair: () => CryptoKeyPair | null }> {
  const pair = await generateKeyPair();
  const publicKey = await getAddressFromPublicKey(pair.publicKey);
  let secret: CryptoKey | null = pair.privateKey;
  let keypair: CryptoKeyPair | null = pair;
  return {
    publicKey,
    keypair: () => keypair,
    sign: async (message) => {
      if (!secret) throw new Error("mint key discarded");
      return Uint8Array.from(await signBytes(secret, message));
    },
    discard: () => {
      secret = null;
      keypair = null;
    },
  };
}
