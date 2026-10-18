"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const Controls = dynamic(
  () =>
    import("@/components/wallet/wallet-controls").then(
      (mod) => mod.WalletControls,
    ),
  {
    ssr: false,
    loading: () => (
      <span className="font-mono text-[10px] text-muted-foreground uppercase">
        Wallet
      </span>
    ),
  },
);

export function WalletButton({
  compact = false,
}: {
  compact?: boolean;
}): ReactNode {
  return <Controls compact={compact} />;
}
