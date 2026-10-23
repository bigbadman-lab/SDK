import { HomeCopy, HomeEyebrow, HomeHeading, HomeLink, homeFrame } from "@/components/home/chrome";
import type { ReactNode } from "react";

const STEPS = [
  {
    number: "01",
    title: "Build",
    text: "Start from a prompt or create an SDK using the AI Builder.",
  },
  {
    number: "02",
    title: "Test",
    text: "Run your SDK against real inputs and refine the results.",
  },
  {
    id: "publish",
    number: "03",
    title: "Publish",
    text: "Submit your reusable SDK to the Library, where other developers can discover and remix it.",
  },
  {
    number: "04",
    title: "Launch",
    text: "Launch a token paired with $SDK and make your working application available to the ecosystem.",
  },
  {
    number: "05",
    title: "Integrate",
    text: "Access published SDKs through API keys and the universal SDK client.",
  },
] as const;

export function HowItWorks(): ReactNode {
  return (
    <section id="paths" className={`${homeFrame} my-24 scroll-mt-23 max-[800px]:my-18 max-[561px]:my-14`} aria-labelledby="paths-title">
      <HomeEyebrow>One platform. Multiple paths.</HomeEyebrow>
      <HomeHeading id="paths-title">Your software. Your route.</HomeHeading>
      <HomeCopy>
        There isn&apos;t one way to build with SDK. Create something new, improve what&apos;s already
        available, publish your work for others, or launch your own token.
      </HomeCopy>
      <ol className="mt-10 grid gap-8 min-[701px]:grid-cols-2 min-[1000px]:grid-cols-5 min-[1000px]:gap-5">
        {STEPS.map((step) => (
          <li key={step.number} id={"id" in step ? step.id : undefined} className="scroll-mt-23 border-t border-t-border pt-5">
            <span className="font-mono text-[11px] text-accent-ink">{step.number}</span>
            <h3 className="mt-3 text-[20px] leading-[1.25] tracking-[-0.4px]">{step.title}</h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-muted-foreground">{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8">
        <HomeLink href="/library" tone="primary">
          Explore the Platform
        </HomeLink>
      </div>
    </section>
  );
}
