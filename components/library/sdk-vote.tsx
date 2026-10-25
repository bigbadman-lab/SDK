"use client";

import { homeSecondaryButton } from "@/components/home/chrome";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useState, type ReactNode } from "react";

const SIGN_IN = "Sign in to like this SDK.";

export function SdkVote({
  sdkId,
  count,
  voted,
  signedIn,
}: {
  sdkId: string;
  count: number;
  voted: boolean;
  signedIn: boolean;
}): ReactNode {
  const [total, setTotal] = useState(count);
  const [liked, setLiked] = useState(voted);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function like(): Promise<void> {
    if (pending || liked) return;
    if (!signedIn) {
      setNotice(SIGN_IN);
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/library/${sdkId}/vote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as { error?: string; count?: number };
      if (response.status === 401) {
        setNotice(SIGN_IN);
        return;
      }
      if (typeof body.count === "number") setTotal(body.count);
      if (response.status === 429) {
        setLiked(true);
        setNotice(body.error ?? "You can like this SDK once every 24 hours.");
        return;
      }
      if (!response.ok) {
        setNotice(body.error ?? "The like could not be saved.");
        return;
      }
      setLiked(true);
    } catch {
      setNotice("The like could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending || liked}
        aria-pressed={liked}
        onClick={() => void like()}
        className={`${homeSecondaryButton} disabled:pointer-events-none disabled:opacity-60`}
      >
        {pending ? "Saving" : liked ? "Liked" : "Like"}
        <span className="tabular-nums">{total}</span>
      </button>
      {notice ? (
        <p className="basis-full font-mono text-[11px] text-muted-foreground uppercase" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {notice === SIGN_IN ? (
        <div className="basis-full">
          <WalletButton compact />
        </div>
      ) : null}
    </>
  );
}
