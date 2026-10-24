import type { ReactNode } from "react";

const STAGES = [
  { index: "01", title: "Create", body: "Build an SDK in the AI Builder, or remix an existing implementation." },
  { index: "02", title: "Test", body: "Run the SDK and confirm it returns a usable result." },
  { index: "03", title: "Submit", body: "Send completed software for Library review." },
  { index: "04", title: "Publish", body: "Approved SDKs become discoverable in the Library." },
  { index: "05", title: "Distribute", body: "Others can find the SDK, call it, and use it in a supported launch." },
  { index: "06", title: "Earn", body: "The original developer can receive creator-fee revenue from a qualifying third-party launch." },
] as const;

export function MarketplaceFlow(): ReactNode {
  return (
    <ol aria-label="Create, test, submit, publish, distribute, earn" className="grid gap-px border border-border bg-border sm:grid-cols-2 min-[801px]:grid-cols-3">
      {STAGES.map((stage) => (
        <li key={stage.index} className="min-w-0 bg-background px-4 py-4">
          <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">{stage.index}</p>
          <h3 className="mt-2 text-[16px] leading-none">{stage.title}</h3>
          <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">{stage.body}</p>
        </li>
      ))}
    </ol>
  );
}
