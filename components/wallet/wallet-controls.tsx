"use client";

import { useAppKit, useAppKitAccount, useDisconnect } from "@reown/appkit/react";
import { ProviderController } from "@reown/appkit-controllers";
import bs58 from "bs58";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { appKitProjectConfigured, ensureAppKit } from "@/components/wallet/appkit";
import {
  loadBrowserSession,
  noteSignedIn,
  noteSignedOut,
  subscribeBrowserSession,
} from "@/lib/auth/browser-session";
import {
  describeSignFailure,
  encodeSignInMessage,
  normalizeWalletSignature,
  signFailureNotice,
  signingAccountMatches,
} from "@/lib/auth/sign-message";
import { useRouter } from "next/navigation";

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signed-in"; walletAddress: string };

const buttonClass =
  "inline-flex min-h-8.5 items-center justify-center gap-2 rounded-lg border border-solid px-3 py-2 font-mono text-[11px] leading-[1.4] font-medium tracking-[0.015em] uppercase";

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type SigningProvider = {
  signMessage: (message: Uint8Array) => Promise<unknown>;
  publicKey?: { toBase58: () => string };
};

function rawSolanaProvider(): SigningProvider | null {
  const provider = ProviderController.getProvider("solana");
  if (
    !provider ||
    typeof provider !== "object" ||
    !("signMessage" in provider) ||
    typeof provider.signMessage !== "function"
  ) {
    return null;
  }
  return provider as unknown as SigningProvider;
}

function providerAddress(provider: SigningProvider): string | null {
  try {
    return provider.publicKey?.toBase58() ?? null;
  } catch {
    return null;
  }
}

export function WalletControls({
  compact = false,
}: {
  compact?: boolean;
}): ReactNode {
  if (!appKitProjectConfigured()) {
    return (
      <p className="font-mono text-[10px] text-muted-foreground uppercase">
        Wallet connection is not configured.
      </p>
    );
  }
  ensureAppKit();
  return <WalletSession compact={compact} />;
}

function WalletSession({ compact }: { compact: boolean }): ReactNode {
  const router = useRouter();
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { address, isConnected, status } = useAppKitAccount({
    namespace: "solana",
  });
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return subscribeBrowserSession((next) => {
      if (next.status === "signed-in") {
        setSession({ status: "signed-in", walletAddress: next.walletAddress });
        return;
      }
      if (next.status === "anonymous") setSession({ status: "anonymous" });
    });
  }, []);

  useEffect(() => {
    void loadBrowserSession();
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    noteSignedOut();
    router.refresh();
  }, [router]);

  const walletObservation = useRef<{
    status: string;
    address: string | undefined;
  } | null>(
    null,
  );

  useEffect(() => {
    const prior = walletObservation.current;
    walletObservation.current = {
      status: status ?? "disconnected",
      address,
    };
    if (!prior || session.status !== "signed-in") return;
    if (status === "connecting" || status === "reconnecting") return;
    const leftWallet =
      prior.status === "connected" && status === "disconnected";
    const switchedWallet =
      status === "connected" &&
      Boolean(address) &&
      address !== session.walletAddress;
    if (!leftWallet && !switchedWallet) return;
    void (async () => {
      await signOut();
    })();
  }, [address, session, signOut, status]);

  async function signIn(): Promise<void> {
    const provider = rawSolanaProvider();
    const signingAddress = provider ? providerAddress(provider) : null;
    if (!address || !provider) {
      setNotice("This wallet cannot sign a message.");
      return;
    }
    if (!signingAddress) {
      setNotice(signFailureNotice("disconnected"));
      return;
    }
    if (!signingAccountMatches(address, signingAddress)) {
      setNotice("The connected account does not match this wallet.");
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: signingAddress }),
      });
      if (!challengeResponse.ok) {
        setNotice("Sign-in could not start.");
        return;
      }
      const challenge = (await challengeResponse.json()) as {
        challengeId?: string;
        message?: string;
      };
      if (!challenge.challengeId || !challenge.message) {
        setNotice("Sign-in could not start.");
        return;
      }
      const signed = await provider.signMessage.call(
        provider,
        encodeSignInMessage(challenge.message),
      );
      const bytes = normalizeWalletSignature(signed);
      if (!bytes) {
        setNotice("The wallet returned an unusable signature.");
        return;
      }
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          signature: bs58.encode(bytes),
        }),
      });
      if (!verifyResponse.ok) {
        setNotice("The signature was not accepted.");
        return;
      }
      const verified = (await verifyResponse.json()) as {
        authenticated?: boolean;
        walletAddress?: string;
      };
      noteSignedIn(
        verified.authenticated && verified.walletAddress
          ? verified.walletAddress
          : signingAddress,
      );
      router.refresh();
    } catch (error) {
      setNotice(signFailureNotice(describeSignFailure(error)));
    } finally {
      setPending(false);
    }
  }

  async function disconnectWallet(): Promise<void> {
    setPending(true);
    try {
      await signOut();
      await disconnect();
    } finally {
      setPending(false);
    }
  }

  const signedIn =
    session.status === "signed-in" &&
    isConnected &&
    address === session.walletAddress;
  const awaitingSignature = isConnected && !signedIn;
  const hintId = useId();
  const hint = pending ? "Check your wallet." : "Approve once more in your wallet.";

  return (
    <div className={compact ? "grid gap-3" : "grid justify-items-end gap-1"}>
      <div className={compact ? "grid gap-2" : "flex items-center justify-end gap-1.5"}>
        {!isConnected ? (
          <button
            className={`${buttonClass} border-accent bg-accent text-accent-foreground`}
            type="button"
            onClick={() => void open()}
          >
            Connect wallet
          </button>
        ) : (
          <>
            {compact ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                {address ? shorten(address) : "Connected"}
              </span>
            ) : null}
            {signedIn ? (
              <a
                className={`${buttonClass} border-border bg-card`}
                href="/account"
                title={address ?? "Account"}
              >
                Account
              </a>
            ) : (
              <button
                className={`${buttonClass} border-accent bg-accent text-accent-foreground disabled:opacity-60`}
                type="button"
                disabled={pending || session.status === "loading"}
                onClick={() => void signIn()}
                aria-describedby={hintId}
              >
                Sign in wallet
              </button>
            )}
            <button
              className={`${buttonClass} border-border bg-card`}
              type="button"
              disabled={pending}
              onClick={() => void disconnectWallet()}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {awaitingSignature ? (
        <p
          id={hintId}
          className={
            compact
              ? "font-mono text-[10px] leading-[1.45] text-muted-foreground"
              : "sr-only"
          }
        >
          {hint}
        </p>
      ) : null}
      {notice ? (
        <p className="max-w-full font-mono text-[10px] leading-[1.45] break-words text-muted-foreground">{notice}</p>
      ) : null}
    </div>
  );
}
