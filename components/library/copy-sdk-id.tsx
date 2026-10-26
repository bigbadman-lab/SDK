"use client";

import { useEffect, useState, type ReactNode } from "react";

async function copyText(value: string): Promise<boolean> {
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

export function CopySdkId({ sdkId }: { sdkId: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-4 flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 font-mono text-[13px] leading-[1.5] break-all text-foreground">
        <span className="mr-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          SDK ID
        </span>
        {sdkId}
      </p>
      <button
        type="button"
        className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
        aria-label={`Copy SDK ID ${sdkId}`}
        onClick={() => {
          void copyText(sdkId).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? "SDK ID copied" : ""}
      </p>
    </div>
  );
}
