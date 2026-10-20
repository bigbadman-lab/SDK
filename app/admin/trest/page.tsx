import { TrestForm } from "@/components/admin/trest-form";
import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet/wallet-button";
import { createMetadata } from "@/lib/metadata";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession } from "@/lib/server/auth";
import { isProvisionedOperator } from "@/lib/server/operator";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "TREST parent",
    description: "Operator verification for the TREST test parent.",
    path: "/admin/trest",
  }),
  robots: { index: false, follow: false },
};

export default async function TrestParentPage(): Promise<ReactNode> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;
  if (account && !isProvisionedOperator(account.walletAddress)) notFound();

  return (
    <>
      <div className="mx-auto flex min-h-20 w-[min(1100px,_calc(100%_-_48px))] items-center justify-between gap-6 border-b border-b-border py-5 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]">
        <Link href="/" aria-label="SDK home">
          <Logo />
        </Link>
        <WalletButton />
      </div>
      <main
        id="main-content"
        className="mx-auto w-[min(860px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Operator</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          TREST parent
        </h1>
        {!account ? (
          <p className="mt-8 max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
            Sign in with the provisioned operator wallet to verify the TREST mint.
          </p>
        ) : (
          <>
            <p className="mt-8 max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
              TREST is created in the Pump.fun interface. This screen checks that mint and can register it in the test
              scope. It does not create a token or send a transaction.
            </p>
            <TrestForm />
            <p className="mt-8">
              <Link href="/launch?rehearsal=trest" className="font-mono text-[11px] tracking-[0.04em] uppercase">
                Open the TREST rehearsal in the launch form
              </Link>
            </p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
