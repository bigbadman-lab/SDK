"use client";

import { ArrowUpRight, FlaskConical, Rocket, SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { HomePrompt } from "@/components/builder/home-prompt";
import { LandscapeCanvas } from "@/components/landscape-canvas";
import { softEase, useReducedMotion } from "@/lib/motion";
import { motion } from "motion/react";

const NOTES = [
  {
    Icon: SquarePen,
    title: "Build",
    text: "A private draft is a workspace for a future SDK. It is not a public product.",
    href: "#journeys",
    label: "See the journeys",
  },
  {
    Icon: FlaskConical,
    title: "Test",
    text: "Test SDK runs the current blueprint on the shared engine. The result stays private.",
    href: "#scope",
    label: "See current scope",
  },
  {
    Icon: Rocket,
    title: "Launch",
    text: "A verified token paired with $SDK publishes the product. There is no separate publish action.",
    href: "#journeys",
    label: "How publication works",
  },
] as const;

export function BuilderIntro(): ReactNode {
  const reduced = useReducedMotion();

  return (
    <section
      id="builder"
      className="mx-auto w-[min(1100px,_calc(100%_-_48px))] scroll-mt-23 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]"
      aria-labelledby="builder-title"
    >
      <div className="relative isolate overflow-hidden bg-scene px-6 pt-8 pb-36 max-[561px]:px-4 max-[561px]:pt-6 max-[561px]:pb-24">
        <LandscapeCanvas />
        <div className="relative z-10 mx-auto w-[min(720px,100%)]">
          <h2 id="builder-title" className="sr-only">
            Builder
          </h2>
          <HomePrompt />
        </div>
      </div>
      <div className="grid grid-cols-3 border border-t-0 border-solid border-border max-[561px]:grid-cols-1">
        {NOTES.map(({ Icon, title, text, href, label }, index) => (
          <motion.article
            className="flex flex-col items-start px-7 py-8 max-[800px]:px-5 max-[800px]:py-6 max-[561px]:p-7 [&_+_article]:border-l [&_+_article]:border-l-border max-[561px]:[&_+_article]:border-t max-[561px]:[&_+_article]:border-l-0 max-[561px]:[&_+_article]:border-t-border [&_>_a]:mt-auto [&_>_a]:inline-flex [&_>_a]:items-center [&_>_a]:gap-1.5 [&_>_a]:font-mono [&_>_a]:text-[11px] [&_>_a]:hover:underline [&_>_a]:hover:underline-offset-4 [&_>_svg]:mb-5 [&_>_svg]:text-accent-ink max-[561px]:[&_>_svg]:mb-3.5 [&_h3]:mb-2.5 [&_h3]:text-[20px] max-[800px]:[&_h3]:text-[17px] [&_p]:mb-6.5 [&_p]:max-w-72.5 [&_p]:text-[14px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground max-[800px]:[&_p]:text-[13px] max-[561px]:[&_p]:mb-5 max-[561px]:[&_p]:max-w-none"
            key={title}
            initial={reduced ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{
              duration: reduced ? 0 : 0.7,
              delay: reduced ? 0 : index * 0.1,
              ease: softEase,
            }}
          >
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
            <a href={href}>
              {label} <ArrowUpRight size={13} />
            </a>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
