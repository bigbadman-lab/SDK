"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";

type RemixState = {
  pending: boolean;
  notice: string | null;
  place: "top" | "bottom" | null;
  remix: (place: "top" | "bottom") => void;
};

const RemixContext = createContext<RemixState | null>(null);

export function RemixProvider({
  sdkId,
  versionId,
  children,
}: {
  sdkId: string;
  versionId: string;
  children: ReactNode;
}): ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [place, setPlace] = useState<"top" | "bottom" | null>(null);

  async function remix(nextPlace: "top" | "bottom"): Promise<void> {
    if (pending) return;
    setPending(true);
    setPlace(nextPlace);
    setNotice(null);
    try {
      const response = await fetch(`/api/library/${sdkId}/remix`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const body = (await response.json()) as { draftId?: string; error?: string };
      if (response.status === 401) {
        setNotice("Sign in to remix this SDK.");
        return;
      }
      if (!response.ok || !body.draftId) {
        setNotice(body.error ?? "The remix could not be opened.");
        return;
      }
      router.push(`/build?draft=${encodeURIComponent(body.draftId)}`);
    } catch {
      setNotice("The remix could not be opened.");
    } finally {
      setPending(false);
    }
  }

  return (
    <RemixContext.Provider value={{ pending, notice, place, remix: (next) => void remix(next) }}>
      {children}
    </RemixContext.Provider>
  );
}

export function RemixButton({ place }: { place: "top" | "bottom" }): ReactNode {
  const remix = useContext(RemixContext);
  if (!remix) return null;
  return (
    <button
      type="button"
      disabled={remix.pending}
      onClick={() => remix.remix(place)}
      className="rounded-lg border border-solid border-accent bg-accent px-4 py-3 font-mono text-[11px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
    >
      {remix.pending && remix.place === place ? "Opening" : "Remix SDK"}
    </button>
  );
}

export function RemixNotice({ place }: { place: "top" | "bottom" }): ReactNode {
  const remix = useContext(RemixContext);
  if (!remix || remix.place !== place || !remix.notice) return null;
  return (
    <div className="mt-3 grid justify-items-start gap-3">
      <p className="font-mono text-[11px] text-muted-foreground uppercase" aria-live="polite">
        {remix.notice}
      </p>
      {remix.notice === "Sign in to remix this SDK." ? <WalletButton compact /> : null}
    </div>
  );
}
