import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import type { ReactNode } from "react";

export default function Loading(): ReactNode {
  return (
    <>
      <Nav />
      <main id="main-content" className="mx-auto w-[min(760px,calc(100%-48px))] pt-16 pb-22 max-[561px]:w-[calc(100%-32px)]">
        <p className="text-[15px] leading-[1.7] text-muted-foreground">Loading verified launches.</p>
      </main>
      <Footer />
    </>
  );
}
