export const PHANTOM_WALLET_NAME = "Phantom";

export type WalletCapability =
  | "ready"
  | "wallet_disconnected"
  | "unsupported_wallet"
  | "phantom_v1_unavailable"
  | "wallet_account_mismatch"
  | "wallet_feature_unavailable"
  | "wallet_session_invalid";

export type ObservedWallet = {
  name: string;
  accounts: readonly { address: string }[];
  signTransactionVersions: readonly (string | number)[] | null;
};

export function observeWallet(wallet: {
  name: string;
  accounts: readonly { address: string }[];
  features: Readonly<Record<string, unknown>>;
}): ObservedWallet {
  const feature = wallet.features["solana:signTransaction"];
  const versions =
    feature &&
    typeof feature === "object" &&
    "supportedTransactionVersions" in feature &&
    Array.isArray(feature.supportedTransactionVersions)
      ? feature.supportedTransactionVersions.filter(
          (version): version is string | number => typeof version === "string" || typeof version === "number",
        )
      : null;
  return {
    name: wallet.name,
    accounts: wallet.accounts.map((account) => ({ address: account.address })),
    signTransactionVersions: versions,
  };
}

export function assessPhantomCapability(input: {
  sessionAddress: string | null;
  connectedAddress: string | null;
  wallets: readonly ObservedWallet[];
}): WalletCapability {
  if (!input.connectedAddress) return "wallet_disconnected";
  if (!input.sessionAddress || input.sessionAddress !== input.connectedAddress) {
    return "wallet_session_invalid";
  }
  const holding = input.wallets.filter((wallet) =>
    wallet.accounts.some((account) => account.address === input.connectedAddress),
  );
  const phantom = holding.find((wallet) => wallet.name === PHANTOM_WALLET_NAME);
  if (!phantom) {
    const phantomElsewhere = input.wallets.some((wallet) => wallet.name === PHANTOM_WALLET_NAME);
    if (phantomElsewhere && holding.length === 0) return "wallet_account_mismatch";
    return "unsupported_wallet";
  }
  if (phantom.signTransactionVersions === null) return "wallet_feature_unavailable";
  const versions = phantom.signTransactionVersions.map((version) => String(version));
  if (!versions.includes("1")) return "phantom_v1_unavailable";
  return "ready";
}

export type CapabilityDiagnostic = {
  reownConnected: boolean;
  identifiedAsPhantom: boolean;
  sessionMatches: boolean;
  phantomAccountFound: boolean;
  signTransactionAvailable: boolean;
  advertisedVersions: readonly (string | number)[] | null;
  v1Supported: boolean;
  state: WalletCapability;
};

export function describePhantomCapability(input: {
  sessionAddress: string | null;
  connectedAddress: string | null;
  wallets: readonly ObservedWallet[];
}): CapabilityDiagnostic {
  const state = assessPhantomCapability(input);
  const matching = input.connectedAddress
    ? input.wallets.find(
        (wallet) =>
          wallet.name === PHANTOM_WALLET_NAME &&
          wallet.accounts.some((account) => account.address === input.connectedAddress),
      )
    : undefined;
  const versions = matching?.signTransactionVersions ?? null;
  return {
    reownConnected: Boolean(input.connectedAddress),
    identifiedAsPhantom: Boolean(matching),
    sessionMatches: Boolean(
      input.sessionAddress &&
        input.connectedAddress &&
        input.sessionAddress === input.connectedAddress,
    ),
    phantomAccountFound: Boolean(matching),
    signTransactionAvailable: versions !== null,
    advertisedVersions: versions,
    v1Supported: versions?.some((version) => String(version) === "1") ?? false,
    state,
  };
}

export function formatAdvertisedVersions(
  versions: readonly (string | number)[] | null,
): string {
  if (!versions || versions.length === 0) return "none";
  return versions.map((version) => String(version)).join(", ");
}

export function phantomCapabilityCopy(
  state: WalletCapability,
): { title: string; body: string } | null {
  if (state === "ready") return null;
  if (state === "phantom_v1_unavailable") {
    return {
      title: "Update Phantom to launch",
      body: "Your current Phantom version does not advertise support for Solana v1 transactions. Update Phantom and reconnect.",
    };
  }
  return {
    title: "Phantom required",
    body: "SDK currently supports Phantom for token launches. Connect a compatible Phantom wallet to continue.",
  };
}
