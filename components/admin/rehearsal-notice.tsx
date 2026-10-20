import { rehearsalGate } from "@/lib/launch/rehearsal";
import type { ReactElement } from "react";

export function RehearsalNotice({ registered }: { registered: boolean }): ReactElement {
  const gate = rehearsalGate({
    registered,
    observationOk: registered,
    builderReady: false,
    migrationsApplied: false,
    simulationPassed: false,
    operatorAuthorised: false,
  });
  return (
    <section className="mt-10 grid gap-3 border border-solid border-border bg-card p-5">
      <h2 className="font-display text-[28px] leading-[1.2]">Child rehearsal</h2>
      <p className="text-[15px] leading-[1.6] text-muted-foreground">
        Open the existing launch form for this rehearsal. It prepares against the registered TREST parent. Public
        visitors stay on $SDK. Signing and submission stay closed until that launch is approved.
      </p>
      <ul className="grid gap-1 text-[14px] leading-[1.5]">
        {gate.missing.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
