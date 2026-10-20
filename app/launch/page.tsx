import { Footer } from "@/components/footer";
import { LaunchForm } from "@/components/launch/form";
import { LaunchCapabilityDiagnostic } from "@/components/launch/wallet-capability";
import {
  HeldSdk,
  LaunchSelector,
  toDraftChoice,
  toLibraryChoice,
  type LaunchChoice,
} from "@/components/launch/selector";
import { Nav } from "@/components/nav";
import {
  isLaunchEligibleDraft,
  launchPageMode,
  matchesSdkQuery,
} from "@/lib/launch/catalog";
import { launchMessage } from "@/lib/launch/messages";
import { libraryQuery, type LibraryQuery } from "@/lib/library/library";
import { createMetadata } from "@/lib/metadata";
import { getCurrentAccount } from "@/lib/server/account";
import { isProvisionedOperator } from "@/lib/server/operator";
import type { AccountIdentity } from "@/lib/server/auth";
import { BlueprintFlowError, listDrafts } from "@/lib/server/blueprint/service";
import {
  LaunchFlowError,
  resolveLaunchQuery,
} from "@/lib/server/launch/service";
import { listPublished, readPublished } from "@/lib/server/library/service";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "Launch your SDK",
    description:
      "Turn a working SDK into a token paired with $SDK. On-chain launching is not available yet.",
    path: "/launch",
  }),
  robots: { index: false, follow: false },
};

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{
    draft?: string;
    library?: string;
    version?: string;
    q?: string;
    page?: string;
    rehearsal?: string;
  }>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const account = await getCurrentAccount();
  const rehearsalRequested = query.rehearsal === "trest";
  const rehearsal = Boolean(
    rehearsalRequested && account && isProvisionedOperator(account.walletAddress),
  );
  const mode = launchPageMode({
    signedIn: account !== null,
    draftId: query.draft ?? null,
    librarySdkId: query.library ?? null,
  });
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
  const catalog = source || held ? null : await loadCatalog(account, query, rehearsal);
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-[min(680px,calc(100%-48px))] scroll-mt-23 pt-12 pb-16 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-8"
      >
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
          Launch
        </p>
        <h1 className="mt-3 font-display text-[48px] leading-[1.08] tracking-[-1.4px] max-[561px]:text-[36px]">
          Launch your SDK
        </h1>
        <p className="mt-3 max-w-150 text-[16px] leading-[1.6] text-muted-foreground">
          {rehearsal
            ? "TREST rehearsal. Choose an SDK and prepare it against the registered TREST parent."
            : "Turn your working SDK into a live token paired with $SDK."}
        </p>
        {rehearsalRequested && !rehearsal ? (
          <p className="mt-6 text-[15px] leading-[1.6]" role="status">
            The TREST rehearsal is limited to the provisioned operator. This page stays paired with $SDK.
          </p>
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
            rehearsal={rehearsal}
          />
        ) : null}
        {held ? <HeldSdk sdk={held} /> : null}
        {catalog ? (
          <LaunchSelector
            signedIn={account !== null}
            mine={catalog.mine}
            mineUnavailable={catalog.mineUnavailable}
            library={catalog.library}
            libraryUnavailable={catalog.libraryUnavailable}
            query={catalog.query}
            nextPage={catalog.nextPage}
            rehearsal={rehearsal}
          />
        ) : null}
      </main>
      <Footer />
    </>
  );
}

async function loadCatalog(
  account: AccountIdentity | null,
  params: { q?: string; page?: string },
  rehearsal: boolean,
): Promise<{
  mine: LaunchChoice[] | null;
  mineUnavailable: boolean;
  library: LaunchChoice[];
  libraryUnavailable: boolean;
  query: Pick<LibraryQuery, "q" | "page">;
  nextPage: number | null;
}> {
  const requested = libraryQuery(params);
  let library: LaunchChoice[] = [];
  let libraryUnavailable = false;
  let nextPage: number | null = null;
  let query: Pick<LibraryQuery, "q" | "page"> = {
    q: requested.q,
    page: requested.page,
  };
  try {
    const published = await listPublished({
      q: params.q ?? null,
      page: params.page ?? null,
    });
    library = published.listings.map((sdk) => toLibraryChoice(sdk, rehearsal));
    nextPage = published.nextPage;
    query = { q: published.query.q, page: published.query.page };
  } catch {
    libraryUnavailable = true;
  }
  if (!account) {
    return {
      mine: null,
      mineUnavailable: false,
      library,
      libraryUnavailable,
      query,
      nextPage,
    };
  }
  try {
    const drafts = await listDrafts(account);
    return {
      mine: drafts
        .filter(isLaunchEligibleDraft)
        .filter((draft) => matchesSdkQuery(draft, query.q))
        .map((draft) => toDraftChoice(draft, rehearsal)),
      mineUnavailable: false,
      library,
      libraryUnavailable,
      query,
      nextPage,
    };
  } catch {
    return {
      mine: null,
      mineUnavailable: true,
      library,
      libraryUnavailable,
      query,
      nextPage,
    };
  }
}
