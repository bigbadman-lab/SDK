import { ApiKeys } from "@/components/account/api-keys";
import { AccountBodySkeleton, AccountIntro, AccountSectionSkeleton, accountMainClass } from "@/components/account/account-skeleton";
import { HolderRewards, SdkEarnings } from "@/components/account/holder-rewards";
import { DraftList } from "@/components/builder/draft-list";
import { VerifiedLaunchList } from "@/components/launch/verified-list";
import { LaunchResume } from "@/components/launch/launch-progress";
import { CopyAddress } from "@/components/wallet/copy-address";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Footer } from "@/components/footer";
import { createMetadata } from "@/lib/metadata";
import { readSession, type AccountIdentity } from "@/lib/server/auth";
import { loadAccountRewards, rewardScope } from "@/lib/server/rewards/account";
import { loadVerifiedLaunches, loadOpenLaunch } from "@/lib/server/launch/discover";
import { isProvisionedOperator } from "@/lib/server/operator";
import { SESSION_COOKIE } from "@/lib/auth/session";
import type { RewardScope } from "@/lib/rewards/ledger";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

export const metadata = createMetadata({
  title: "Account",
  description:
    "Sign in with a Solana wallet. A connected wallet is not a signed-in account until the server verifies a signature.",
  path: "/account",
});

export default function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}): ReactNode {
  return (
    <>
      <main id="main-content" className={accountMainClass}>
        <AccountIntro />
        <Suspense fallback={<AccountBodySkeleton />}>
          <AccountBody searchParams={searchParams} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function AccountBody({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}): Promise<ReactNode> {
  const [store, query] = await Promise.all([cookies(), searchParams]);
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;
  const scope = rewardScope(query.scope ?? null);
  if (!account) {
    return (
      <div className="mt-6 grid gap-5">
        <h1 className="font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          Not signed in.
        </h1>
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
    );
  }
  return (
    <div className="mt-6 grid gap-5">
      <h1 className="font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
        Signed in.
      </h1>
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
      <Suspense fallback={<AccountSectionSkeleton label="Loading launches" />}>
        <AccountLaunches account={account} />
      </Suspense>
      <DraftList />
      <ApiKeys />
      <Suspense fallback={<AccountSectionSkeleton label="Loading rewards" />}>
        <AccountRewards wallet={account.walletAddress} scope={scope} />
      </Suspense>
    </div>
  );
}

async function AccountLaunches({ account }: { account: AccountIdentity }): Promise<ReactNode> {
  const [openLaunch, launches] = await Promise.all([
    loadOpenLaunch(account.id),
    loadVerifiedLaunches({ creator: account.walletAddress }),
  ]);
  return (
    <section className="grid gap-3">
      <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">Your launches</h2>
      {openLaunch ? <LaunchResume launch={openLaunch} /> : null}
      {launches.ok ? (
        <VerifiedLaunchList
          launches={launches.launches}
          empty="No verified child tokens for this wallet. Preparing a launch does not list one here."
        />
      ) : (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">Verified launches are unavailable.</p>
      )}
    </section>
  );
}

async function AccountRewards({
  wallet,
  scope,
}: {
  wallet: string;
  scope: RewardScope;
}): Promise<ReactNode> {
  const rewards = await loadAccountRewards(wallet, scope);
  return (
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
      <HolderRewards view={rewards} wallet={wallet} />
      <SdkEarnings view={rewards} />
    </>
  );
}
