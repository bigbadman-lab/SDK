import { HomeCopy, HomeEyebrow, HomeHeading, HomeLink, homeFrame } from "@/components/home/chrome";
import { OFFICIAL_SDK_NAMES, type LibraryOrigin } from "@/lib/library/library";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { listPublished, type LibraryCard } from "@/lib/server/library/service";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

export function LibraryShowcase(): ReactNode {
  return (
    <section id="library-home" className={`${homeFrame} mt-24 scroll-mt-23 max-[800px]:mt-18 max-[561px]:mt-14`} aria-labelledby="library-home-title">
      <HomeEyebrow>Explore the Library</HomeEyebrow>
      <HomeHeading id="library-home-title">Don&apos;t start from zero.</HomeHeading>
      <HomeCopy>
        Discover working SDKs created by the platform and its developer community. Test existing tools,
        remix their logic, or use them as the foundation for your own launch.
      </HomeCopy>
      <p className="mt-3 max-w-150 text-[15px] leading-[1.7] text-muted-foreground">
        Every SDK is designed to be reusable, configurable and accessible through the same execution engine.
      </p>
      <Suspense fallback={<LibrarySkeleton />}>
        <LibraryCards />
      </Suspense>
      <div className="mt-8">
        <HomeLink href="/library" tone="secondary">
          Explore All SDKs
        </HomeLink>
      </div>
    </section>
  );
}

async function LibraryCards(): Promise<ReactNode> {
  const loaded = await loadFeatured();
  if (loaded.kind === "unavailable") {
    return (
      <p className="mt-8 text-[15px] leading-[1.7] text-muted-foreground">
        The Library is unavailable until its tables exist. No SDKs are being shown in their place.
      </p>
    );
  }
  if (loaded.kind === "error") {
    return <p className="mt-8 text-[15px] leading-[1.7] text-muted-foreground">Published SDKs could not be read.</p>;
  }
  if (loaded.listings.length === 0) {
    return <p className="mt-8 text-[15px] leading-[1.7] text-muted-foreground">No published SDKs are listed.</p>;
  }
  return (
    <ul className="mt-8 grid gap-4 min-[701px]:grid-cols-2 min-[1000px]:grid-cols-3">
      {loaded.listings.map((sdk) => (
        <li key={sdk.id}>
          <SdkCard sdk={sdk} />
        </li>
      ))}
    </ul>
  );
}

async function loadFeatured(): Promise<
  | { kind: "ready"; listings: LibraryCard[] }
  | { kind: "unavailable" }
  | { kind: "error" }
> {
  try {
    const result = await listPublished({});
    return { kind: "ready", listings: featured(result.listings) };
  } catch (error) {
    const described = describeBlueprintError(error);
    return described.status === 503 ? { kind: "unavailable" } : { kind: "error" };
  }
}

function SdkCard({ sdk }: { sdk: LibraryCard }): ReactNode {
  return (
    <article className="flex h-full flex-col gap-4 border border-solid border-border bg-card p-6">
      <span className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
        {originLabel(sdk.origin)}
      </span>
      <h3 className="font-display text-[26px] leading-[1.15] tracking-[-0.5px]">
        <Link href={`/library/${sdk.id}`} className="hover:text-accent-ink">
          {sdk.name}
        </Link>
      </h3>
      <p className="line-clamp-3 text-[14px] leading-[1.6] text-muted-foreground">{sdk.description}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Link
          href={`/library/${sdk.id}`}
          className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          View SDK
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

function originLabel(origin: LibraryOrigin): string {
  return origin === "official" ? "Official" : "Community";
}

function featured(listings: LibraryCard[]): LibraryCard[] {
  return listings
    .map((sdk, position) => ({ sdk, position }))
    .sort((left, right) => {
      const leftIndex = (OFFICIAL_SDK_NAMES as readonly string[]).indexOf(left.sdk.name);
      const rightIndex = (OFFICIAL_SDK_NAMES as readonly string[]).indexOf(right.sdk.name);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.position - right.position;
    })
    .slice(0, 3)
    .map((item) => item.sdk);
}

function LibrarySkeleton(): ReactNode {
  return (
    <div className="mt-8 grid gap-4 min-[701px]:grid-cols-2 min-[1000px]:grid-cols-3" aria-busy="true">
      <p className="sr-only">Loading published SDKs</p>
      {Array.from({ length: 3 }, (_, index) => (
        <span key={index} className="block h-48 motion-safe:animate-pulse bg-muted" />
      ))}
    </div>
  );
}
