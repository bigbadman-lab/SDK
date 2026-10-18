"use client";

import { ArrowUpRight, FlaskConical, Rocket, SquarePen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LandscapeCanvas } from "@/components/landscape-canvas";
import { softEase, useReducedMotion } from "@/lib/motion";
import { motion } from "motion/react";

const EXAMPLES = [
  {
    title: "Prompt work",
    prompt:
      "Turn this rough instruction into a clearer prompt, with the variables and checks it is missing.",
  },
  {
    title: "Pasted records",
    prompt:
      "Normalize this pasted table into typed JSON, and show which rows were duplicates.",
  },
  {
    title: "Chain evidence",
    prompt:
      "Summarize this wallet’s recent activity from bounded account evidence, and separate observation from inference.",
  },
] as const;

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
    text: "A real test needs the shared engine. This page cannot run one.",
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
  const [selected, setSelected] = useState(0);
  const reduced = useReducedMotion();
  const example = EXAMPLES[selected];
  if (!example) return null;

  return (
    <section
      id="builder"
      className="mx-auto w-[min(1100px,_calc(100%_-_48px))] scroll-mt-23 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]"
      aria-labelledby="builder-title"
    >
      <div className="relative isolate h-150 overflow-hidden bg-scene max-[800px]:h-137 max-[561px]:h-125">
        <LandscapeCanvas />
        <div className="absolute top-[clamp(24px,_calc(30svh_-_192px),_250px)] left-1/2 w-[min(664px,_calc(100%_-_48px))] [transform:translateX(-50%)] rounded-[14px] border border-solid border-[color-mix(in_srgb,_var(--foreground)_30%,_var(--border))] bg-card px-5 pt-5 pb-4 shadow-[0_2px_8px_#00000020] max-[800px]:top-[clamp(24px,_calc(30svh_-_192px),_220px)] max-[561px]:top-[clamp(12px,_calc(30svh_-_192px),_72px)] max-[561px]:w-[calc(100%_-_32px)] max-[561px]:rounded-[10px] max-[561px]:px-3.5 max-[561px]:pt-4">
          <p
            id="builder-title"
            className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase"
          >
            Builder
          </p>
          <p className="mt-3 min-h-16 text-[15px] leading-[23px] max-[561px]:min-h-18 max-[561px]:text-[14px] max-[561px]:leading-[22px]">
            {example.prompt}
          </p>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Inert example prompts"
          >
            {EXAMPLES.map((item, index) => {
              const active = index === selected;
              return (
                <button
                  key={item.title}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    "rounded-md border border-solid px-2.5 py-1.5 font-mono text-[10px] tracking-[0.04em] uppercase " +
                    (active
                      ? "border-accent bg-accent-soft text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground")
                  }
                  onClick={() => setSelected(index)}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-t-border pt-3">
            <p
              id="builder-unavailable"
              className="font-mono text-[10px] leading-[1.5] text-muted-foreground"
            >
              Example only. Nothing is sent, and no result is produced.
            </p>
            <button
              type="button"
              disabled
              aria-describedby="builder-unavailable"
              className="shrink-0 rounded-lg border border-solid border-border bg-muted px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase"
            >
              Unavailable
            </button>
          </div>
        </div>
        <span className="absolute right-0 bottom-5 left-0 text-center font-mono text-[9px] tracking-[0.06em] text-[#ffffff] [text-shadow:0_1px_3px_#000] max-[561px]:bottom-4.5 max-[561px]:text-[7px]">
          THE ENGINE IS NOT CONNECTED.
        </span>
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
