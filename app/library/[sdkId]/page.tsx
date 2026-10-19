import { LibraryActions } from "@/components/library/sdk-actions";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { isPublicId, operationLabels } from "@/lib/library/library";
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
      <Nav />
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
    <>
      <h1 className="mt-6 font-display text-[52px] leading-[1.08] tracking-[-1.5px] max-[561px]:text-[36px]">
        {sdk.name}
      </h1>
      <p className="mt-5 max-w-150 text-[17px] leading-[1.7] text-muted-foreground">
        {sdk.description}
      </p>
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.04em] uppercase">
        <span className="text-accent-ink">
          {sdk.origin === "official" ? "Official" : "Community"}
        </span>
        <span>By {sdk.originatorLabel}</span>
        <span className="text-muted-foreground">
          Published · Version {sdk.versionNumber}
        </span>
      </div>
      {families.length > 0 ? (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground uppercase">
          {families.join(" · ")}
        </p>
      ) : null}
      <p className="mt-4 font-mono text-[10px] break-all text-muted-foreground">
        Version {sdk.contentHash}
      </p>
      {sdk.versions.length > 1 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {sdk.versions.map((version) => (
            <li key={version.id}>
              <Link
                href={
                  version.id === sdk.versionId
                    ? `/library/${sdk.id}`
                    : `/library/${sdk.id}?version=${version.id}`
                }
                className={
                  "rounded-lg border border-solid px-2.5 py-1.5 font-mono text-[10px] uppercase " +
                  (version.id === sdk.versionId
                    ? "border-accent text-accent-ink"
                    : "border-border text-muted-foreground")
                }
              >
                Version {version.versionNumber}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <section className="mt-8 grid gap-2">
        <h2 className="text-[20px]">What it accepts</h2>
        {sdk.inputs.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            This SDK does not ask for inputs.
          </p>
        ) : (
          inputs.map((field) => (
            <div key={field.key} className="grid gap-1">
              <p className="font-mono text-[10px] text-muted-foreground uppercase">
                {field.key} · {field.type}
                {field.required ? " · required" : ""}
                {field.values.length > 0 ? ` · ${field.values.join(", ")}` : ""}
              </p>
              {"help" in field && field.help ? (
                <p className="text-[14px] leading-[1.6] text-muted-foreground">
                  {field.help}
                </p>
              ) : null}
            </div>
          ))
        )}
        <h2 className="mt-4 text-[20px]">What it runs</h2>
        {sdk.steps.map((step, index) => (
          <p
            key={step.id}
            className="font-mono text-[10px] text-muted-foreground uppercase"
          >
            {index + 1}. {step.id} · {step.op}
          </p>
        ))}
        <h2 className="mt-4 text-[20px]">What it returns</h2>
        {sdk.outputs.map((output) => (
          <p
            key={output.key}
            className="font-mono text-[10px] text-muted-foreground uppercase"
          >
            {output.key} · {output.type} · {output.from}
          </p>
        ))}
      </section>
      <details className="mt-6 font-mono text-[10px] text-muted-foreground">
        <summary className="cursor-pointer uppercase">Blueprint JSON</summary>
        <pre className="mt-2 overflow-auto leading-[1.5] break-words whitespace-pre-wrap text-foreground">
          {JSON.stringify(sdk.blueprint, null, 2)}
        </pre>
      </details>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href={`/launch?library=${sdk.id}&version=${sdk.versionId}`}
          className="rounded-lg border border-solid border-border px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Prepare a launch
        </Link>
        <p className="text-[13px] text-muted-foreground">
          Preparation does not mint a token.
        </p>
      </div>
      <div className="mt-8">
        <LibraryActions
          sdkId={sdk.id}
          versionId={sdk.versionId}
          inputs={inputs}
        />
      </div>
    </>
  );
}
