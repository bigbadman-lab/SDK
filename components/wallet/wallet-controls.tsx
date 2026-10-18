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
  describeSignFailure,
  encodeSignInMessage,
  normalizeWalletSignature,
  signFailureNotice,
  signingAccountMatches,
} from "@/lib/auth/sign-message";

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
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { address, isConnected, status } = useAppKitAccount({
    namespace: "solana",
  });
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refreshSession = useCallback(async () => {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    if (!response.ok) {
      setSession({ status: "anonymous" });
      return;
    }
    const body = (await response.json()) as {
      authenticated?: boolean;
      walletAddress?: string;
    };
    if (body.authenticated && body.walletAddress) {
      setSession({ status: "signed-in", walletAddress: body.walletAddress });
      return;
    }
    setSession({ status: "anonymous" });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
      });
      if (!active) return;
      if (!response.ok) {
        setSession({ status: "anonymous" });
        return;
      }
      const body = (await response.json()) as {
        authenticated?: boolean;
        walletAddress?: string;
      };
      if (body.authenticated && body.walletAddress) {
        setSession({ status: "signed-in", walletAddress: body.walletAddress });
        return;
      }
      setSession({ status: "anonymous" });
    })();
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setSession({ status: "anonymous" });
  }, []);

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
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      setSession({ status: "anonymous" });
    })();
  }, [address, session, status]);

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
      await refreshSession();
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
  const rowClass =
    compact || !awaitingSignature ? "contents" : "flex items-center gap-2";

  return (
    <div
      className={
        compact
          ? "grid gap-3"
          : awaitingSignature
            ? "grid justify-items-end gap-1.5"
            : "flex items-center gap-2"
      }
    >
      <div className={rowClass}>
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
            <span
              className={`font-mono text-[11px] text-muted-foreground ${
                !compact && awaitingSignature ? "max-[960px]:hidden" : ""
              }`}
            >
              {address ? shorten(address) : "Connected"}
            </span>
            {signedIn ? (
              <a className={`${buttonClass} border-border bg-card`} href="/account">
                Account
              </a>
            ) : (
              <button
                className={`${buttonClass} border-accent bg-accent text-accent-foreground disabled:opacity-60`}
                type="button"
                disabled={pending || session.status === "loading"}
                onClick={() => void signIn()}
                {...(awaitingSignature ? { "aria-describedby": hintId } : {})}
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
          className="font-mono text-[10px] leading-[1.45] text-muted-foreground"
        >
          {pending
            ? "Check your wallet."
            : "Approve once more in your wallet."}
        </p>
      ) : null}
      {notice ? (
        <p className="font-mono text-[10px] text-muted-foreground">{notice}</p>
      ) : null}
    </div>
  );
}
