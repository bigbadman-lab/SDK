import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
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
    "Inspect published SDKs, test them on the shared engine, and remix a private copy. A private draft is not a public listing.",
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
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-[min(1100px,calc(100%-48px))] scroll-mt-23 pt-16 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Library</span>
        <h1 className="mt-6 max-w-160 font-display text-[56px] leading-[1.08] tracking-[-1.6px] max-[561px]:text-[38px]">
          Public SDKs.
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">
          Published official and community SDKs can be inspected, tested, and remixed. A saved private draft stays on your account. A test is not a launch.
        </p>
        <form method="get" action="/library" className="mt-8 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="library-search">
            Search SDKs
          </label>
          <input
            id="library-search"
            name="q"
            defaultValue={loaded.query.q}
            placeholder="Search by name or description"
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
          <p className="mt-10 text-[15px] leading-[1.7] text-muted-foreground">
            The Library is unavailable until its tables exist. No SDKs are being shown in their place.
          </p>
        ) : loaded.listings.length === 0 ? (
          <p className="mt-10 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
            No published SDKs yet. Official SDKs and approved community SDKs will appear here. A private draft is not published by saving it.
          </p>
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
      </main>
      <Footer />
    </>
  );
}

function SdkCard({ sdk }: { sdk: LibraryCard }): ReactNode {
  const families = operationLabels(sdk.capabilities);
  const index = catalogIndex(sdk.name);
  return (
    <article className="relative flex h-full flex-col gap-4 border border-solid border-border bg-card p-6 transition-colors hover:border-accent focus-within:border-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-3">
          {index ? (
            <span className="font-display text-[28px] leading-none tracking-[-0.6px] text-muted-foreground">{index}</span>
          ) : null}
          <span className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            {sdk.origin === "official" ? "Official" : "Community"}
          </span>
        </div>
        <span className="pt-1 font-mono text-[10px] text-muted-foreground uppercase">Version {sdk.versionNumber}</span>
      </div>
      <h2 className="text-[28px] leading-[1.15] tracking-[-0.6px]">
        <Link href={`/library/${sdk.id}`} className="font-display after:absolute after:inset-0">
          {sdk.name}
        </Link>
      </h2>
      <p className="line-clamp-3 text-[14px] leading-[1.6] text-muted-foreground">{sdk.description}</p>
      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">By {sdk.originatorLabel}</p>
      {families.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {families.map((family) => (
            <li
              key={family}
              className="rounded-lg border border-solid border-border px-2 py-1 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase"
            >
              {family}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative z-10 mt-auto flex flex-wrap gap-2 pt-2">
        <Link
          href={`/library/${sdk.id}#test`}
          className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Test
        </Link>
        <Link
          href={`/library/${sdk.id}#remix`}
          className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
        >
          Remix
        </Link>
      </div>
    </article>
  );
}

function catalogIndex(name: string): string | null {
  const index = officialPosition(name);
  if (index < 0) return null;
  return String(index + 1).padStart(2, "0");
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
      unavailable: described.status === 503,
    };
  }
}
