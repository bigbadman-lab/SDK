import { LibraryActions } from "@/components/library/sdk-actions";
import { RemixButton, RemixNotice, RemixProvider } from "@/components/library/remix-sdk";
import { SdkVote } from "@/components/library/sdk-vote";
import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { isPublicId, operationLabel, operationLabels } from "@/lib/library/library";
import { officialInputGuide } from "@/lib/library/official";
import { createMetadata } from "@/lib/metadata";
import { getCurrentAccount } from "@/lib/server/account";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { readPublished } from "@/lib/server/library/service";
import { readLibraryVote, type LibraryVote } from "@/lib/server/library/votes";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sdkId: string }>;
}): Promise<Metadata> {
  const { sdkId } = await params;
  if (!isPublicId(sdkId))
    return createMetadata({ title: "Library", path: "/library" });
  try {
    const sdk = await readPublished(sdkId);
    return createMetadata({
      title: sdk.name,
      description: sdk.description,
      path: `/library/${sdk.id}`,
    });
  } catch {
    return createMetadata({ title: "Library", path: "/library" });
  }
}

export default async function LibrarySdkPage({
  params,
  searchParams,
}: {
  params: Promise<{ sdkId: string }>;
  searchParams: Promise<{ version?: string }>;
}): Promise<ReactNode> {
  const { sdkId } = await params;
  const query = await searchParams;
  if (!isPublicId(sdkId)) notFound();
  let sdk: Awaited<ReturnType<typeof readPublished>> | null = null;
  let unavailable = false;
  try {
    sdk = await readPublished(sdkId, query.version ?? null);
  } catch (error) {
    const described = describeBlueprintError(error);
    if (described.code === "library_not_found") notFound();
    unavailable = described.status === 503;
  }
  const account = sdk ? await getCurrentAccount() : null;
  let vote: LibraryVote | null = null;
  if (sdk) {
    try {
      vote = await readLibraryVote(sdk.id, account?.id ?? null);
    } catch {
      vote = null;
    }
  }
  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(900px,calc(100%-48px))] scroll-mt-23 pt-16 pb-22 max-[800px]:w-[calc(100%-40px)] max-[561px]:w-[calc(100%-32px)] max-[561px]:pt-10"
      >
        <Link
          href="/library"
          className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase"
        >
          Library
        </Link>
        {unavailable || !sdk ? (
          <h1 className="mt-6 font-display text-[48px] leading-[1.1] tracking-[-1.4px] max-[561px]:text-[34px]">
            This SDK is unavailable.
          </h1>
        ) : (
          <SdkDetail sdk={sdk} vote={vote} signedIn={account !== null} />
        )}
      </main>
      <Footer />
    </>
  );
}

function SdkDetail({
  sdk,
  vote,
  signedIn,
}: {
  sdk: Awaited<ReturnType<typeof readPublished>>;
  vote: LibraryVote | null;
  signedIn: boolean;
}): ReactNode {
  const families = operationLabels(sdk.capabilities);
  const guide = officialInputGuide(sdk.name);
  const inputs = sdk.inputs.map((field) => {
    const help = guide?.[field.key];
    return help ? { ...field, help: help.help, example: help.example } : field;
  });
  const launchHref = `/launch?library=${sdk.id}&version=${sdk.versionId}`;
  return (
    <RemixProvider sdkId={sdk.id} versionId={sdk.versionId}>
      <header className="mt-6">
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
          {sdk.origin === "official" ? "Official" : "Community"}
          <span className="text-muted-foreground"> · {sdk.originatorLabel}</span>
        </p>
        <h1 className="mt-4 font-display text-[52px] leading-[1.08] tracking-[-1.5px] break-words max-[561px]:text-[36px]">
          {sdk.name}
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">{sdk.description}</p>
        <p className="mt-4 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          Version {sdk.versionNumber}
        </p>
        {sdk.versions.length > 1 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {sdk.versions.map((version) => (
              <li key={version.id}>
                <Link
                  href={version.id === sdk.versionId ? `/library/${sdk.id}` : `/library/${sdk.id}?version=${version.id}`}
                  className={
                    "rounded-lg border border-solid px-2.5 py-1.5 font-mono text-[10px] uppercase " +
                    (version.id === sdk.versionId ? "border-accent text-accent-ink" : "border-border text-muted-foreground")
                  }
                >
                  Version {version.versionNumber}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <HomeLink href="#test" tone="primary">
            Test SDK
          </HomeLink>
          <RemixButton place="top" />
          <HomeLink href={launchHref} tone="secondary">
            Launch a Token
          </HomeLink>
          {vote ? (
            <SdkVote sdkId={sdk.id} count={vote.count} voted={vote.voted} signedIn={signedIn} />
          ) : null}
        </div>
        <RemixNotice place="top" />
      </header>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">What it does</h2>
        <p className="mt-4 max-w-150 text-[16px] leading-[1.7] text-muted-foreground">{sdk.description}</p>
        {families.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-2">
            {families.map((family) => (
              <li
                key={family}
                className="rounded-lg border border-solid border-border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase"
              >
                {family}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <LibraryActions sdkId={sdk.id} versionId={sdk.versionId} inputs={inputs} />
      </section>

      <section id="remix" className="mt-14 scroll-mt-23 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Remix this SDK</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-muted-foreground">
          Open an editable version in the AI Builder and make it your own.
        </p>
        <div className="mt-5">
          <RemixButton place="bottom" />
        </div>
        <RemixNotice place="bottom" />
      </section>

      <section className="mt-14 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Developer details</h2>
        <p className="mt-3 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
          Version {sdk.versionNumber}
        </p>
        <h3 className="mt-8 text-[18px] tracking-[-0.2px]">Inputs</h3>
        {sdk.inputs.length === 0 ? (
          <p className="mt-3 text-[14px] text-muted-foreground">This SDK does not ask for inputs.</p>
        ) : (
          <ul className="mt-3 border-t border-border">
            {inputs.map((field) => (
              <li key={field.key} className="grid gap-1 border-b border-border py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px]">{"help" in field && field.help ? field.help : field.key}</span>
                  <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                    {field.type}
                    {field.required ? " · required" : ""}
                    {field.values.length > 0 ? ` · ${field.values.join(", ")}` : ""}
                  </span>
                </div>
                {"help" in field && field.help ? (
                  <p className="font-mono text-[11px] break-all text-muted-foreground">{field.key}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-8 text-[18px] tracking-[-0.2px]">Outputs</h3>
        <ul className="mt-3 border-t border-border">
          {sdk.outputs.map((output) => (
            <li key={output.key} className="grid gap-1 border-b border-border py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px]">{output.key}</span>
                <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{output.type}</span>
              </div>
              <p className="font-mono text-[11px] break-all text-muted-foreground">{output.from}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-8 text-[18px] tracking-[-0.2px]">Operations</h3>
        <ol className="mt-3 border-t border-border">
          {sdk.steps.map((step, index) => (
            <li key={step.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-border py-3">
              <span className="pt-1 font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="text-[15px]">{step.id}</p>
                <p className="mt-1 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{operationLabel(step.op)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Content hash</p>
        <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">{sdk.contentHash}</p>
        <details className="mt-6 font-mono text-[10px] text-muted-foreground">
          <summary className="cursor-pointer tracking-[0.04em] uppercase">Blueprint</summary>
          <pre className="mt-2 overflow-auto leading-[1.5] break-words whitespace-pre-wrap text-foreground">
            {JSON.stringify(sdk.blueprint, null, 2)}
          </pre>
        </details>
      </section>
    </RemixProvider>
  );
}
