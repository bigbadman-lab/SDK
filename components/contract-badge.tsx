"use client";

import { shortenAddress } from "@/lib/launch/verified-launch";
import { useEffect, useState, type ReactNode } from "react";

const pill =
  "inline-flex items-center overflow-hidden rounded-[6px] border border-solid border-[color-mix(in_srgb,_var(--accent)_25%,_var(--border))] bg-card text-[12px] leading-[30px] max-[800px]:text-[11px] max-[561px]:max-w-full max-[561px]:text-[9px] max-[561px]:leading-[28px]";
const label =
  "bg-accent px-3.5 py-0 font-mono text-[10px] leading-[30px] font-normal text-accent-foreground not-italic max-[561px]:px-2.5 max-[561px]:text-[8px] max-[561px]:leading-[28px]";
const value = "px-3 py-0 font-mono max-[561px]:px-2";

async function copyMint(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function ContractBadge({ mint }: { mint: string | null }): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!mint) {
    return (
      <p className={pill} data-ui="announcement">
        <span className={label}>CONTRACT</span>
        <span className={value}>Not registered</span>
      </p>
    );
  }

  return (
    <button
      type="button"
      className={`${pill} cursor-pointer`}
      data-ui="announcement"
      aria-label={`Copy the $SDK mint ${mint}`}
      onClick={() => {
        void copyMint(mint).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      <span className={label}>CONTRACT</span>
      <span className={value}>{copied ? "Copied" : shortenAddress(mint)}</span>
    </button>
  );
}
