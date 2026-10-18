"use client";

import { motion } from "motion/react";
import { softEase, useReducedMotion } from "@/lib/motion";
import type { ReactNode } from "react";

export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}): ReactNode {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      {...(reduced ? { animate: { opacity: 1, y: 0 } } : {})}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        duration: reduced ? 0 : 0.8,
        ease: softEase,
        delay: reduced ? 0 : delay,
      }}
    >
      {children}
    </motion.div>
  );
}
