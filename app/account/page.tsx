import { ApiKeys } from "@/components/account/api-keys";
import { HolderRewards, SdkEarnings } from "@/components/account/holder-rewards";
import { DraftList } from "@/components/builder/draft-list";
import { VerifiedLaunchList } from "@/components/launch/verified-list";
import { CopyAddress } from "@/components/wallet/copy-address";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { createMetadata } from "@/lib/metadata";
import { readSession } from "@/lib/server/auth";
import { loadAccountRewards, rewardScope } from "@/lib/server/rewards/account";
import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import { isProvisionedOperator } from "@/lib/server/operator";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Account",
  description:
    "Sign in with a Solana wallet. A connected wallet is not a signed-in account until the server verifies a signature.",
  path: "/account",
});

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}): Promise<ReactNode> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  const account = session.state === "active" ? session.account : null;
  const scope = rewardScope((await searchParams).scope ?? null);
  const rewards = account ? await loadAccountRewards(account.walletAddress, scope) : null;
  const launches = account ? await loadVerifiedLaunches({ creator: account.walletAddress }) : null;

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
        className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
          Account
        </span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          {account ? "Signed in." : "Not signed in."}
        </h1>
        {account ? (
          <div className="mt-8 grid gap-5">
            <p className="text-[17px] leading-[1.7] break-all text-muted-foreground">
              {account.walletAddress}
            </p>
            <CopyAddress address={account.walletAddress} />
            <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">
              This session belongs to the wallet that signed the server
              challenge. Disconnecting or switching wallets ends it. Private
              drafts stay private until you test one and save a name. A saved
              SDK can be submitted for operator review. Approval lists that
              revision. A submission is not a token launch. A tested SDK can be
              prepared for launch. Preparation stores artwork and metadata. It
              does not mint a token. API keys call published SDKs and do not
              launch a token. Holder rewards and SDK earnings below are
              accounting records. They do not move funds while the rewards
              worker is suspended.
            </p>
            {isProvisionedOperator(account.walletAddress) ? (
              <Link
                href="/admin/library"
                className="font-mono text-[10px] tracking-[0.04em] uppercase underline"
              >
                Review Library
              </Link>
            ) : null}
            <section className="grid gap-3">
              <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">Your launches</h2>
              {launches?.ok ? (
                <VerifiedLaunchList
                  launches={launches.launches}
                  empty="No verified child tokens for this wallet. Preparing a launch does not list one here."
                />
              ) : (
                <p className="text-[15px] leading-[1.7] text-muted-foreground">Verified launches are unavailable.</p>
              )}
            </section>
            <DraftList />
            <ApiKeys />
            {rewards ? (
              <>
                {scope === "production" ? (
                  <p className="text-[14px] leading-[1.6]">
                    <Link href="/account?scope=test" className="font-mono text-[10px] tracking-[0.04em] uppercase underline">
                      TREST rehearsal balances
                    </Link>
                  </p>
                ) : (
                  <p className="text-[14px] leading-[1.6]">
                    <Link href="/account" className="font-mono text-[10px] tracking-[0.04em] uppercase underline">
                      Production rewards
                    </Link>
                  </p>
                )}
                <HolderRewards view={rewards} wallet={account.walletAddress} />
                <SdkEarnings view={rewards} />
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-8 grid gap-5">
            <p className="max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
              Connect a Solana wallet, then approve the sign-in in that wallet.
              Connection alone does not create an account. Nothing here can mint
              a token or move funds. Saved SDKs and API keys belong to a
              signed-in wallet. Preparing a launch requires that sign-in.
              Nothing here mints a token.
            </p>
            {session.state === "invalid" ? (
              <p className="font-mono text-[11px] text-muted-foreground uppercase">
                The previous session is no longer valid.
              </p>
            ) : null}
            <WalletButton compact />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
