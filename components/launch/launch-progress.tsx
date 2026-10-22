"use client";

import { explorerUrl } from "@/lib/launch/verified-launch";
import {
  failureExplanation,
  launchWatchCopy,
  nextPollDelay,
  watchLaunch,
  type LaunchWatch,
  type OpenLaunch,
} from "@/lib/launch/post-launch";
import { recoveryPhase } from "@/lib/launch/rehearsal-flow";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

type RecoveryBody = {
  ok?: boolean;
  code?: string;
  signature?: string;
  childMint?: string;
  parentMint?: string;
};

export async function readRecovery(launchId: string): Promise<RecoveryBody & { ok: boolean }> {
  try {
    const response = await fetch("/api/launch/recover", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchId }),
    });
    const body = (await response.json()) as RecoveryBody;
    return { ...body, ok: response.ok };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function LaunchResume({ launch }: { launch: OpenLaunch }): ReactNode {
  const [phase, setPhase] = useState(recoveryPhase(launch.status).phase);
  const [signature, setSignature] = useState(launch.signature);
  const [childMint, setChildMint] = useState(launch.childMint);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const checkingRef = useRef(false);
  const phaseRef = useRef(phase);

  async function check(): Promise<void> {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const body = await readRecovery(launch.launchId);
      if (!body.ok) return;
      if (typeof body.signature === "string") setSignature(body.signature);
      if (typeof body.childMint === "string") setChildMint(body.childMint);
      const next = recoveryPhase(body.code ?? "submitted").phase;
      phaseRef.current = next;
      setPhase(next);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    let timer = 0;
    let cancelled = false;
    const loop = () => {
      if (checkingRef.current) {
        timer = window.setTimeout(loop, 1_000);
        return;
      }
      checkingRef.current = true;
      setChecking(true);
      void readRecovery(launch.launchId)
        .then((body) => {
          if (cancelled || !body.ok) return;
          if (typeof body.signature === "string") setSignature(body.signature);
          if (typeof body.childMint === "string") setChildMint(body.childMint);
          const next = recoveryPhase(body.code ?? "submitted").phase;
          phaseRef.current = next;
          setPhase(next);
        })
        .catch(() => undefined)
        .finally(() => {
          checkingRef.current = false;
          setChecking(false);
          if (cancelled || phaseRef.current === "verified" || phaseRef.current === "failed") return;
          const delay = nextPollDelay(Date.now() - startedAt);
          if (delay === null) return;
          timer = window.setTimeout(loop, delay);
        });
    };
    timer = window.setTimeout(loop, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [launch.launchId, startedAt]);

  const view = watchLaunch({ phase, elapsedMs: now - startedAt, signature });
  return (
    <LaunchProgress
      watch={view.watch}
      polling={view.polling}
      checking={checking}
      tokenName={launch.tokenName}
      tokenSymbol={launch.tokenSymbol}
      imageUrl={launch.imageUrl}
      pairLabel={launch.pairLabel}
      childMint={childMint}
      signature={signature}
      notice={null}
      onCheck={() => void check()}
    />
  );
}

export function LaunchProgress({
  watch,
  polling,
  checking,
  tokenName,
  tokenSymbol,
  imageUrl,
  pairLabel,
  childMint,
  signature,
  notice,
  onCheck,
}: {
  watch: LaunchWatch;
  polling: boolean;
  checking: boolean;
  tokenName: string | null;
  tokenSymbol: string | null;
  imageUrl: string | null;
  pairLabel: "$SDK" | "$TREST";
  childMint: string | null;
  signature: string | null;
  notice: string | null;
  onCheck: () => void;
}): ReactNode {
  if (watch === "other") return null;
  const copy = launchWatchCopy(watch);
  const body = watch === "failed" ? failureExplanation(signature, notice) : copy.body;
  const manual = Boolean(signature) && !polling && watch !== "live" && watch !== "failed" && watch !== "rejected";
  return (
    <div className="grid gap-3" data-launch-watch={watch}>
      <p className="flex items-center gap-2 text-[14px] leading-[1.4]" role="status" aria-live="polite">
        {polling ? <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" /> : null}
        {copy.title}
      </p>
      <p className="text-[13px] leading-[1.5] text-muted-foreground">{body}</p>
      {tokenName && tokenSymbol ? (
        <p className="text-[14px]">
          {tokenName} <span className="text-muted-foreground">${tokenSymbol}</span>
        </p>
      ) : null}
      {imageUrl ? (
        // Gateway hosts are chosen at pin time, so this cannot be limited to one Next image domain.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={tokenName ? `${tokenName} artwork` : "Token artwork"} className="h-16 w-16 object-contain" />
      ) : null}
      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">Paired with {pairLabel}</p>
      {childMint ? <p className="font-mono text-[10px] break-all text-muted-foreground">Child mint {childMint}</p> : null}
      {signature ? (
        <a className="font-mono text-[10px] break-all underline" href={explorerUrl(signature, "tx")} rel="noreferrer">
          View transaction
        </a>
      ) : null}
      {watch === "live" && childMint ? (
        <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
          <Link href={`/token/${childMint}`}>View Token</Link>
          <span className="mx-3 text-muted-foreground">·</span>
          <Link href="/paired">View on Paired</Link>
          <span className="mx-3 text-muted-foreground">·</span>
          <Link href="/feed">View in SDK Feed</Link>
        </p>
      ) : null}
      {manual ? (
        <button
          type="button"
          disabled={checking}
          onClick={onCheck}
          className="rounded-lg border border-solid border-border px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Check Launch Status
        </button>
      ) : null}
    </div>
  );
}
