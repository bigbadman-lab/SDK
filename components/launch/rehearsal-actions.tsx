"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { getWallets } from "@wallet-standard/app";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { getBrowserSession, loadBrowserSession } from "@/lib/auth/browser-session";
import { networkCostCopy } from "@/lib/launch/cost";
import { launchMessage } from "@/lib/launch/messages";
import { audiencePair } from "@/lib/launch/verified-launch";
import type { LaunchReview } from "@/lib/launch/prepare";
import { LaunchProgress, readRecovery } from "@/components/launch/launch-progress";
import {
  failureExplanation,
  launchWatchCopy,
  nextPollDelay,
  watchLaunch,
  type OpenLaunch,
} from "@/lib/launch/post-launch";
import { confirmationPending, recoveryPhase, rehearsalSignAllowed } from "@/lib/launch/rehearsal-flow";
import { launchLifecycleCopy, type LaunchLifecycle } from "@/lib/launch/signing-phase";
import { finishLaunchSignatures, messageHashOf } from "@/lib/launch/v1-signature";
import { heldMint, rememberMint } from "@/lib/wallet/mint-keypair";
import { readPhantomSigner, requestPhantomSignature } from "@/lib/wallet/phantom-sign";

type RecoveryBody = {
  code?: string;
  signature?: string;
  childMint?: string;
  parentMint?: string;
  buyAmount?: string;
  shareholders?: unknown;
};

function shareholderRows(value: unknown): { address: string; shareBps: number }[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is { address: string; shareBps: number } =>
          !!row && typeof row.address === "string" && typeof row.shareBps === "number",
      )
    : [];
}

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

export function RehearsalActions({
  review,
  onTrack,
}: {
  review: LaunchReview;
  onTrack?: (launch: OpenLaunch) => void;
}): ReactNode {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" });
  const [build, setBuild] = useState<BuildView | null>(null);
  const [preflightHash, setPreflightHash] = useState<string | null>(null);
  const [approvedBuildId, setApprovedBuildId] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [parentRegistered, setParentRegistered] = useState(false);
  const [mintAvailable, setMintAvailable] = useState(false);
  const [wire, setWire] = useState<string | null>(null);
  const [wireHash, setWireHash] = useState<string | null>(null);
  const [phase, setPhase] = useState("preparing");
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [trackedMint, setTrackedMint] = useState<string | null>(null);
  const checking = useRef(false);
  const mintRef = useRef({ child: "", parent: "" });

  useEffect(() => {
    void loadBrowserSession();
  }, []);

  const showRecovery = useCallback((body: RecoveryBody) => {
    const childMint = typeof body.childMint === "string" ? body.childMint : mintRef.current.child;
    const parentMint = typeof body.parentMint === "string" ? body.parentMint : mintRef.current.parent;
    if (childMint && parentMint) {
      mintRef.current = { child: childMint, parent: parentMint };
      setTrackedMint(childMint);
    }
    if (typeof body.signature === "string") {
      setSignature(body.signature);
      setAnchor((current) => current ?? Date.now());
      if (childMint && parentMint) {
        onTrack?.({
          launchId: review.id,
          status: body.code ?? "submitted",
          scope: "test",
          childMint,
          parentMint,
          signature: body.signature,
          tokenName: review.tokenName,
          tokenSymbol: review.tokenSymbol,
          imageUrl: review.imageUri?.startsWith("https://") ? review.imageUri : null,
          pairLabel: "$TREST",
        });
      }
    }
    if (typeof body.childMint === "string" && typeof body.parentMint === "string") {
      setBuild((current) => current ?? {
        buildId: "",
        parentMint: body.parentMint ?? "",
        childMint: body.childMint ?? "",
        messageHash: "",
        blockhash: "",
        expiresAt: "",
        transaction: "",
        buyAmount: typeof body.buyAmount === "string" ? body.buyAmount : "0",
        shareholders: shareholderRows(body.shareholders),
      });
    }
    const next = recoveryPhase(body.code ?? "submitting");
    setPhase(next.phase);
    setNotice(null);
  }, [onTrack, review.id, review.imageUri, review.tokenName, review.tokenSymbol]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const recovered = await fetch("/api/launch/recover", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchId: review.id }),
      });
      const recovery = (await recovered.json()) as RecoveryBody;
      if (cancelled) return;
      if (recovered.ok) {
        showRecovery(recovery);
        return;
      }
      if (recovery.code !== "not_found") {
        setNotice(null);
        setPhase("service_unavailable");
        return;
      }
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
      const shareholders = shareholderRows(body.shareholders);
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
      const hashed = await messageHashOf(decodeBase64(next.transaction));
      if (cancelled) return;
      if (hashed !== next.messageHash) {
        setNotice(launchMessage("message_changed"));
        setPhase("invalidated");
        return;
      }
      setWireHash(hashed);
      setPreflightHash(simulated.messageHash);
      setPhase("preparing");
    }
    void load().catch(() => setNotice(launchMessage("unavailable")));
    return () => {
      cancelled = true;
    };
  }, [review.id, showRecovery]);

  useEffect(() => {
    if (build) mintRef.current = { child: build.childMint, parent: build.parentMint };
  }, [build]);

  useEffect(() => {
    if (!signature || phase === "verified" || phase === "failed") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [signature, phase]);

  useEffect(() => {
    if (!confirmationPending(phase) || !signature) return;
    const started = anchor ?? Date.now();
    let cancelled = false;
    let timer = 0;
    const loop = () => {
      if (checking.current) {
        timer = window.setTimeout(loop, 1_000);
        return;
      }
      checking.current = true;
      void readRecovery(review.id)
        .then((body) => {
          if (cancelled || !body.ok) return;
          showRecovery(body);
        })
        .catch(() => undefined)
        .finally(() => {
          checking.current = false;
          if (cancelled || phase === "verified" || phase === "failed") return;
          const delay = nextPollDelay(Date.now() - started);
          if (delay === null) return;
          timer = window.setTimeout(loop, delay);
        });
    };
    timer = window.setTimeout(loop, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [anchor, phase, review.id, showRecovery, signature]);

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
  const elapsed = anchor === null ? 0 : now - anchor;
  const view = watchLaunch({ phase, elapsedMs: elapsed, signature });
  const watched = view.watch === "other" ? null : launchWatchCopy(view.watch);
  const copy = watched
    ? {
        title: watched.title,
        body: view.watch === "failed" ? failureExplanation(signature, notice) : watched.body,
        verified: view.watch === "live",
      }
    : launchLifecycleCopy(asLifecycle(phase));
  const buildRejected = phase === "failed" && !build && !signature;
  const pair = audiencePair(true);
  const imageUrl = review.imageUri?.startsWith("https://") ? review.imageUri : null;

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
    const held = heldMint(review.id);
    const keypair = held?.keypair() ?? null;
    const session = getBrowserSession();
    if (!current || !held || !keypair || !gate.allowed || wireHash !== current.messageHash || wireHash !== preflightHash) {
      if (current && wireHash && (wireHash !== current.messageHash || wireHash !== preflightHash)) {
        setPhase("invalidated");
        setNotice(launchMessage("message_changed"));
      }
      return;
    }
    const bytes = decodeBase64(current.transaction);
    setBusy(true);
    setPhase("awaiting_wallet");
    const pendingSignature = requestPhantomSignature({
      sessionAddress: session.status === "signed-in" ? session.walletAddress : null,
      connectedAddress: isConnected ? (address ?? null) : null,
      wallets: getWallets().get().map((wallet) => readPhantomSigner(wallet)),
      transaction: bytes,
    });
    try {
      const wallet = await pendingSignature;
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
    showRecovery(body);
  }

  async function refresh() {
    if (checking.current) return;
    checking.current = true;
    try {
      const body = await readRecovery(review.id);
      if (!body.ok) return;
      showRecovery(body);
    } finally {
      checking.current = false;
    }
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
      {view.watch === "other" ? (
        <>
          <p className="text-[14px] leading-[1.4]">{buildRejected ? "Build not accepted" : copy.title}</p>
          {buildRejected ? null : <p className="text-[13px] leading-[1.5] text-muted-foreground">{copy.body}</p>}
          {notice ? <p className="text-[13px] leading-[1.5]">{notice}</p> : null}
        </>
      ) : (
        <LaunchProgress
          watch={view.watch}
          polling={view.polling}
          checking={busy}
          tokenName={review.tokenName}
          tokenSymbol={review.tokenSymbol}
          imageUrl={imageUrl}
          pairLabel={pair.label}
          childMint={build?.childMint ?? trackedMint}
          signature={signature}
          notice={notice}
          onCheck={() => void refresh()}
        />
      )}
      {!signature && build && preflightHash && approvedBuildId !== build.buildId ? (
        <button type="button" disabled={busy} onClick={() => void approve()} className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase">
          Approve this build
        </button>
      ) : null}
      {!signature ? (
        <button
          type="button"
          disabled={!gate.allowed || busy}
          onClick={() => void signAndSubmit()}
          className="rounded-lg border border-solid border-accent bg-accent px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sign with Phantom
        </button>
      ) : null}
      {wire && !signature ? (
        <button
          type="button"
          disabled={busy || !build}
          onClick={() => build && void submitWire(wire, build)}
          className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Retry submission
        </button>
      ) : null}
      {phase === "service_unavailable" ? (
        <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase">
          Check Launch Status
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
