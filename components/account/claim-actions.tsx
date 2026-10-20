"use client";

import { ProviderController } from "@reown/appkit-controllers";
import bs58 from "bs58";
import { useState, type ReactNode } from "react";

import { encodeSignInMessage, normalizeWalletSignature } from "@/lib/auth/sign-message";
import { claimAllResults } from "@/lib/rewards/account-view";

export const claimButtonClass =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-3 py-2 font-mono text-[11px] tracking-[0.04em] uppercase disabled:opacity-50 max-[561px]:w-full";

type Asset = "sol" | "parent_token";
type Scope = "production" | "test";

type SigningProvider = {
  signMessage: (message: Uint8Array) => Promise<unknown>;
};

function provider(): SigningProvider | null {
  const value = ProviderController.getProvider("solana");
  if (!value || typeof value !== "object" || !("signMessage" in value) || typeof value.signMessage !== "function") return null;
  return value as unknown as SigningProvider;
}

async function claim(scope: Scope, asset: Asset): Promise<{ ok: boolean; code: string }> {
  const prepared = await fetch("/api/account/rewards/claim", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare", scope, asset }),
  });
  const challenge = (await prepared.json()) as { ok?: boolean; code?: string; message?: string; nonce?: string; execution?: string };
  if (!prepared.ok || !challenge.message || !challenge.nonce) {
    return { ok: false, code: challenge.code ?? "unavailable" };
  }
  const signer = provider();
  if (!signer) return { ok: false, code: "wallet" };
  const signed = await signer.signMessage.call(signer, encodeSignInMessage(challenge.message));
  const bytes = normalizeWalletSignature(signed);
  if (!bytes) return { ok: false, code: "signature" };
  const submitted = await fetch("/api/account/rewards/claim", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submit",
      scope,
      asset,
      nonce: challenge.nonce,
      message: challenge.message,
      signature: bs58.encode(bytes),
    }),
  });
  const result = (await submitted.json()) as { ok?: boolean; code?: string; execution?: string; signature?: string | null };
  if (result.execution === "confirmed") return { ok: true, code: result.signature ? `confirmed ${result.signature.slice(0, 8)}` : "confirmed" };
  if (result.execution === "uncertain") return { ok: false, code: "uncertain" };
  if (result.execution === "unavailable") return { ok: false, code: "unavailable" };
  return { ok: result.ok === true, code: result.code ?? "failed" };
}

export function ClaimActions({ scope, disabled }: { scope: Scope; disabled: boolean }): ReactNode {
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(asset: Asset | "all"): Promise<void> {
    setPending(true);
    setNotice(null);
    try {
      if (asset === "all") {
        const sol = await claim(scope, "sol");
        const token = await claim(scope, "parent_token");
        const outcome = claimAllResults([
          { asset: "sol", ok: sol.ok, code: sol.code },
          { asset: "parent_token", ok: token.ok, code: token.code },
        ]);
        if (outcome.outcome === "partial" || outcome.outcome === "confirmed") {
          setNotice(`SOL ${sol.code}. Parent token ${token.code}.`);
        } else if (outcome.outcome === "unavailable") {
          setNotice("Neither payout was broadcast. The rewards worker is not authorised.");
        } else {
          setNotice("Neither claim was confirmed.");
        }
        return;
      }
      const result = await claim(scope, asset);
      setNotice(result.code === "unavailable" ? "The claim was signed. The rewards worker did not broadcast it." : `Claim ${result.code}.`);
    } catch {
      setNotice("The claim could not be signed.");
    } finally {
      setPending(false);
    }
  }

  const button = claimButtonClass;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" disabled={disabled || pending} onClick={() => void run("sol")}>Claim SOL</button>
        <button className={button} type="button" disabled={disabled || pending} onClick={() => void run("parent_token")}>Claim Tokens</button>
        <button className={button} type="button" disabled={disabled || pending} onClick={() => void run("all")}>Claim All</button>
      </div>
      {notice ? <p className="text-[14px] leading-[1.6] text-muted-foreground">{notice}</p> : null}
    </div>
  );
}
