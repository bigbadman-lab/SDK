import { WalletButton } from "@/components/wallet/wallet-button";
import {
  launchCatalogHref,
  launchDraftHref,
  launchLibraryHref,
} from "@/lib/launch/catalog";
import type { LibraryQuery } from "@/lib/library/library";
import Link from "next/link";
import type { ReactNode } from "react";

export type LaunchChoice = {
  id: string;
  name: string;
  description: string;
  provenance: string;
  versionLabel: string;
  originatorLabel: string;
  href: string;
};

export function LaunchSelector({
  signedIn,
  mine,
  mineUnavailable,
  library,
  libraryUnavailable,
  query,
  nextPage,
  rehearsal = false,
}: {
  signedIn: boolean;
  mine: LaunchChoice[] | null;
  mineUnavailable: boolean;
  library: LaunchChoice[];
  libraryUnavailable: boolean;
  query: Pick<LibraryQuery, "q" | "page">;
  nextPage: number | null;
  rehearsal?: boolean;
}): ReactNode {
  return (
    <div className="mt-6 grid gap-6">
      <section className="grid gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">
          My SDKs
        </h2>
        {mineUnavailable ? (
          <p className="text-[14px] leading-[1.5] text-muted-foreground">
            Saved SDKs are unavailable.
          </p>
        ) : !signedIn || mine === null ? (
          <div className="grid gap-3 border border-solid border-border p-4">
            <p className="text-[14px] leading-[1.5] text-muted-foreground">
              Sign in to see tested SDKs saved on this wallet.
            </p>
            <WalletButton />
          </div>
        ) : mine.length === 0 ? (
          <p className="border border-solid border-border p-4 text-[14px] leading-[1.5] text-muted-foreground">
            {query.q
              ? "None of your tested SDKs match this search."
              : "No tested SDKs yet. Save an SDK and run a successful test, then it can be launched."}
          </p>
        ) : (
          <ChoiceList choices={mine} />
        )}
      </section>
      <section className="grid gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">
          SDK Library
        </h2>
        <form method="get" action="/launch" className="flex gap-2">
          {rehearsal ? <input type="hidden" name="rehearsal" value="trest" /> : null}
          <label className="sr-only" htmlFor="launch-sdk-search">
            Search published SDKs
          </label>
          <input
            id="launch-sdk-search"
            name="q"
            defaultValue={query.q}
            placeholder="Search by name or description"
            className="min-w-0 flex-1 rounded-lg border border-solid border-border bg-background px-3 py-2 text-[16px]"
          />
          <button
            type="submit"
            className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
          >
            Search
          </button>
        </form>
        {libraryUnavailable ? (
          <p className="text-[14px] leading-[1.5] text-muted-foreground">
            The Library is unavailable. No SDKs are being shown in its place.
          </p>
        ) : library.length === 0 ? (
          <p className="border border-solid border-border p-4 text-[14px] leading-[1.5] text-muted-foreground">
            {query.q
              ? "No published SDKs match this search."
              : "No published SDKs yet."}
          </p>
        ) : (
          <ChoiceList choices={library} />
        )}
        {nextPage || query.page > 1 ? (
          <div className="flex gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
            {query.page > 1 ? (
              <Link
                href={launchCatalogHref({ q: query.q, page: query.page - 1, rehearsal })}
              >
                Previous
              </Link>
            ) : null}
            {nextPage ? (
              <Link href={launchCatalogHref({ q: query.q, page: nextPage, rehearsal })}>
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function HeldSdk({
  sdk,
  availability = "inactive",
}: {
  sdk: {
    name: string;
    description: string;
    provenance: string;
    versionLabel: string;
    originatorLabel: string;
  };
  availability?: "unregistered" | "inactive" | "open" | "unavailable";
}): ReactNode {
  return (
    <div className="mt-6 grid gap-4 border border-solid border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
          Your selected SDK
        </p>
        <Link
          href="/launch"
          className="font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Choose another SDK
        </Link>
      </div>
      <h2 className="font-display text-[26px] leading-[1.15]">{sdk.name}</h2>
      <p className="text-[14px] leading-[1.5] text-muted-foreground">
        {sdk.description}
      </p>
      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
        {sdk.provenance} · {sdk.versionLabel}
      </p>
      <p className="text-[14px] leading-[1.5]">
        Originating developer {sdk.originatorLabel}
      </p>
      <p className="text-[14px] leading-[1.5] text-muted-foreground">
        Connect your wallet to continue.
      </p>
      {availability === "open" ? null : (
        <p className="text-[14px] leading-[1.5] text-muted-foreground">
          {availability === "unavailable"
            ? "Launching is temporarily unavailable."
            : availability === "inactive"
              ? "Public launches stay paired with $SDK. Launching is not active yet."
              : "Token launching opens when the official $SDK mint is registered."}
        </p>
      )}
      <WalletButton />
    </div>
  );
}

export function toDraftChoice(
  draft: {
    id: string;
    name: string;
    description: string;
    originatorLabel: string;
  },
  rehearsal = false,
): LaunchChoice {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    provenance: "My SDK",
    versionLabel: "Tested revision",
    originatorLabel: draft.originatorLabel,
    href: launchDraftHref(draft.id, rehearsal),
  };
}

export function toLibraryChoice(sdk: {
  id: string;
  name: string;
  description: string;
  origin: "official" | "community";
  originatorLabel: string;
  versionId: string;
  versionNumber: number;
}, rehearsal = false): LaunchChoice {
  return {
    id: sdk.id,
    name: sdk.name,
    description: sdk.description,
    provenance: sdk.origin === "official" ? "Official" : "Community",
    versionLabel: `Version ${sdk.versionNumber}`,
    originatorLabel: sdk.originatorLabel,
    href: launchLibraryHref(sdk.id, sdk.versionId, rehearsal),
  };
}

function ChoiceList({ choices }: { choices: LaunchChoice[] }): ReactNode {
  return (
    <ul className="border border-solid border-border">
      {choices.map((sdk) => (
        <li
          key={sdk.id}
          className="flex flex-col gap-3 border-b border-solid border-border px-3 py-3 last:border-b-0 min-[561px]:flex-row min-[561px]:items-center"
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
              {sdk.provenance} · {sdk.versionLabel}
            </p>
            <h3 className="text-[16px] leading-[1.3]">{sdk.name}</h3>
            <p className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">
              {sdk.description}
            </p>
            <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
              {sdk.originatorLabel}
            </p>
          </div>
          <Link
            href={sdk.href}
            className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 text-center font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
          >
            Use this SDK
          </Link>
        </li>
      ))}
    </ul>
  );
}
