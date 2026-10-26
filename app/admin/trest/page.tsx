import { TrestForm } from "@/components/admin/trest-form";
import { RewardsMonitor } from "@/components/admin/rewards-monitor";
import { Footer } from "@/components/footer";
import { createMetadata } from "@/lib/metadata";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession } from "@/lib/server/auth";
import { isProvisionedOperator } from "@/lib/server/operator";
import { loadOperatorRewards } from "@/lib/server/rewards/operator";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "Operator",
    description: "Operator records.",
    path: "/admin/trest",
  }),
  robots: { index: false, follow: false },
};

export default async function TrestParentPage(): Promise<ReactNode> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;
  if (!account || !isProvisionedOperator(account.walletAddress)) notFound();
  const rewards = await loadOperatorRewards();

  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(860px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Operator</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          TREST parent
        </h1>
        <p className="mt-8 max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
          Historical TREST registration remains available to the provisioned operator. Public child launches stay closed.
        </p>
        <TrestForm />
        {rewards ? <RewardsMonitor status={rewards} /> : null}
      </main>
      <Footer />
    </>
  );
}
