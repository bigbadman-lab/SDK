import { ApiKeys } from "@/components/account/api-keys";
import {
  AccountBodySkeleton,
  AccountIntro,
  AccountSectionHeading,
  AccountSectionSkeleton,
  accountMainClass,
} from "@/components/account/account-skeleton";
import { HolderRewards, SdkEarnings } from "@/components/account/holder-rewards";
import { DraftList } from "@/components/builder/draft-list";
import { VerifiedLaunchList } from "@/components/launch/verified-list";
import { LaunchResume } from "@/components/launch/launch-progress";
import { CopyAddress } from "@/components/wallet/copy-address";
import { WalletButton } from "@/components/wallet/wallet-button";
import { HomeLink } from "@/components/home/chrome";
import { Footer } from "@/components/footer";
import { createMetadata } from "@/lib/metadata";
import { readSession, type AccountIdentity } from "@/lib/server/auth";
import { loadAccountRewards } from "@/lib/server/rewards/account";
import { loadVerifiedLaunches, loadOpenLaunch } from "@/lib/server/launch/discover";
import { isProvisionedOperator } from "@/lib/server/operator";
import { shortenAddress } from "@/lib/launch/verified-launch";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

export const metadata = createMetadata({
  title: "Account",
  description: "Manage your SDKs, launched tokens, API keys and ecosystem rewards in one place.",
  path: "/account",
});

export default function AccountPage(): ReactNode {
  return (
    <>
      <main id="main-content" className={accountMainClass}>
        <AccountIntro />
        <Suspense fallback={<AccountBodySkeleton />}>
          <AccountBody />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function AccountBody(): Promise<ReactNode> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;
  if (!account) {
    return (
      <div className="mt-10 grid gap-4">
        <h2 className="font-display text-[32px] leading-[1.15] tracking-[-0.8px] max-[561px]:text-[26px]">
          Connect your wallet to get started.
        </h2>
        <p className="max-w-130 text-[16px] leading-[1.7] text-muted-foreground">
          Connect your Solana wallet to build, manage and launch SDK-powered applications.
        </p>
        {session.state === "invalid" ? (
          <p className="font-mono text-[11px] text-muted-foreground uppercase">
            The previous session is no longer valid. Approve the sign-in in your wallet to open this account.
          </p>
        ) : null}
        <div className="w-fit">
          <WalletButton compact />
        </div>
      </div>
    );
  }
  return (
    <div className="mt-10 grid gap-12">
      <div className="flex flex-wrap items-center gap-4">
        <p className="font-mono text-[14px] tracking-[0.02em]">{shortenAddress(account.walletAddress)}</p>
        <CopyAddress address={account.walletAddress} />
        {isProvisionedOperator(account.walletAddress) ? (
          <Link href="/admin/library" className="font-mono text-[10px] tracking-[0.04em] uppercase underline">
            Review Library
          </Link>
        ) : null}
      </div>
      <DraftList />
      <Suspense fallback={<AccountSectionSkeleton label="Loading launches" />}>
        <AccountLaunches account={account} />
      </Suspense>
      <ApiKeys />
      <Suspense fallback={<AccountSectionSkeleton label="Loading rewards" />}>
        <AccountRewards wallet={account.walletAddress} />
      </Suspense>
    </div>
  );
}

async function AccountLaunches({ account }: { account: AccountIdentity }): Promise<ReactNode> {
  const [openLaunch, launches] = await Promise.all([
    loadOpenLaunch(account.id),
    loadVerifiedLaunches({ creator: account.walletAddress }),
  ]);
  const empty = launches.ok && launches.launches.length === 0;
  return (
    <section className="grid gap-5 border-t border-border pt-8" aria-labelledby="my-launches-title">
      <AccountSectionHeading index="02" title="My Launches" titleId="my-launches-title">
        Tokens you&apos;ve launched through SDK.
      </AccountSectionHeading>
      {openLaunch ? <LaunchResume launch={openLaunch} /> : null}
      {launches.ok ? (
        <VerifiedLaunchList launches={launches.launches} empty="Your launched tokens will appear here after verification." />
      ) : (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">Verified launches are unavailable.</p>
      )}
      {empty ? <HomeLink href="/launch" tone="secondary">Explore Launch</HomeLink> : null}
    </section>
  );
}

async function AccountRewards({ wallet }: { wallet: string }): Promise<ReactNode> {
  const rewards = await loadAccountRewards(wallet, "production");
  return (
    <>
      <HolderRewards view={rewards} wallet={wallet} />
      <SdkEarnings view={rewards} />
    </>
  );
}
