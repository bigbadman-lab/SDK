import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { OFFICIAL_SDK_NAMES, libraryHref, libraryQuery, operationLabels, type LibraryQuery } from "@/lib/library/library";
import { createMetadata } from "@/lib/metadata";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { listPublished, type LibraryCard } from "@/lib/server/library/service";
import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "Library",
  description:
    "Discover working SDKs built by the platform and its developer community. Test them, remix them, or launch a token using an existing SDK.",
  path: "/library",
});

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; origin?: string; page?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const loaded = await loadListings(params);
  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-16 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Explore SDKs</span>
        <h1 className="mt-6 max-w-160 font-display text-[56px] leading-[1.08] tracking-[-1.6px] max-[561px]:text-[38px]">
          Don&apos;t start from zero.
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">
          Discover working SDKs built by the platform and its developer community. Test what they do, remix
          them into your own creations or launch a token using an existing SDK.
        </p>
        <form method="get" action="/library" className="mt-8 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="library-search">
            Search SDKs
          </label>
          <input
            id="library-search"
            name="q"
            defaultValue={loaded.query.q}
            placeholder="Search SDKs..."
            className="min-w-0 flex-1 rounded-lg border border-solid border-border bg-card px-3 py-2 text-[14px] max-[561px]:w-full max-[561px]:flex-none"
          />
          <label className="sr-only" htmlFor="library-origin">
            Origin
          </label>
          <select
            id="library-origin"
            name="origin"
            defaultValue={loaded.query.origin ?? ""}
            className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[11px] uppercase"
          >
            <option value="">All</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
          <button
            type="submit"
            className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
          >
            Search
          </button>
        </form>
        {loaded.unavailable ? (
          <p className="mt-10 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
            The SDK Library couldn&apos;t be loaded. Please try again.
          </p>
        ) : loaded.listings.length === 0 ? (
          <p className="mt-10 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">{emptyCopy(loaded.query)}</p>
        ) : (
          <ul className="mt-10 grid gap-4 min-[801px]:grid-cols-2">
            {orderedListings(loaded.listings).map((sdk) => (
              <li key={sdk.id} className="min-h-full">
                <SdkCard sdk={sdk} />
              </li>
            ))}
          </ul>
        )}
        {loaded.nextPage || loaded.query.page > 1 ? (
          <div className="mt-6 flex gap-4 font-mono text-[11px] uppercase">
            {loaded.query.page > 1 ? (
              <Link href={libraryHref({ ...loaded.query, page: loaded.query.page - 1 })}>Previous</Link>
            ) : null}
            {loaded.nextPage ? (
              <Link href={libraryHref({ ...loaded.query, page: loaded.nextPage })}>Next</Link>
            ) : null}
          </div>
        ) : null}
        <section className="mt-16 border border-solid border-border bg-card px-6 py-8 max-[561px]:px-5">
          <h2 className="font-display text-[32px] leading-[1.2] tracking-[-0.8px] max-[561px]:text-[26px]">
            Have something worth sharing?
          </h2>
          <p className="mt-4 max-w-130 text-[16px] leading-[1.7] text-muted-foreground">
            Build your own SDK and submit it to the Library for others to discover, test and remix.
          </p>
          <div className="mt-6">
            <HomeLink href="/build" tone="primary">
              Open Builder
            </HomeLink>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function emptyCopy(query: LibraryQuery): string {
  if (query.q.trim()) return "No SDKs match your search. Try another keyword or browse the full Library.";
  if (query.origin === "community") return "No community SDKs match your filters.";
  return "No SDKs match your search. Try another keyword or browse the full Library.";
}

function SdkCard({ sdk }: { sdk: LibraryCard }): ReactNode {
  const families = operationLabels(sdk.capabilities);
  return (
    <article className="flex h-full flex-col gap-4 border border-solid border-border bg-card p-6 transition-colors hover:border-accent focus-within:border-accent">
      <h2 className="text-[28px] leading-[1.15] tracking-[-0.6px] break-words">
        <Link href={`/library/${sdk.id}`} className="font-display">
          {sdk.name}
        </Link>
      </h2>
      <p className="line-clamp-3 text-[14px] leading-[1.6] text-muted-foreground">{sdk.description}</p>
      <p className="font-mono text-[10px] tracking-[0.06em] uppercase">
        <span className="text-accent-ink">{sdk.origin === "official" ? "Official" : "Community"}</span>
        <span className="text-muted-foreground"> · {sdk.originatorLabel}</span>
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Link
          href={`/library/${sdk.id}`}
          className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
        >
          Explore SDK
        </Link>
        <Link
          href={`/library/${sdk.id}#remix`}
          className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Remix
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[10px] text-muted-foreground uppercase">Version {sdk.versionNumber}</span>
        {families.map((family) => (
          <span key={family} className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            {family}
          </span>
        ))}
      </div>
    </article>
  );
}

function orderedListings(listings: LibraryCard[]): LibraryCard[] {
  return listings
    .map((sdk, position) => ({ sdk, position }))
    .sort((left, right) => {
      const leftIndex = officialPosition(left.sdk.name);
      const rightIndex = officialPosition(right.sdk.name);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.position - right.position;
    })
    .map((item) => item.sdk);
}

function officialPosition(name: string): number {
  return (OFFICIAL_SDK_NAMES as readonly string[]).indexOf(name);
}

async function loadListings(params: { q?: string; origin?: string; page?: string }): Promise<{
  query: LibraryQuery;
  listings: LibraryCard[];
  nextPage: number | null;
  unavailable: boolean;
}> {
  try {
    const result = await listPublished(params);
    return { ...result, unavailable: false };
  } catch (error) {
    const described = describeBlueprintError(error);
    return {
      query: libraryQuery(params),
      listings: [],
      nextPage: null,
      unavailable: described.status >= 500,
    };
  }
}
