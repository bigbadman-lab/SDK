"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { getWallets } from "@wallet-standard/app";
import { useEffect, useState, type ReactNode } from "react";

import { appKitProjectConfigured, ensureAppKit } from "@/components/wallet/appkit";
import {
  loadBrowserSession,
  subscribeBrowserSession,
  type BrowserSession,
} from "@/lib/auth/browser-session";
import {
  assessPhantomCapability,
  describePhantomCapability,
  formatAdvertisedVersions,
  observeWallet,
  phantomCapabilityCopy,
  type CapabilityDiagnostic,
  type ObservedWallet,
} from "@/lib/wallet/phantom-capability";

function Notice({
  state,
  title,
  body,
}: {
  state: string;
  title: string;
  body: string;
}): ReactNode {
  return (
    <div className="mt-4" data-wallet-capability={state}>
      <p className="text-[13px] leading-[1.45] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">{body}</p>
    </div>
  );
}

function useWalletObservation(): {
  session: BrowserSession;
  connectedAddress: string | null;
  wallets: ObservedWallet[];
} {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" });
  const [session, setSession] = useState<BrowserSession>({ status: "unknown" });
  const [wallets, setWallets] = useState<ObservedWallet[]>([]);

  useEffect(() => {
    void loadBrowserSession();
    return subscribeBrowserSession(setSession);
  }, []);

  useEffect(() => {
    const api = getWallets();
    const read = () => {
      setWallets(api.get().map((wallet) => observeWallet(wallet)));
    };
    read();
    const stopRegister = api.on("register", read);
    const stopUnregister = api.on("unregister", read);
    return () => {
      stopRegister();
      stopUnregister();
    };
  }, []);

  return {
    session,
    connectedAddress: isConnected ? (address ?? null) : null,
    wallets,
  };
}

function ConnectedCapabilityNotice(): ReactNode {
  const { session, connectedAddress, wallets } = useWalletObservation();
  if (session.status === "unknown") return null;
  const state = assessPhantomCapability({
    sessionAddress: session.status === "signed-in" ? session.walletAddress : null,
    connectedAddress,
    wallets,
  });
  const copy = phantomCapabilityCopy(state);
  if (!copy) return null;
  return <Notice state={state} title={copy.title} body={copy.body} />;
}

export function LaunchCapabilityNotice(): ReactNode {
  if (!appKitProjectConfigured()) {
    const copy = phantomCapabilityCopy("wallet_disconnected");
    if (!copy) return null;
    return <Notice state="wallet_disconnected" title={copy.title} body={copy.body} />;
  }
  ensureAppKit();
  return <ConnectedCapabilityNotice />;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function DiagnosticList({ diagnostic }: { diagnostic: CapabilityDiagnostic }): ReactNode {
  const rows: [string, string][] = [
    ["Reown connected", yesNo(diagnostic.reownConnected)],
    ["Wallet identified as Phantom", yesNo(diagnostic.identifiedAsPhantom)],
    ["Reown account matches authenticated session", yesNo(diagnostic.sessionMatches)],
    ["Matching Phantom Wallet Standard account found", yesNo(diagnostic.phantomAccountFound)],
    ["solana:signTransaction available", yesNo(diagnostic.signTransactionAvailable)],
    ["Advertised transaction versions", formatAdvertisedVersions(diagnostic.advertisedVersions)],
    ["Solana v1 supported", yesNo(diagnostic.v1Supported)],
    ["Capability state", diagnostic.state],
  ];
  return (
    <aside
      data-capability-diagnostic="development"
      data-capability-state={diagnostic.state}
      className="mt-4 border border-dashed border-border px-3 py-3"
    >
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
        Development wallet check
      </p>
      <dl className="mt-2 grid gap-1 text-[13px] leading-[1.45]">
        {rows.map(([term, value]) => (
          <div key={term} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="min-w-0 font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function LiveDiagnostic({ surface }: { surface: "page" | "modal" }): ReactNode {
  const { session, connectedAddress, wallets } = useWalletObservation();
  if (session.status === "unknown") {
    if (surface === "page") return null;
    return (
      <p className="mt-4 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
        Reading the connected wallet…
      </p>
    );
  }
  if (surface === "page" && session.status !== "signed-in") return null;
  const diagnostic = describePhantomCapability({
    sessionAddress: session.status === "signed-in" ? session.walletAddress : null,
    connectedAddress,
    wallets,
  });
  return <DiagnosticList diagnostic={diagnostic} />;
}

export function LaunchCapabilityDiagnostic({
  surface = "page",
}: {
  surface?: "page" | "modal";
}): ReactNode {
  if (process.env.NODE_ENV !== "development") return null;
  if (!appKitProjectConfigured()) {
    if (surface === "page") return null;
    return (
      <DiagnosticList
        diagnostic={describePhantomCapability({
          sessionAddress: null,
          connectedAddress: null,
          wallets: [],
        })}
      />
    );
  }
  ensureAppKit();
  return <LiveDiagnostic surface={surface} />;
}
