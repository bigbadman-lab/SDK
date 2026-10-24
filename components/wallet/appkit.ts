"use client";

import { createAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { solana, solanaDevnet, solanaTestnet } from "@reown/appkit/networks";

const NETWORKS = {
  "mainnet-beta": solana,
  devnet: solanaDevnet,
  testnet: solanaTestnet,
} as const;

let started = false;

export function appKitProjectConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim());
}

export function ensureAppKit(): boolean {
  if (started) return true;
  if (typeof window === "undefined") return false;
  const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();
  if (!projectId) return false;
  const configured = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() ?? "";
  const network =
    configured in NETWORKS
      ? NETWORKS[configured as keyof typeof NETWORKS]
      : solana;
  const origin = window.location.origin;
  const options = {
    adapters: [new SolanaAdapter()],
    networks: [network],
    defaultNetwork: network,
    projectId,
    metadata: {
      name: "SDK",
      description:
        "Sign in with a Solana wallet. Connection is not a token launch.",
      url: origin,
      icons: [`${origin}/images/sdkpair.png`],
    },
    themeMode: "dark" as const,
    features: {
      analytics: false,
      email: false,
      socials: false as const,
      swaps: false,
      onramp: false,
      receive: false,
      send: false,
      history: false,
      reownAuthentication: false,
    },
  };
  // AppKit's published network types disagree with exactOptionalPropertyTypes.
  createAppKit(options as unknown as Parameters<typeof createAppKit>[0]);
  started = true;
  return true;
}
