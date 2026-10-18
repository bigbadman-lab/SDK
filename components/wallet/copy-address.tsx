"use client";

import { useState, type ReactNode } from "react";

export function CopyAddress({ address }: { address: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="inline-flex min-h-8.5 items-center justify-center rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[11px] tracking-[0.04em] uppercase"
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}
