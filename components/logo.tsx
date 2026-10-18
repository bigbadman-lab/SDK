import Image from "next/image";
import type { ReactNode } from "react";

export function Logo(): ReactNode {
  return (
    <Image
      src="/images/sdkmain.png"
      alt="SDK"
      width={600}
      height={200}
      priority
      className="h-8 w-auto invert dark:invert-0 max-[561px]:h-7"
    />
  );
}
