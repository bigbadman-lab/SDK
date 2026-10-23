import { BuilderPanel } from "@/components/builder/panel";
import { Footer } from "@/components/footer";
import { WalletButton } from "@/components/wallet/wallet-button";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { createMetadata } from "@/lib/metadata";
import { readSession } from "@/lib/server/auth";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Builder",
  description:
    "Describe what you want to create. Build with AI, test real inputs and refine your SDK in one workspace.",
  path: "/build",
});

export default async function BuildPage(): Promise<ReactNode> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;

  if (!account) {
    return (
      <>
        <main
          id="main-content"
          className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10"
        >
          <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
            AI SDK Builder
          </span>
          <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
            Turn an idea into a working SDK.
          </h1>
          <div className="mt-8 grid gap-5">
            <p className="max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
              Describe what you want to create. Build with AI, test real inputs and refine your SDK in one
              workspace.
            </p>
            <p className="max-w-130 text-[16px] leading-[1.7] text-muted-foreground">
              Connect your wallet to start building and save your work.
            </p>
            {session.state === "invalid" ? (
              <p className="font-mono text-[11px] text-muted-foreground uppercase">
                The previous session is no longer valid.
              </p>
            ) : null}
            <WalletButton compact />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <main
      id="main-content"
      className="mx-auto flex h-[calc(100svh-4rem)] w-[min(1180px,calc(100%-48px))] min-w-0 flex-col overflow-hidden pt-6 pb-6 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-4"
    >
      <header className="mb-4 shrink-0 max-[561px]:mb-3">
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          AI SDK Builder
        </span>
        <h1 className="mt-2 font-display text-[32px] leading-[1.15] tracking-[-0.8px] max-[561px]:text-[28px]">
          Build something useful.
        </h1>
        <p className="mt-2 max-w-150 text-[14px] leading-[1.6] text-muted-foreground">
          Describe your idea, refine it with AI and test your SDK as you build.
        </p>
      </header>
      <BuilderPanel />
    </main>
  );
}
