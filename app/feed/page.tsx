import { Footer } from "@/components/footer";
import { VerifiedLaunchList } from "@/components/launch/verified-list";
import { Nav } from "@/components/nav";
import { createMetadata } from "@/lib/metadata";
import { loadVerifiedLaunches } from "@/lib/server/launch/discover";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = createMetadata({
  title: "Feed",
  description: "Verified SDK launches. Each post is the confirmed child token, its SDK, and its parent.",
  path: "/feed",
});

export default async function FeedPage(): Promise<ReactNode> {
  const loaded = await loadVerifiedLaunches();
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-[min(760px,calc(100%-48px))] scroll-mt-23 pt-16 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Feed</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.08] tracking-[-1.6px] max-[561px]:text-[38px]">
          Verified launches.
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">
          Each entry is a verified child-token launch. There is no separate post, like, or comment.
        </p>
        <div className="mt-8">
          {loaded.ok ? (
            <VerifiedLaunchList
              launches={loaded.launches}
              empty="The feed is empty. A submitted or failed transaction is not posted."
            />
          ) : (
            <p className="text-[15px] leading-[1.7] text-muted-foreground">The feed is unavailable.</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
