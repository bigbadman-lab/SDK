import { ReviewActions } from "@/components/library/review-actions";
import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet/wallet-button";
import { operationLabels, publicInputs, publicOutputs } from "@/lib/library/library";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { createMetadata } from "@/lib/metadata";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSession } from "@/lib/server/auth";
import { listPendingSubmissions } from "@/lib/server/library/service";
import { isProvisionedOperator } from "@/lib/server/operator";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...createMetadata({
    title: "Library review",
    description: "Operator review for community SDK submissions.",
    path: "/admin/library",
  }),
  robots: { index: false, follow: false },
};

export default async function LibraryReviewPage(): Promise<ReactNode> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  const account = session.state === "active" ? session.account : null;
  if (account && !isProvisionedOperator(account.walletAddress)) notFound();

  const pending = account ? await listPendingSubmissions().catch(() => null) : null;

  return (
    <>
      <div className="mx-auto flex min-h-20 w-[min(1100px,_calc(100%_-_48px))] items-center justify-between gap-6 border-b border-b-border py-5 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]">
        <Link href="/" aria-label="SDK home">
          <Logo />
        </Link>
        <WalletButton />
      </div>
      <main
        id="main-content"
        className="mx-auto w-[min(860px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Operator</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          Library review
        </h1>
        {!account ? (
          <p className="mt-8 max-w-130 text-[17px] leading-[1.7] text-muted-foreground">
            Sign in with the provisioned operator wallet to review community submissions.
          </p>
        ) : pending === null ? (
          <p className="mt-8 text-[15px] leading-[1.7] text-muted-foreground">
            Library submission is unavailable until its table exists.
          </p>
        ) : pending.length === 0 ? (
          <p className="mt-8 text-[15px] leading-[1.7] text-muted-foreground">
            No submissions are waiting for review.
          </p>
        ) : (
          <ul className="mt-8 grid gap-6">
            {pending.map((submission) => {
              const validated = validateBlueprint(submission.blueprint);
              const blueprint = validated.ok ? validated.blueprint : null;
              return (
                <li key={submission.id} className="grid gap-4 border border-solid border-border bg-card p-6">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="font-display text-[28px] leading-[1.2]">{submission.name}</h2>
                    <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                      {formatStamp(submission.createdAt)}
                    </span>
                  </div>
                  <p className="text-[15px] leading-[1.6] text-muted-foreground">{submission.description}</p>
                  <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
                    Originating developer · {submission.originatorLabel}
                  </p>
                  <p className="font-mono text-[10px] break-all text-muted-foreground uppercase">
                    Submitted by {submission.submitterWallet}
                  </p>
                  <p className="font-mono text-[10px] break-all text-muted-foreground">
                    Content hash {submission.contentHash}
                  </p>
                  {submission.sourceSdkId ? (
                    <p className="font-mono text-[10px] break-all text-muted-foreground">
                      Remixed from {submission.sourceSdkId} · version {submission.sourceVersionId}
                    </p>
                  ) : (
                    <p className="font-mono text-[10px] text-muted-foreground">Original SDK</p>
                  )}
                  <p className="font-mono text-[10px] text-muted-foreground uppercase">
                    {submission.executionId
                      ? `Successful test ${submission.executionId} · ${formatStamp(submission.executionFinishedAt)}`
                      : "No successful test is recorded for this revision."}
                  </p>
                  {blueprint ? (
                    <>
                      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
                        {operationLabels(blueprint.capabilities).join(" · ") || "No operations"}
                      </p>
                      <div>
                        <h3 className="font-mono text-[10px] tracking-[0.04em] uppercase">Inputs</h3>
                        <ul className="mt-2 grid gap-1">
                          {publicInputs(blueprint).map((field) => (
                            <li key={field.key} className="font-mono text-[12px] text-muted-foreground">
                              {field.key} · {field.type}
                              {field.required ? " · required" : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="font-mono text-[10px] tracking-[0.04em] uppercase">Outputs</h3>
                        <ul className="mt-2 grid gap-1">
                          {publicOutputs(blueprint).map((field) => (
                            <li key={field.key} className="font-mono text-[12px] text-muted-foreground">
                              {field.key} · {field.type}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="font-mono text-[10px] tracking-[0.04em] uppercase">Operations</h3>
                        <ol className="mt-2 grid gap-1">
                          {blueprint.steps.map((step, index) => (
                            <li key={step.id} className="font-mono text-[12px] text-muted-foreground">
                              {index + 1}. {step.id} · {step.op}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </>
                  ) : (
                    <p className="text-[14px] text-muted-foreground">This snapshot does not pass validation.</p>
                  )}
                  <ReviewActions submissionId={submission.id} />
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}

function formatStamp(value: string | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
