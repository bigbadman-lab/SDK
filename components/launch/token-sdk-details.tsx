"use client";

import type { PublishedTokenSdk } from "@/lib/launch/verified-launch";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function TokenSdkDetails({
  sdk,
  sdkName,
  baseUrl,
}: {
  sdk: PublishedTokenSdk | null;
  sdkName: string;
  baseUrl: string;
}): ReactNode {
  const [copied, setCopied] = useState<string | null>(null);
  const snippet = sdk ? clientSnippet(sdk, baseUrl) : "";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function copy(value: string) {
    void copyText(value).then((ok) => {
      if (ok) setCopied(value);
    });
  }

  return (
    <>
      <section className="min-w-0">
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">This token&apos;s SDK</p>
        <h2 className="mt-2 text-[24px] leading-none tracking-[-0.4px]">{sdk?.name ?? sdkName}</h2>
        {sdk ? (
          <>
            <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              {sdk.origin === "official" ? "Official" : "Community"} · {sdk.originatorLabel} · Version {sdk.versionNumber}
            </p>
            <p className="mt-3 text-[14px] leading-[1.55] text-muted-foreground">{sdk.description}</p>
            <p className="mt-3 font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              {sdk.inputs.length === 0
                ? "No inputs"
                : `Asks for ${sdk.inputs.map((field) => field.key).join(", ")}`}
            </p>
            <ul className="mt-4 border-y border-border">
              <Access
                label="Library"
                title={sdk.name}
                href={`/library/${sdk.id}`}
                body="Open the Library page to read the full SDK or remix it."
              />
              <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 border-b border-border py-3">
                <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">API</span>
                <div className="min-w-0">
                  <button
                    type="button"
                    className="text-left font-mono text-[12px] break-all hover:text-accent-ink"
                    aria-label={`Copy SDK id ${sdk.id}`}
                    onClick={() => copy(sdk.id)}
                  >
                    {copied === sdk.id ? "Copied" : sdk.id}
                  </button>
                  <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">
                    POST /api/v1/sdk/execute with an Account API key. Version {sdk.versionNumber} is current. Omit version to run the latest.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 py-3">
                <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Client</span>
                <div className="min-w-0">
                  <p className="text-[12px] leading-[1.45] text-muted-foreground">
                    The universal client is in this repository and is not on NPM.{" "}
                    <Link href="/account" className="underline">Create a key</Link>
                    {" · "}
                    <Link href="/code" className="underline">Client guide</Link>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">Run this SDK</p>
                    <button type="button" className="font-mono text-[10px] tracking-[0.04em] uppercase" onClick={() => copy(snippet)}>
                      {copied === snippet ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="mt-2 overflow-x-auto border border-border bg-card p-3 font-mono text-[11px] leading-[1.55]">{snippet}</pre>
                </div>
              </li>
            </ul>
          </>
        ) : (
          <p className="mt-3 text-[14px] leading-[1.55] text-muted-foreground">
            {sdkName} is private to its launcher. It is not in the Library, and an API key cannot run it.
          </p>
        )}
        <p className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</p>
      </section>
      {sdk ? (
        <div className="min-[801px]:col-span-2">
          <TokenSdkTestSlot sdk={sdk} />
        </div>
      ) : null}
    </>
  );
}

function TokenSdkTestSlot({ sdk }: { sdk: PublishedTokenSdk }): ReactNode {
  const [Test, setTest] = useState<((props: { sdk: PublishedTokenSdk }) => ReactNode) | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("@/components/launch/token-sdk-test").then((mod) => {
      if (!cancelled) setTest(() => mod.TokenSdkTest);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return Test ? <Test sdk={sdk} /> : null;
}

function clientSnippet(sdk: PublishedTokenSdk, baseUrl: string): string {
  const fields = sdk.inputs.map((field) => `    ${field.key}: ""`).join(",\n");
  const input = fields.length === 0 ? "  input: {}," : `  input: {\n${fields},\n  },`;
  return `import { SDKClient } from "sdk-universal-client";

const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: ${JSON.stringify(baseUrl)},
});

const result = await client.run({
  sdkId: ${JSON.stringify(sdk.id)},
  version: ${sdk.versionNumber},
${input}
});`;
}

function Access({ label, title, href, body }: { label: string; title: string; href: string; body: string }): ReactNode {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 border-b border-border py-3">
      <span className="pt-0.5 font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">{label}</span>
      <div>
        <Link href={href} className="text-[14px] hover:text-accent-ink">{title}</Link>
        <p className="mt-1 text-[12px] leading-[1.45] text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
