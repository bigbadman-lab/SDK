import type { ReactNode } from "react";

export function SkipToContent(): ReactNode {
  return (
    <a
      href="#main-content"
      className="fixed top-3 left-4 z-200 [transform:translateY(-200%)] bg-foreground p-3 text-[14px] text-background focus:[transform:none]"
    >
      Skip to main content
    </a>
  );
}
