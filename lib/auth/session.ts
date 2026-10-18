export const SESSION_COOKIE = "sdk_session";
export const INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SLIDE_AFTER_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;

export type SolanaNetwork = (typeof NETWORKS)[number];

const SIGN_IN_CHAIN_IDS = {
  "mainnet-beta": "mainnet",
  devnet: "devnet",
  testnet: "testnet",
} as const satisfies Record<SolanaNetwork, string>;

export function configuredNetwork(value: string | undefined): SolanaNetwork {
  if (value && NETWORKS.includes(value as SolanaNetwork)) {
    return value as SolanaNetwork;
  }
  return "mainnet-beta";
}

export function buildSignInMessage(input: {
  domain: string;
  address: string;
  origin: string;
  network: SolanaNetwork;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
    "Sign in to SDK. This does not send a transaction or approve a token launch.",
    "",
    `URI: ${input.origin}`,
    "Version: 1",
    `Chain ID: ${SIGN_IN_CHAIN_IDS[input.network]}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ].join("\n");
}

export function challengeDecision(input: {
  now: number;
  expiresAt: number;
  consumed: boolean;
  domain: string;
  expectedDomain: string;
  network: string;
  expectedNetwork: string;
}): "ok" | "expired" | "used" | "domain" | "network" {
  if (input.consumed) return "used";
  if (input.now >= input.expiresAt) return "expired";
  if (input.domain !== input.expectedDomain) return "domain";
  if (input.network !== input.expectedNetwork) return "network";
  return "ok";
}

export function sessionDecision(input: {
  now: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  revoked: boolean;
}): "invalid" | "active" | "refresh" {
  if (input.revoked) return "invalid";
  if (input.now >= input.absoluteExpiresAt) return "invalid";
  if (input.now - input.lastSeenAt >= INACTIVITY_MS) return "invalid";
  if (input.now - input.lastSeenAt >= SLIDE_AFTER_MS) return "refresh";
  return "active";
}

export function sessionMaxAgeSeconds(
  now: number,
  absoluteExpiresAt: number,
): number {
  const remainingAbsolute = Math.floor((absoluteExpiresAt - now) / 1000);
  const inactivity = Math.floor(INACTIVITY_MS / 1000);
  return Math.max(0, Math.min(inactivity, remainingAbsolute));
}
