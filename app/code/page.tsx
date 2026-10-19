import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { createMetadata } from "@/lib/metadata";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Code",
  description: "Call any published SDK with one API key and the universal client. The package is not on NPM.",
  path: "/code",
});

export default function CodePage(): ReactNode {
  return (
    <>
      <div className="mx-auto flex min-h-20 w-[min(1100px,_calc(100%_-_48px))] items-center justify-between gap-6 border-b border-b-border py-5 max-[800px]:w-[calc(100%_-_40px)] max-[561px]:w-[calc(100%_-_32px)]">
        <Link href="/" aria-label="SDK home">
          <Logo />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 py-2 font-mono text-[10px] text-muted-foreground hover:text-accent-ink"
        >
          <ArrowLeft size={14} /> BACK TO SDK
        </Link>
      </div>
      <main
        id="main-content"
        className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10 [&_code]:font-mono [&_code]:text-[0.92em] [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-[32px] [&_h2]:leading-[1.2] [&_p]:mt-4 [&_p]:text-[16px] [&_p]:leading-[1.7] [&_p]:text-muted-foreground [&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.6]"
      >
        <span className="block font-mono text-[10px] tracking-[0.04em] text-accent-ink uppercase">Code</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] max-[561px]:text-[38px]">
          One client.
          <br />
          Any published SDK.
        </h1>
        <p>
          <code>sdk-universal-client</code> calls <code>POST /api/v1/sdk/execute</code>. Official and approved community
          SDKs use the same request. The package is in <code>packages/sdk-client</code> and is not published to NPM.
        </p>
        <h2>Install the local package</h2>
        <pre>{`cd packages/sdk-client
npm run build
npm pack`}</pre>
        <p>Install the printed tarball in your own project. Do not install this name from the public registry.</p>
        <h2>Create a key</h2>
        <p>
          Sign in, open Account, and create a key with a label. Copy the secret immediately. The account keeps only a
          masked prefix, the label, and the created and last-used times. Five active keys is the limit. Revoke stops a
          key. Replace revokes it and shows a new secret once.
        </p>
        <h2>Call from a server</h2>
        <pre>{`import { SDKClient } from "sdk-universal-client";

const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: process.env.SDK_BASE_URL ?? "http://127.0.0.1:3000",
});

const result = await client.run({
  sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
  version: 1,
  input: {
    original_prompt: "write a tweet about wallets",
    objective: "Explain one idea to a general reader.",
    audience: "A non-technical reader",
    output_format: "One short paragraph",
  },
});`}</pre>
        <p>
          That id is Prompt Architect, an official SDK. A community SDK uses the id on its Library page after approval.
          Omit <code>version</code> to run the latest published version. Set it to stay on one immutable version.
          {" "}
          <code>result.output</code> is the run output. <code>result.contentHash</code> identifies the Blueprint that
          ran.
        </p>
        <h2>Errors and limits</h2>
        <p>
          Failures throw <code>SDKClientError</code>. Stable codes include <code>invalid_api_key</code>,{" "}
          <code>revoked_api_key</code>, <code>quota_exceeded</code>, <code>sdk_not_found</code>,{" "}
          <code>sdk_unavailable</code>, <code>version_not_found</code>, <code>invalid_input</code>,{" "}
          <code>provider_failure</code>, and <code>timeout</code>. The client does not retry a paid run. Pass{" "}
          <code>signal</code> to cancel.
        </p>
        <p>
          An account gets 100 API executions per UTC day, shared by every key. Builder messages and website tests are
          counted separately. A key cannot publish, edit, or delete an SDK, and it cannot sign a wallet transaction.
          Keep the key in server environment variables.
        </p>
      </main>
      <Footer />
    </>
  );
}
