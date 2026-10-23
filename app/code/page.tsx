import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { createMetadata } from "@/lib/metadata";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Code",
  description: "Integrate working SDKs into your applications through a single execution endpoint and universal client.",
  path: "/code",
});

const REQUEST = `curl -X POST https://sdk.fund/api/v1/sdk/execute \\
  -H "Authorization: Bearer $SDK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sdkId": "eeed73cd-1971-5212-b882-ee6d0104941e",
    "version": 1,
    "input": {
      "original_prompt": "write a tweet about wallets",
      "objective": "Explain one idea to a general reader.",
      "audience": "A non-technical reader",
      "output_format": "One short paragraph"
    }
  }'`;

const CLIENT = `import { SDKClient } from "sdk-universal-client";

const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: process.env.SDK_BASE_URL ?? "https://sdk.fund",
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
});`;

export default function CodePage(): ReactNode {
  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10 [&_code]:font-mono [&_code]:text-[0.92em] [&_h2]:mt-2 [&_h2]:font-display [&_h2]:text-[32px] [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.6px] [&_h2]:text-foreground max-[561px]:[&_h2]:text-[26px] [&_p]:mt-4 [&_p]:text-[16px] [&_p]:leading-[1.7] [&_p]:text-muted-foreground [&_pre]:mt-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.6] [&_pre]:text-foreground"
      >
        <span className="block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Developer integration</span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] text-foreground max-[561px]:text-[38px]">
          One API. Every published SDK.
        </h1>
        <p>
          Integrate working SDKs into your applications through a single execution endpoint and universal client.
        </p>

        <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">01</span>
        <h2>Start with an API key.</h2>
        <p>
          Create a key from your SDK account to authenticate execution requests. Keys belong to the authenticated
          account. Any account can create one. A key can run published SDKs, subject to the account limits below. Keep
          the secret private. It is displayed once, when the key is created.
        </p>
        <div className="mt-6">
          <HomeLink href="/account" tone="primary">Create API Key</HomeLink>
        </div>

        <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">02</span>
        <h2>Find something to build with.</h2>
        <p>
          Browse the Library, choose a published SDK and copy its SDK ID. Each SDK defines its own required inputs and
          returns a structured result.
        </p>
        <div className="mt-6">
          <HomeLink href="/library" tone="secondary">Explore Library</HomeLink>
        </div>

        <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">03</span>
        <h2>Run your first SDK.</h2>
        <p>
          Send <code>POST https://sdk.fund/api/v1/sdk/execute</code> with <code>Authorization: Bearer</code> and your
          key. This example runs Prompt Architect, a published official SDK. <code>version</code> is optional. Omit it
          to run the latest published version, or set it to stay on one immutable version. The placeholder{" "}
          <code>$SDK_API_KEY</code> is not a real secret.
        </p>
        <pre>{REQUEST}</pre>
        <p>
          A successful response includes <code>status</code>, <code>output</code>, <code>sdkId</code>,{" "}
          <code>version</code>, and <code>contentHash</code>. <code>output</code> is that SDK&apos;s structured result.{" "}
          <code>contentHash</code> identifies the blueprint that ran. <code>status</code> is <code>SUCCESS</code>,{" "}
          <code>FAILED</code>, <code>REJECTED</code>, or <code>TIMEOUT</code>. A failed request returns an{" "}
          <code>error.code</code> instead of that result.
        </p>

        <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">04</span>
        <h2>One client. Every SDK.</h2>
        <p>
          The universal SDK client, <code>sdk-universal-client</code>, is a reusable interface for calling published
          SDKs. It is distributed from this repository at version 0.1.0 and is not published to the public NPM
          registry. Build the tarball from <code>packages/sdk-client</code>, then install that file in your project.
        </p>
        <pre>{`cd packages/sdk-client
npm run build
npm pack`}</pre>
        <p>
          Use <code>https://sdk.fund</code> as the production API base URL. For a local development server, set{" "}
          <code>SDK_BASE_URL</code> to <code>http://127.0.0.1:3000</code>.
        </p>
        <pre>{CLIENT}</pre>
        <p>
          <code>result.output</code> is the structured result. <code>result.contentHash</code> identifies the blueprint
          that ran. Failures throw <code>SDKClientError</code> with the same stable <code>code</code> as the HTTP API.
          The client does not retry a run. Pass <code>signal</code> to cancel.
        </p>

        <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">05</span>
        <h2>Built for predictable integration.</h2>
        <ul className="mt-4 grid list-disc gap-2 pl-5 text-[16px] leading-[1.7] text-muted-foreground">
          <li>Up to five active API keys per account.</li>
          <li>Up to 100 API executions per UTC day, shared by every key on the account and subject to the existing admission rules.</li>
          <li>The secret is shown only at creation.</li>
          <li>Keys can execute published SDKs.</li>
          <li>Keys cannot sign transactions, publish SDKs, or move wallet funds.</li>
        </ul>
        <p>Execution is not unlimited, and a request is not guaranteed to complete.</p>
        <h3 className="mt-8 font-mono text-[11px] tracking-[0.06em] text-foreground uppercase">Error reference</h3>
        <dl className="mt-4 grid gap-3 text-[14px] leading-[1.6] text-muted-foreground">
          <ErrorCode code="missing_api_key" detail="Send the API key as Authorization: Bearer." />
          <ErrorCode code="invalid_api_key" detail="The key is missing, malformed, or does not match an account." />
          <ErrorCode code="revoked_api_key" detail="The key was revoked and can no longer run SDKs." />
          <ErrorCode code="sdk_not_found" detail="That SDK ID does not exist." />
          <ErrorCode code="sdk_unavailable" detail="That SDK is not published." />
          <ErrorCode code="version_not_found" detail="That published version does not exist." />
          <ErrorCode code="invalid_input" detail="A required input is missing or does not match the SDK." />
          <ErrorCode code="quota_exceeded" detail="The account has used its 100 API executions for the UTC day." />
          <ErrorCode code="concurrency_limit" detail="The account already has the maximum number of runs in progress." />
          <ErrorCode code="spend_limit" detail="The provider budget for this period has been reached." />
          <ErrorCode code="provider_failure" detail="The provider did not return a usable result." />
          <ErrorCode code="timeout" detail="The run reached its time limit." />
          <ErrorCode code="unavailable" detail="The execution API is unavailable." />
          <ErrorCode code="internal_error" detail="The execution could not be completed." />
        </dl>
      </main>
      <Footer />
    </>
  );
}

function ErrorCode({ code, detail }: { code: string; detail: string }): ReactNode {
  return (
    <div className="grid gap-1 border-t border-border pt-3 min-[561px]:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="font-mono text-[12px] text-foreground">{code}</dt>
      <dd>{detail}</dd>
    </div>
  );
}
