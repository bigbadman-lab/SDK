"use client";

import { RehearsalNotice } from "@/components/admin/rehearsal-notice";
import { useState, type ReactElement } from "react";

type VerifyBody = {
  ok?: boolean;
  code?: string;
  creator?: string;
  eligible?: boolean;
  graduated?: boolean;
  pool?: string | null;
  bondingCurve?: string | null;
  feeMode?: string;
  registration?: string;
};

const RESULTS: Record<string, string> = {
  body: "Enter the TREST mint address.",
  builder_rejected: "Verification did not complete.",
  builder_unconfigured: "Verification did not complete.",
  conflict: "This mint is already registered with different details.",
  deployer: "The on-chain creator does not match the expected deployer.",
  fee_mode: "Fee collection is not a single creator recipient.",
  forbidden: "That action is not available.",
  holder_rewards: "Holder-rewards mode is not accepted.",
  not_stored: "Verified. The registration table is not available yet.",
  origin: "The request was not accepted.",
  parent_ineligible: "This mint is not eligible as a Pump custom quote.",
  production_parent: "This mint is the production parent.",
  quote: "Creator fees are not denominated in SOL.",
  stored: "Registered in the test scope.",
  unauthenticated: "Sign in to verify a parent.",
  unavailable: "Verification did not complete.",
};

function label(value: string | null | undefined, fallback = "—"): string {
  return value && value.length > 0 ? value : fallback;
}

export function TrestForm(): ReactElement {
  const [mint, setMint] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerifyBody | null>(null);

  async function verify(): Promise<void> {
    setPending(true);
    try {
      const response = await fetch("/api/admin/trest/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      const payload: unknown = await response.json();
      setResult(payload && typeof payload === "object" ? (payload as VerifyBody) : { code: "unavailable" });
    } catch {
      setResult({ code: "unavailable", registration: "rejected" });
    } finally {
      setPending(false);
    }
  }

  const registration =
    result?.registration === "stored"
      ? RESULTS.stored
      : result?.code
        ? (RESULTS[result.code] ?? "Verification did not complete.")
        : "—";
  const curve = result?.graduated ? `Graduated · ${label(result.pool)}` : result ? "Bonding curve" : "—";

  return (
    <>
    <form
      className="mt-8 grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <label className="grid gap-2 text-[15px]">
        Mint address
        <input
          value={mint}
          onChange={(event) => setMint(event.target.value.trim())}
          autoComplete="off"
          spellCheck={false}
          className="border border-solid border-border bg-card px-3 py-3 font-mono text-[13px]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-4 py-3 font-mono text-[11px] tracking-[0.08em] text-accent-foreground uppercase disabled:opacity-60"
      >
        {pending ? "Verifying" : "Verify"}
      </button>
      <dl className="grid gap-4 border border-solid border-border bg-card p-6 text-[15px]">
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Parent</dt>
          <dd className="mt-1">TREST</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Verified creator</dt>
          <dd className="mt-1 font-mono text-[13px] break-all">{label(result?.creator)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Pump eligibility</dt>
          <dd className="mt-1">{result?.eligible === true ? "Eligible" : result?.eligible === false ? "Not eligible" : "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Bonding curve / pool</dt>
          <dd className="mt-1 font-mono text-[13px] break-all">
            {curve}
            {result?.bondingCurve ? ` · ${result.bondingCurve}` : ""}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Fee-collection mode</dt>
          <dd className="mt-1">{label(result?.feeMode)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Registration</dt>
          <dd className="mt-1">{registration}</dd>
        </div>
      </dl>
    </form>
    <RehearsalNotice registered={result?.registration === "stored"} />
    </>
  );
}
