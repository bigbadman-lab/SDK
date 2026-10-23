import { LibraryActions } from "@/components/library/sdk-actions";
import { RemixButton, RemixNotice, RemixProvider } from "@/components/library/remix-sdk";
import { Footer } from "@/components/footer";
import { isPublicId, operationLabel, operationLabels } from "@/lib/library/library";
import { officialInputGuide } from "@/lib/library/official";
import { createMetadata } from "@/lib/metadata";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { readPublished } from "@/lib/server/library/service";
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
          <SdkDetail sdk={sdk} />
        )}
      </main>
      <Footer />
    </>
  );
}

function SdkDetail({
  sdk,
}: {
  sdk: Awaited<ReturnType<typeof readPublished>>;
}): ReactNode {
  const families = operationLabels(sdk.capabilities);
  const guide = officialInputGuide(sdk.name);
  const inputs = sdk.inputs.map((field) => {
    const help = guide?.[field.key];
    return help ? { ...field, help: help.help, example: help.example } : field;
  });
  return (
    <RemixProvider sdkId={sdk.id} versionId={sdk.versionId}>
      <header className="mt-6">
        <h1 className="font-display text-[52px] leading-[1.08] tracking-[-1.5px] max-[561px]:text-[36px]">
          {sdk.name}
        </h1>
        <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">{sdk.description}</p>
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.04em] uppercase">
          <span className="text-accent-ink">{sdk.origin === "official" ? "Official" : "Community"}</span>
          <span>By {sdk.originatorLabel}</span>
          <span className="text-muted-foreground">Version {sdk.versionNumber}</span>
          {families.length > 0 ? <span className="text-muted-foreground">{families.join(" · ")}</span> : null}
        </div>
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
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <RemixButton place="top" />
          <a href="#test" className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase hover:text-accent-ink">
            Test this version
          </a>
          <Link
            href={`/launch?library=${sdk.id}&version=${sdk.versionId}`}
            className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase hover:text-accent-ink"
          >
            Prepare a launch
          </Link>
        </div>
        <RemixNotice place="top" />
        <p className="mt-3 max-w-xl text-[13px] leading-[1.55] text-muted-foreground">
          Remix opens a private copy in the Builder. This published SDK stays unchanged.
        </p>
      </header>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Accepts</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-muted-foreground">The fields a run of this version asks for.</p>
        {sdk.inputs.length === 0 ? (
          <p className="mt-4 text-[14px] text-muted-foreground">This SDK does not ask for inputs.</p>
        ) : (
          <ul className="mt-4 border-t border-border">
            {inputs.map((field) => (
              <li key={field.key} className="grid gap-1 border-b border-border py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px]">{field.key}</span>
                  <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
                    {field.type}
                    {field.required ? " · required" : ""}
                    {field.values.length > 0 ? ` · ${field.values.join(", ")}` : ""}
                  </span>
                </div>
                {"help" in field && field.help ? (
                  <p className="max-w-xl text-[14px] leading-[1.55] text-muted-foreground">{field.help}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Runs</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-muted-foreground">The steps, in order.</p>
        <ol className="mt-4 border-t border-border">
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
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Returns</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-muted-foreground">What a finished run gives back.</p>
        <ul className="mt-4 border-t border-border">
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
      </section>

      <details className="mt-8 font-mono text-[10px] text-muted-foreground">
        <summary className="cursor-pointer tracking-[0.04em] uppercase">Blueprint</summary>
        <p className="mt-2 break-all">Version {sdk.contentHash}</p>
        <pre className="mt-2 overflow-auto leading-[1.5] break-words whitespace-pre-wrap text-foreground">
          {JSON.stringify(sdk.blueprint, null, 2)}
        </pre>
      </details>

      <section className="mt-12 border-t border-border pt-8">
        <LibraryActions sdkId={sdk.id} versionId={sdk.versionId} inputs={inputs} />
      </section>

      <section className="mt-14 border-t border-border pt-8">
        <h2 className="text-[28px] leading-none tracking-[-0.4px]">Remix this SDK</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-muted-foreground">
          Remix opens a private unsaved copy in the Builder. The published SDK stays unchanged, and the copy is not listed until a later review. Preparation of a launch does not mint a token.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <RemixButton place="bottom" />
          <Link
            href={`/launch?library=${sdk.id}&version=${sdk.versionId}`}
            className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase hover:text-accent-ink"
          >
            Prepare a launch
          </Link>
        </div>
        <RemixNotice place="bottom" />
      </section>
    </RemixProvider>
  );
}
