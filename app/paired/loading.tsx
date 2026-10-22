import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import type { ReactNode } from "react";

export default function Loading(): ReactNode {
  return (
    <>
      <Nav />
      <main id="main-content" className="mx-auto w-[min(1100px,calc(100%-48px))] pt-8 pb-16 max-[561px]:w-[calc(100%-32px)]">
        <p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">Loading pairs</p>
      </main>
      <Footer />
    </>
  );
}
