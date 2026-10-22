"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { getWallets } from "@wallet-standard/app";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { loadBrowserSession } from "@/lib/auth/browser-session";
import { networkCostCopy } from "@/lib/launch/cost";
import { launchMessage } from "@/lib/launch/messages";
import { audiencePair } from "@/lib/launch/verified-launch";
import type { LaunchReview } from "@/lib/launch/prepare";
import { recoveryPhase, rehearsalSignAllowed } from "@/lib/launch/rehearsal-flow";
import { launchLifecycleCopy, type LaunchLifecycle } from "@/lib/launch/signing-phase";
import { finishLaunchSignatures, messageHashOf } from "@/lib/launch/v1-signature";
import { heldMint, rememberMint } from "@/lib/wallet/mint-keypair";
import { readPhantomSigner, requestPhantomSignature } from "@/lib/wallet/phantom-sign";

type BuildView = {
  buildId: string;
  parentMint: string;
  childMint: string;
  messageHash: string;
  blockhash: string;
  expiresAt: string;
  transaction: string;
  buyAmount: string;
  shareholders: { address: string; shareBps: number }[];
};

function asLifecycle(phase: string): LaunchLifecycle {
  if (
    phase === "ready_to_sign" ||
    phase === "awaiting_wallet" ||
    phase === "wallet_rejected" ||
    phase === "signed" ||
    phase === "expired" ||
    phase === "invalidated" ||
    phase === "service_unavailable" ||
    phase === "unavailable" ||
    phase === "preparing" ||
    phase === "submitting" ||
    phase === "awaiting_confirmation" ||
    phase === "verifying" ||
    phase === "verified" ||
    phase === "recovering" ||
    phase === "failed"
  ) {
    return phase;
  }
  return "preparing";
}

export function RehearsalActions({ review }: { review: LaunchReview }): ReactNode {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" });
  const [build, setBuild] = useState<BuildView | null>(null);
  const [preflightHash, setPreflightHash] = useState<string | null>(null);
  const [approvedBuildId, setApprovedBuildId] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [parentRegistered, setParentRegistered] = useState(false);
  const [mintAvailable, setMintAvailable] = useState(false);
  const [wire, setWire] = useState<string | null>(null);
  const [phase, setPhase] = useState("preparing");
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const probe = await fetch("/api/admin/trest/build", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchId: review.id }),
      });
      const probed = (await probe.json()) as { code?: string; boundMint?: string | null };
      if (cancelled) return;
      if (!probe.ok) {
        setNotice(launchMessage(probed.code ?? "unavailable"));
        setPhase(rehearsalBuildFailure(probed.code ?? "unavailable"));
        setParentRegistered(probed.code !== "parent_unregistered");
        return;
      }
      const existing = heldMint(review.id);
      if (probed.boundMint && (!existing || existing.publicKey !== probed.boundMint || !existing.keypair())) {
        setNotice(launchMessage("mint_lost"));
        setPhase("failed");
        setMintAvailable(false);
        return;
      }
      const held = existing ?? (await rememberMint(review.id));
      if (cancelled) return;
      setMintAvailable(held.keypair() !== null);
      const response = await fetch("/api/admin/trest/build", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchId: review.id, mintPublicKey: held.publicKey }),
      });
      const body = (await response.json()) as BuildView & { code?: string; shareholders?: unknown };
      if (cancelled) return;
      if (!response.ok) {
        setNotice(launchMessage(body.code ?? "unavailable"));
        setPhase(body.code === "mint_conflict" ? "failed" : rehearsalBuildFailure(body.code ?? "unavailable"));
        setParentRegistered(body.code !== "parent_unregistered");
        return;
      }
      const shareholders = Array.isArray(body.shareholders)
        ? body.shareholders.filter(
            (row): row is { address: string; shareBps: number } =>
              !!row && typeof row.address === "string" && typeof row.shareBps === "number",
          )
        : [];
      const next = { ...body, shareholders };
      setBuild(next);
      setPersistenceReady(true);
      setParentRegistered(true);
      const preflight = await fetch("/api/admin/trest/simulate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchId: review.id, buildId: next.buildId }),
      });
      const simulated = (await preflight.json()) as { code?: string; messageHash?: string };
      if (cancelled) return;
      if (!preflight.ok || simulated.messageHash !== next.messageHash) {
        setNotice(launchMessage(simulated.code ?? "message_changed"));
        setPhase("invalidated");
        return;
      }
      setPreflightHash(simulated.messageHash);
      setPhase("preparing");
    }
    void load().catch(() => setNotice(launchMessage("unavailable")));
    return () => {
      cancelled = true;
    };
  }, [review.id]);

  const gate = rehearsalSignAllowed({
    operator: true,
    parentRegistered,
    persistenceReady,
    committedHash: build?.messageHash ?? null,
    preflightHash,
    buildId: build?.buildId ?? null,
    approvedBuildId,
    mintAvailable,
  });
  const copy = launchLifecycleCopy(asLifecycle(phase));
  const buildRejected = phase === "failed" && !build && !signature;
  const pair = audiencePair(true);

  async function approve() {
    if (!build) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/trest/approve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchId: review.id, buildId: build.buildId }),
      });
      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setNotice(launchMessage(body.code ?? "unavailable"));
        return;
      }
      setApprovedBuildId(build.buildId);
      setPhase("ready_to_sign");
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    const current = build;
    const held = await rememberMint(review.id);
    const keypair = held.keypair();
    if (!current || !keypair || !gate.allowed) return;
    setBusy(true);
    setPhase("awaiting_wallet");
    try {
      const bytes = decodeBase64(current.transaction);
      const observed = await messageHashOf(bytes);
      if (observed !== current.messageHash || observed !== preflightHash) {
        setPhase("invalidated");
        setNotice(launchMessage("message_changed"));
        return;
      }
      const session = await loadBrowserSession();
      const wallets = getWallets().get().map((wallet) => readPhantomSigner(wallet));
      const wallet = await requestPhantomSignature({
        sessionAddress: session.status === "signed-in" ? session.walletAddress : null,
        connectedAddress: isConnected ? (address ?? null) : null,
        wallets,
        transaction: bytes,
      });
      if (!wallet.ok) {
        setPhase(wallet.code === "sign_rejected" ? "wallet_rejected" : "service_unavailable");
        setNotice(launchMessage(wallet.code === "sign_rejected" ? "sign_rejected" : "unavailable"));
        return;
      }
      const sessionAddress = session.status === "signed-in" ? session.walletAddress : "";
      const finished = await finishLaunchSignatures({
        committedTransaction: bytes,
        walletSignedTransaction: wallet.signedTransaction,
        mint: keypair,
        walletAddress: sessionAddress,
        mintAddress: current.childMint,
        messageHash: current.messageHash,
        blockhash: current.blockhash,
        expiresAt: Date.parse(current.expiresAt),
        now: Date.now(),
      });
      if (!finished.ok) {
        setPhase(finished.code === "message_changed" || finished.code === "blockhash_changed" ? "invalidated" : "failed");
        setNotice(launchMessage(finished.code));
        return;
      }
      const encoded = encodeBase64(finished.transaction);
      setWire(encoded);
      held.discard();
      setMintAvailable(false);
      setPhase("submitting");
      await submitWire(encoded, current);
    } finally {
      setBusy(false);
    }
  }

  async function submitWire(encoded: string, current: BuildView) {
    const response = await fetch("/api/launch/submit", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchId: review.id, buildId: current.buildId, transaction: encoded }),
    });
    const body = (await response.json()) as { code?: string; signature?: string };
    if (typeof body.signature === "string") setSignature(body.signature);
    if (!response.ok) {
      setNotice(launchMessage(body.code ?? "unavailable"));
      setPhase(body.code === "wire_key" ? "signed" : "failed");
      return;
    }
    const next = recoveryPhase(body.code ?? "submitting");
    setPhase(next.phase);
    setNotice(launchLifecycleCopy(asLifecycle(next.phase)).body);
  }

  async function refresh() {
    const response = await fetch("/api/launch/recover", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchId: review.id }),
    });
    const body = (await response.json()) as { code?: string; signature?: string };
    if (typeof body.signature === "string") setSignature(body.signature);
    if (!response.ok) {
      setNotice(launchMessage(body.code ?? "unavailable"));
      return;
    }
    const next = recoveryPhase(body.code ?? "submitting");
    setPhase(next.phase);
    setNotice(launchLifecycleCopy(asLifecycle(next.phase)).body);
  }

  return (
    <div className="mt-4 grid gap-3" data-rehearsal="trest">
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">{pair.label} rehearsal</p>
      <dl className="grid gap-2 text-[14px] leading-[1.45]">
        <Pair term="Quote" value={pair.label} />
        <Pair term="Creator fees" value={review.feeLabel} />
        <Pair term="Network" value={networkCostCopy()} />
        {build ? (
          <>
            <Pair term="Parent mint" value={build.parentMint} />
            <Pair term="Child mint" value={build.childMint} />
            <Pair term="Developer buy" value={build.buyAmount === "0" ? "None" : `${build.buyAmount} ${pair.label}`} />
            <Pair
              term="Fee shares"
              value={build.shareholders.map((row) => `${row.address} ${row.shareBps} bps`).join(" · ") || review.feeLabel}
            />
          </>
        ) : null}
      </dl>
      <p className="text-[14px] leading-[1.4]">{buildRejected ? "Build not accepted" : copy.title}</p>
      {buildRejected ? null : <p className="text-[13px] leading-[1.5] text-muted-foreground">{copy.body}</p>}
      {notice ? <p className="text-[13px] leading-[1.5]">{notice}</p> : null}
      {signature ? <p className="font-mono text-[10px] break-all text-muted-foreground">Signature {signature}</p> : null}
      {phase === "verified" && build ? (
        <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
          <Link href={`/token/${build.childMint}`}>Open token</Link>
          <span className="mx-3 text-muted-foreground">·</span>
          <Link href="/paired">Paired</Link>
        </p>
      ) : null}
      {build && preflightHash && approvedBuildId !== build.buildId ? (
        <button type="button" disabled={busy} onClick={() => void approve()} className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase">
          Approve this build
        </button>
      ) : null}
      <button
        type="button"
        disabled={!gate.allowed || busy}
        onClick={() => void signAndSubmit()}
        className="rounded-lg border border-solid border-accent bg-accent px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:cursor-not-allowed disabled:opacity-40"
      >
        Sign with Phantom
      </button>
      {wire && phase !== "verified" ? (
        <button
          type="button"
          disabled={busy || !build}
          onClick={() => build && void submitWire(wire, build)}
          className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Retry submission
        </button>
      ) : null}
      {build && signature ? (
        <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase">
          Recover status
        </button>
      ) : null}
    </div>
  );
}

function rehearsalBuildFailure(code: string): string {
  if (code === "builder_unconfigured" || code === "unavailable") return "service_unavailable";
  return "failed";
}

function Pair({ term, value }: { term: string; value: string }): ReactNode {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-mono text-[11px] break-all">{value}</dd>
    </div>
  );
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
