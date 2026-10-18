import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { createMetadata } from "@/lib/metadata";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "About",
  description:
    "What SDK is, what this website can do today, and what remains unavailable.",
  path: "/about",
});

export default function AboutPage(): ReactNode {
  return (
    <>
      <div className="mx-auto flex min-h-20 w-[min(1100px,_calc(100%_-_48px))] items-center justify-between gap-6 border-b border-b-border py-5 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:min-h-18 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:gap-4 max-[561px]:py-4">
        <Link href="/" aria-label="SDK home">
          <Logo />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 py-2 font-mono text-[10px] leading-[1.5] font-normal text-muted-foreground not-italic hover:text-accent-ink max-[561px]:gap-1 max-[561px]:text-[8px]"
        >
          <ArrowLeft size={14} /> BACK TO SDK
        </Link>
      </div>
      <main
        id="main-content"
        className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pb-16 [&_[data-ui~='article-body']_a]:underline [&_[data-ui~='article-body']_a]:underline-offset-[3px] [&_code]:font-mono [&_code]:text-[0.92em]"
      >
        <header className="pt-16 pb-8 max-[800px]:pt-12 max-[561px]:pt-10 max-[561px]:pb-7 [&_h1]:mt-6 [&_h1]:font-display [&_h1]:text-[56px] [&_h1]:leading-[1.14] [&_h1]:tracking-[-1.6px] [&_h1]:text-balance max-[800px]:[&_h1]:text-[48px] max-[561px]:[&_h1]:mt-5 max-[561px]:[&_h1]:text-[38px] max-[561px]:[&_h1]:leading-[1.16] max-[561px]:[&_h1]:tracking-[-1px]">
          <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">
            About
          </span>
          <h1>
            A product description.
            <br />
            <em>Not a live launch.</em>
          </h1>
        </header>
        <div
          className="mt-4 [&_h2]:text-[28px] [&_h2]:leading-[1.3] [&_h2]:tracking-[-0.5px] max-[561px]:[&_h2]:text-[25px] [&_p]:mt-4 [&_p]:text-[17px] [&_p]:leading-[1.8] [&_p]:text-pretty [&_p]:text-muted-foreground max-[561px]:[&_p]:text-[16px] [&_section_+_section]:mt-10"
          data-ui="article-body"
        >
          <section>
            <h2>What SDK is</h2>
            <p>
              SDK is a unified place to build a working SDK, test it, and launch
              a token paired with native $SDK. A verified launch automatically
              publishes the working, token-associated product. There is no
              separate publish step for that journey.
            </p>
            <p>
              Community developers will be able to build, test, and submit a
              reusable SDK without minting a token. Operator approval makes a
              library listing that other people can launch. A draft or a library
              listing is not itself a launched product.
            </p>
          </section>
          <section>
            <h2>What this website does today</h2>
            <p>
              It explains that product and keeps a dark theme by default. You
              can switch to a light theme, and you can pause motion. Those
              preferences stay in this browser. The Builder shows example
              prompts. Those prompts are not submitted, and the page does not
              invent progress or results.
            </p>
            <p>
              It does not execute an SDK, connect a wallet, mint a token, take
              payment, or show trading or reward activity. No production domain
              is configured, so this deployment does not publish a canonical
              public URL of its own.
            </p>
          </section>
          <section id="setup" className="scroll-mt-23">
            <h2>Local setup</h2>
            <p>
              The app expects Node.js 20.9 or newer and npm. Install from the
              lockfile with <code>npm ci</code>, then start it with{" "}
              <code>npm run dev</code>. No provider secrets are required for
              these pages. Recognized variable names are listed in{" "}
              <code>.env.example</code>.
            </p>
          </section>
          <section>
            <h2>Design and photography</h2>
            <p>
              The interface keeps the Agentframe visual system from React Bits
              Pro: serif display type, mono labels, the cobalt accent, and the
              pixel landscape. The landscape is a local copy of Blanca Lake,
              photographed by{" "}
              <a
                href="https://unsplash.com/photos/landscape-photography-of-mountain-surrounded-by-pine-trees-and-body-of-water-4qKVQYOluDk"
                target="_blank"
                rel="noopener noreferrer"
              >
                Yoshi Takekawa
              </a>{" "}
              and used under the{" "}
              <a
                href="https://unsplash.com/license"
                target="_blank"
                rel="noopener noreferrer"
              >
                Unsplash License
              </a>
              . Template terms are in the repository LICENSE file. The wordmark
              is the text “SDK” until approved artwork exists.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
