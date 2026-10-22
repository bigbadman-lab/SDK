import type { ReactElement } from "react";

export function RehearsalNotice({ registered }: { registered: boolean }): ReactElement {
  return (
    <section className="mt-10 grid gap-3 border border-solid border-border bg-card p-5">
      <h2 className="font-display text-[28px] leading-[1.2]">Child rehearsal</h2>
      <p className="text-[15px] leading-[1.6] text-muted-foreground">
        The provisioned operator opens the existing launch form with the TREST rehearsal. Public visitors stay paired
        with $SDK. Signing still requires the current preflight and an approval of that build. This screen does not
        submit a transaction.
      </p>
      <p className="text-[14px] leading-[1.5]">
        {registered
          ? "This check stored the TREST registration. The launch form reads that registration from the database."
          : "Register TREST before the launch form can bind it. An earlier registration remains in the database."}
      </p>
    </section>
  );
}
