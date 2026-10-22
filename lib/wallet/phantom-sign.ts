import { assessPhantomCapability, observeWallet, type WalletCapability } from "./phantom-capability.ts";

const MAINNET = "solana:mainnet";

type PhantomAccount = {
  readonly address: string;
  readonly chains: readonly string[];
  readonly features: readonly string[];
};

type StandardSignFeature = {
  supportedTransactionVersions?: readonly (string | number)[];
  signTransaction?: (input: {
    account: PhantomAccount;
    chain: string;
    transaction: Uint8Array;
  }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};

function mainnetChain(chains: readonly string[]): string | null {
  if (chains.includes(MAINNET)) return MAINNET;
  return chains.find((chain) => chain.startsWith("solana:") && chain.includes("mainnet")) ?? null;
}

export function readPhantomSigner(wallet: {
  name: string;
  accounts: readonly PhantomAccount[];
  features: Readonly<Record<string, unknown>>;
}): PhantomSignInput {
  const observed = observeWallet(wallet);
  const feature = wallet.features["solana:signTransaction"];
  const signer = feature && typeof feature === "object" ? (feature as StandardSignFeature) : null;
  return {
    name: observed.name,
    accounts: observed.accounts,
    signTransactionVersions: observed.signTransactionVersions,
    ...(signer?.signTransaction
      ? {
          signTransaction: async (transaction: Uint8Array, account: string) => {
            const selected = wallet.accounts.find((item) => item.address === account);
            const chain = selected ? mainnetChain(selected.chains) : null;
            if (!selected || !chain || !selected.features.includes("solana:signTransaction")) {
              throw new Error("Phantom account cannot sign on mainnet");
            }
            const outputs = await signer.signTransaction?.({ account: selected, chain, transaction });
            const signed = outputs?.[0]?.signedTransaction;
            if (!signed) throw new Error("empty signature");
            return signed;
          },
        }
      : {}),
  };
}

export type PhantomSignInput = {
  name: string;
  accounts: readonly { address: string }[];
  signTransactionVersions: readonly (string | number)[] | null;
  signTransaction?: (transaction: Uint8Array, account: string) => Promise<Uint8Array>;
};

export async function requestPhantomSignature(input: {
  sessionAddress: string | null;
  connectedAddress: string | null;
  wallets: readonly PhantomSignInput[];
  transaction: Uint8Array;
}): Promise<
  | { ok: true; signedTransaction: Uint8Array }
  | { ok: false; code: WalletCapability | "sign_rejected" | "sign_empty" }
> {
  const capability = assessPhantomCapability({
    sessionAddress: input.sessionAddress,
    connectedAddress: input.connectedAddress,
    wallets: input.wallets,
  });
  if (capability !== "ready" || !input.connectedAddress) {
    return { ok: false, code: capability };
  }
  const phantom = input.wallets.find(
    (wallet) =>
      wallet.name === "Phantom" &&
      wallet.accounts.some((account) => account.address === input.connectedAddress),
  );
  if (!phantom?.signTransaction) return { ok: false, code: "wallet_feature_unavailable" };
  try {
    const signed = await phantom.signTransaction(input.transaction, input.connectedAddress);
    if (signed.byteLength === 0) return { ok: false, code: "sign_empty" };
    return { ok: true, signedTransaction: signed };
  } catch (error) {
    console.error("Phantom sign failed", error instanceof Error ? error.message : "rejected");
    return { ok: false, code: "sign_rejected" };
  }
}
