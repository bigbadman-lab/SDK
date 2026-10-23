import { Footer } from "@/components/footer";
import type { ReactNode } from "react";

export default function Loading(): ReactNode {
  return (
    <>
      <main id="main-content" className="mx-auto w-[min(980px,calc(100%-48px))] pt-12 pb-22 max-[561px]:w-[calc(100%-24px)]">
        <div className="h-3 w-24 animate-pulse bg-card" />
        <div className="mt-5 h-16 max-w-xl animate-pulse bg-card" />
        <div className="mt-6 h-20 max-w-2xl animate-pulse bg-card" />
        <div className="mt-8 h-24 animate-pulse border border-border bg-card" />
        <div className="mt-8 grid grid-cols-2 gap-2 min-[801px]:grid-cols-4">
          {["cap", "price", "volume", "holders"].map((key) => (
            <div key={key} className="h-16 animate-pulse border border-border bg-card" />
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
