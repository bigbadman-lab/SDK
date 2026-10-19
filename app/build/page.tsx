import { BuilderPanel } from "@/components/builder/panel";
import { Nav } from "@/components/nav";
import { createMetadata } from "@/lib/metadata";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Builder",
  description:
    "Describe a private SDK, test it, and save it under a name you choose. A test is not a launch.",
  path: "/build",
});

export default function BuildPage(): ReactNode {
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className="mx-auto flex h-[calc(100svh-4rem)] w-[min(1180px,calc(100%-48px))] min-w-0 flex-col overflow-hidden pt-6 pb-6 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-4"
      >
        <h1 className="mb-4 font-display text-[40px] leading-[1.1] tracking-[-1px] max-[561px]:mb-3 max-[561px]:text-[32px]">
          Build an SDK.
        </h1>
        <BuilderPanel />
      </main>
    </>
  );
}
