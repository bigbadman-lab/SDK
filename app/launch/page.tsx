import { Footer } from "@/components/footer";
import { LaunchForm } from "@/components/launch/form";
import { LaunchResume } from "@/components/launch/launch-progress";
import { LaunchBodySkeleton, LaunchIntro } from "@/components/launch/page-skeletons";
import { LaunchCapabilityDiagnostic } from "@/components/launch/wallet-capability";
import {
  HeldSdk,
  LaunchSelector,
  toDraftChoice,
  toLibraryChoice,
  type LaunchChoice,
} from "@/components/launch/selector";
import {
  isLaunchEligibleDraft,
  launchPageMode,
  matchesSdkQuery,
} from "@/lib/launch/catalog";
import { launchMessage } from "@/lib/launch/messages";
import { libraryQuery, type LibraryQuery } from "@/lib/library/library";
import { createMetadata } from "@/lib/metadata";
import { getCurrentAccount } from "@/lib/server/account";
import { loadOpenLaunch } from "@/lib/server/launch/discover";
import type { AccountIdentity } from "@/lib/server/auth";
import { BlueprintFlowError, listDrafts } from "@/lib/server/blueprint/service";
import {
  LaunchFlowError,
  resolveLaunchQuery,
} from "@/lib/server/launch/service";
import { listPublished, readPublished } from "@/lib/server/library/service";
import { officialIdentity } from "@/lib/sdk/official";
import { loadOfficialSdk } from "@/lib/server/sdk/official";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "Launch",
    description:
      "Turn a working SDK into a token-powered application on Solana. Choose your software, customise your token and launch it paired with $SDK.",
    path: "/launch",
  }),
  robots: { index: false, follow: false },
};

const mainClass = "mx-auto w-[min(680px,calc(100%-48px))] scroll-mt-23 pt-12 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-8";

type LaunchQuery = {
  draft?: string;
  library?: string;
  version?: string;
  q?: string;
  page?: string;
};

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<LaunchQuery>;
}): Promise<ReactNode> {
  const account = await getCurrentAccount();
  return (
    <>
      <main id="main-content" className={mainClass}>
        <LaunchIntro guide={account === null} />
        <Suspense fallback={<LaunchBodySkeleton />}>
          <LaunchBody searchParams={searchParams} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function LaunchBody({
  searchParams,
}: {
  searchParams: Promise<LaunchQuery>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const account = await getCurrentAccount();
  const mode = launchPageMode({
    signedIn: account !== null,
    draftId: query.draft ?? null,
    librarySdkId: query.library ?? null,
  });
  const openLaunchPromise = account ? loadOpenLaunch(account.id) : Promise.resolve(null);
  const officialPromise = loadOfficialSdk();
  let source: Awaited<ReturnType<typeof resolveLaunchQuery>> | null = null;
  let held: {
    name: string;
    description: string;
    provenance: string;
    versionLabel: string;
    originatorLabel: string;
  } | null = null;
  let message: string | null = null;
  if (mode === "conflict") {
    message = launchMessage("source");
  } else if (mode === "private-sign-in") {
    message = "Sign in to open this saved SDK.";
  } else if (mode === "public-hold" && query.library) {
    try {
      const detail = await readPublished(query.library, query.version ?? null);
      held = {
        name: detail.name,
        description: detail.description,
        provenance:
          detail.origin === "official"
            ? "Official Library"
            : "Community Library",
        versionLabel: `Version ${detail.versionNumber}`,
        originatorLabel: detail.originatorLabel,
      };
    } catch (error) {
      message =
        error instanceof BlueprintFlowError && error.status === 503
          ? launchMessage("unavailable")
          : "That SDK is not available.";
    }
  } else if (mode === "resolve" && account) {
    try {
      source = await resolveLaunchQuery(account, {
        draftId: query.draft ?? null,
        librarySdkId: query.library ?? null,
        versionId: query.version ?? null,
      });
    } catch (error) {
      message = launchMessage(
        error instanceof LaunchFlowError ? error.code : "unavailable"
      );
    }
  }
  const [openLaunch, catalog, official] = await Promise.all([
    openLaunchPromise,
    source || held ? Promise.resolve(null) : loadCatalog(account, query),
    officialPromise,
  ]);
  const identity = officialIdentity(official);
  const mintRegistered = identity.mint !== null;
  return (
    <>
        {identity.mint ? (
          <p className="mt-4 break-all font-mono text-[12px] text-muted-foreground">
            Canonical parent {identity.mint}. Public token creation stays closed.
          </p>
        ) : null}
        {openLaunch ? (
          <div className="mt-6">
            <LaunchResume launch={openLaunch} />
          </div>
        ) : null}
        {process.env.NODE_ENV === "development" ? <LaunchCapabilityDiagnostic /> : null}
        {message ? (
          <p className="mt-6 text-[15px] leading-[1.6]" role="status">
            {message}
          </p>
        ) : null}
        {source ? (
          <LaunchForm
            key={`${source.kind}:${source.draftId ?? source.librarySdkId}:${source.versionId}`}
            source={source}
            mintRegistered={mintRegistered}
          />
        ) : null}
        {held ? <HeldSdk sdk={held} mintRegistered={mintRegistered} /> : null}
        {catalog ? (
          <LaunchSelector
            signedIn={account !== null}
            mine={catalog.mine}
            mineUnavailable={catalog.mineUnavailable}
            library={catalog.library}
            libraryUnavailable={catalog.libraryUnavailable}
            query={catalog.query}
            nextPage={catalog.nextPage}
          />
        ) : null}
    </>
  );
}

async function loadCatalog(
  account: AccountIdentity | null,
  params: { q?: string; page?: string },
): Promise<{
  mine: LaunchChoice[] | null;
  mineUnavailable: boolean;
  library: LaunchChoice[];
  libraryUnavailable: boolean;
  query: Pick<LibraryQuery, "q" | "page">;
  nextPage: number | null;
}> {
  const requested = libraryQuery(params);
  const publishedTask = listPublished({
    q: params.q ?? null,
    page: params.page ?? null,
  }).then((published) => ({
    library: published.listings.map((sdk) => toLibraryChoice(sdk)),
    libraryUnavailable: false,
    query: { q: published.query.q, page: published.query.page },
    nextPage: published.nextPage,
  })).catch(() => ({
    library: [] as LaunchChoice[],
    libraryUnavailable: true,
    query: { q: requested.q, page: requested.page },
    nextPage: null as number | null,
  }));
  const draftsTask = account
    ? listDrafts(account).then(
        (drafts) => drafts,
        () => null,
      )
    : Promise.resolve(null);
  const [published, drafts] = await Promise.all([publishedTask, draftsTask]);
  if (!account) {
    return { mine: null, mineUnavailable: false, ...published };
  }
  if (!drafts) {
    return { mine: null, mineUnavailable: true, ...published };
  }
  return {
    mine: drafts
      .filter(isLaunchEligibleDraft)
      .filter((draft) => matchesSdkQuery(draft, published.query.q))
      .map((draft) => toDraftChoice(draft)),
    mineUnavailable: false,
    ...published,
  };
}
