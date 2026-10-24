import type { ReactNode } from "react";

export function TokenomicsChart({ holders, protocol }: { holders: string; protocol: string }): ReactNode {
  return (
    <figure>
      <div className="grid overflow-hidden border border-border sm:grid-cols-2" aria-hidden="true">
        <div className="bg-accent px-5 py-8 text-accent-foreground">
          <p className="font-display text-[48px] leading-none tracking-[-1.2px] max-[561px]:text-[40px]">{holders}%</p>
          <p className="mt-3 font-mono text-[10px] tracking-[0.06em] uppercase">Eligible $SDK holders</p>
        </div>
        <div className="bg-card px-5 py-8">
          <p className="font-display text-[48px] leading-none tracking-[-1.2px] max-[561px]:text-[40px]">{protocol}%</p>
          <p className="mt-3 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">Protocol</p>
        </div>
      </div>
      <figcaption className="mt-3 max-w-150 text-[13px] leading-[1.55] text-muted-foreground">
        {holders}% of eligible native creator-fee SOL is allocated to qualifying holders. {protocol}% is retained by the protocol. These shares follow collection and reserve treatment. They are not a percentage of trading volume.
      </figcaption>
    </figure>
  );
}

export function TokenomicsMetrics({
  holders,
  minimum,
  minutes,
}: {
  holders: string;
  minimum: string;
  minutes: string;
}): ReactNode {
  const metrics = [
    { value: `${holders}%`, label: "Native holder allocation" },
    { value: `${minimum} $SDK`, label: "Minimum eligible holdings" },
    { value: `${minutes} minutes`, label: "UTC accounting windows" },
    { value: "SOL", label: "Claimable reward asset" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px border border-border bg-border min-[801px]:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 bg-background px-3 py-4">
          <dt className="font-display text-[22px] leading-[1.15] tracking-[-0.4px] max-[561px]:text-[18px]">{metric.value}</dt>
          <dd className="mt-2 font-mono text-[10px] leading-[1.4] tracking-[0.04em] text-muted-foreground uppercase">{metric.label}</dd>
        </div>
      ))}
    </dl>
  );
}
