import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home/chrome";
import { createMetadata } from "@/lib/metadata";
import type { ReactNode } from "react";

export const metadata = createMetadata({
  title: "Code",
  description:
    "Install sdk-universal-client or call the execution API to run published SDKs with structured inputs.",
  path: "/code",
});

const INSTALL = `npm install sdk-universal-client`;

const ENV = `SDK_API_KEY=your_api_key`;

const CLIENT = `import { SDKClient, SDKClientError } from "sdk-universal-client";

const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY!,
  baseUrl: "https://sdk.fund"
});

try {
  const result = await client.run({
    sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
    version: 1,
    input: {
      original_prompt: "Explain why developers use Solana RPC providers",
      objective: "Write a clear explanation of RPC infrastructure",
      audience: "Developers new to Solana",
      output_format: "Three concise paragraphs"
    }
  });

  console.log(result.output);
} catch (error) {
  if (error instanceof SDKClientError) {
    console.error(error.code, error.message, error.status);
  } else {
    throw error;
  }
}`;

const REQUEST = `curl -X POST https://sdk.fund/api/v1/sdk/execute \\
  -H "Authorization: Bearer $SDK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sdkId": "eeed73cd-1971-5212-b882-ee6d0104941e",
    "version": 1,
    "input": {
      "original_prompt": "Explain why developers use Solana RPC providers",
      "objective": "Write a clear explanation of RPC infrastructure",
      "audience": "Developers new to Solana",
      "output_format": "Three concise paragraphs"
    }
  }'`;

const WALLET_DNA = `const dna = await client.run({
  sdkId: "e414c609-c017-55f6-ba74-5354a6a006d3",
  version: 1,
  input: {
    wallet: "11111111111111111111111111111111"
  }
});

console.log(dna.output);`;

const HTTP_ERROR = `{
  "error": {
    "code": "quota_exceeded",
    "message": "You've reached your API execution limit of 100 for the UTC day. Check your usage in Account.",
    "remaining": 0
  }
}`;

const SECTIONS = [
  ["quickstart", "TypeScript"],
  ["http", "HTTP"],
  ["discovery", "Library"],
  ["wallet-dna", "Wallet DNA"],
  ["responses", "Responses"],
  ["errors", "Errors"],
  ["limits", "Limits"],
  ["package", "npm"],
] as const;

export default function CodePage(): ReactNode {
  return (
    <>
      <main
        id="main-content"
        className="mx-auto w-[min(760px,_calc(100%_-_48px))] scroll-mt-23 pt-16 pb-22 max-[561px]:w-[calc(100%_-_32px)] max-[561px]:pt-10 [&_code]:font-mono [&_code]:text-[0.92em] [&_h2]:mt-2 [&_h2]:font-display [&_h2]:text-[32px] [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.6px] [&_h2]:text-foreground max-[561px]:[&_h2]:text-[26px] [&_p]:mt-4 [&_p]:text-[16px] [&_p]:leading-[1.7] [&_p]:text-muted-foreground [&_pre]:mt-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.6] [&_pre]:text-foreground"
      >
        <span className="block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
          Developer integration
        </span>
        <h1 className="mt-6 font-display text-[56px] leading-[1.14] tracking-[-1.6px] text-foreground max-[561px]:text-[38px]">
          Build with SDK
        </h1>
        <p>
          Install the universal TypeScript client or connect directly through
          the API. Execute published SDKs, pass structured inputs and receive
          real results from one integration.
        </p>
        <nav
          aria-label="On this page"
          className="mt-8 flex flex-wrap gap-x-5 gap-y-2"
        >
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="font-mono text-[11px] tracking-[0.04em] text-accent-ink uppercase hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>

        <section id="quickstart" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            01
          </span>
          <h2>Install the TypeScript client.</h2>
          <p>
            <code>sdk-universal-client</code> is the published client for every
            SDK. Version 0.1.0 calls{" "}
            <code>POST https://sdk.fund/api/v1/sdk/execute</code>.
          </p>
          <pre>
            <code>{INSTALL}</code>
          </pre>
          <p>
            Create a key in{" "}
            <strong className="font-medium text-foreground">
              Account → API Keys
            </strong>
            . The secret is shown once. Put it in the server environment that
            runs your program.
          </p>
          <pre>
            <code>{ENV}</code>
          </pre>
          <p>
            Keep the key on the server. Do not put it in a browser bundle, a
            URL, or a log. The client sends the key with the request. It does
            not hide a key that ships in frontend code.
          </p>
          <p>
            This example runs Prompt Architect. <code>version</code> is
            optional. Omit it to run the latest published version, or set it to
            stay on one immutable version. <code>your_api_key</code> is not a
            real secret.
          </p>
          <pre>
            <code>{CLIENT}</code>
          </pre>
          <p>
            <code>run</code> returns the execution when the HTTP response
            succeeds. A failed HTTP response throws <code>SDKClientError</code>.
            The client does not retry.
          </p>
          <div className="mt-6">
            <HomeLink href="/account" tone="primary">
              Create API Key
            </HomeLink>
          </div>
        </section>

        <section id="http" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            02
          </span>
          <h2>Call the HTTP API.</h2>
          <p>
            The same Prompt Architect run can be sent without the client. Use{" "}
            <code>POST https://sdk.fund/api/v1/sdk/execute</code>,{" "}
            <code>Authorization: Bearer</code>, and a JSON body with{" "}
            <code>sdkId</code>, optional <code>version</code>, and{" "}
            <code>input</code>. <code>$SDK_API_KEY</code> is not a real secret.
          </p>
          <pre>
            <code>{REQUEST}</code>
          </pre>
        </section>

        <section id="discovery" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            03
          </span>
          <h2>Choose a published SDK.</h2>
          <p>
            One package runs every published SDK. There is no separate npm
            package for each SDK.
          </p>
          <ol className="mt-4 grid list-decimal gap-2 pl-5 text-[16px] leading-[1.7] text-muted-foreground">
            <li>Browse the Library.</li>
            <li>Open a published SDK.</li>
            <li>Inspect its required input fields.</li>
            <li>Copy its SDK ID.</li>
            <li>
              Execute it with <code>client.run</code> or the REST endpoint.
            </li>
          </ol>
          <p>
            A pending or rejected submission has no public id.{" "}
            <code>input</code> has to match that SDK&apos;s fields.
          </p>
          <div className="mt-6">
            <HomeLink href="/library" tone="secondary">
              Explore Library
            </HomeLink>
          </div>
        </section>

        <section id="wallet-dna" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            04
          </span>
          <h2>Run Wallet DNA.</h2>
          <p>
            Wallet DNA reads an address through Helius, then separates those
            on-chain facts from a creative persona. Use the same{" "}
            <code>client.run</code> method. The address below is the Solana
            System Program, a public account. It is not a private key or a
            personal wallet.
          </p>
          <pre>
            <code>{WALLET_DNA}</code>
          </pre>
          <p>
            <code>output</code> includes <code>balances</code>,{" "}
            <code>activity</code>, and <code>report</code>.{" "}
            <code>balances</code> and <code>activity</code> include{" "}
            <code>coverage</code>. When <code>coverage.truncated</code> is true,
            the signature or token-account sample is partial. This is a recent
            sample, not a full wallet history, and it is not a profitability
            analysis.
          </p>
        </section>

        <section id="responses" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            05
          </span>
          <h2>Read the response.</h2>
          <p>
            An HTTP 200 body is the execution record. <code>status</code> inside
            that record can still be <code>FAILED</code>, <code>REJECTED</code>,
            or <code>TIMEOUT</code>. The TypeScript client returns that record.
            It throws only when the HTTP response is an error.
          </p>
          <dl className="mt-4 grid gap-3 text-[14px] leading-[1.6] text-muted-foreground">
            <Field name="executionId" detail="Identifier for this run." />
            <Field name="sdkId" detail="Published SDK that ran." />
            <Field name="version" detail="Immutable version number that ran." />
            <Field
              name="contentHash"
              detail="Hash of the blueprint that ran."
            />
            <Field
              name="status"
              detail="SUCCESS, FAILED, REJECTED, or TIMEOUT."
            />
            <Field
              name="output"
              detail="That SDK's structured result, or null."
            />
            <Field
              name="usage"
              detail="openaiRequests, heliusRequests, inputTokens, and outputTokens for the run."
            />
            <Field name="durationMs" detail="Elapsed time for the run." />
            <Field
              name="startedAt"
              detail="ISO timestamp when the run started."
            />
            <Field
              name="finishedAt"
              detail="ISO timestamp when the run finished, or null."
            />
          </dl>
        </section>

        <section id="errors" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            06
          </span>
          <h2>Handle errors.</h2>
          <p>
            A failed HTTP response has an <code>error</code> object.{" "}
            <code>code</code> is stable. <code>message</code> is the text to
            show. <code>remaining</code> is included when the API sends it. The
            client throws <code>SDKClientError</code> with those fields and the
            HTTP status. It does not retry. Pass <code>signal</code> to cancel a
            run.
          </p>
          <pre>
            <code>{HTTP_ERROR}</code>
          </pre>
          <dl className="mt-4 grid gap-3 text-[14px] leading-[1.6] text-muted-foreground">
            <ErrorCode
              code="missing_api_key"
              status={401}
              detail="Add your SDK API key to the Authorization header to continue."
            />
            <ErrorCode
              code="invalid_api_key"
              status={401}
              detail="We couldn't verify this API key. Check your key in Account → API Keys."
            />
            <ErrorCode
              code="revoked_api_key"
              status={401}
              detail="This API key has been revoked. Create a new key in Account → API Keys."
            />
            <ErrorCode
              code="invalid_input"
              status={400}
              detail="The message depends on the failure. Unreadable JSON: We couldn't read the request body. Check that you're sending valid JSON. A body that is too large: The request body is larger than the API accepts. A missing SDK ID or invalid version: Send a valid SDK ID. If you include a version, use a whole number of 1 or greater. Inputs that do not match the SDK: This input doesn't match the SDK's requirements. Check the required fields in the Library."
            />
            <ErrorCode
              code="sdk_not_found"
              status={404}
              detail="We couldn't find this SDK. Check the SDK ID and try again."
            />
            <ErrorCode
              code="sdk_unavailable"
              status={404}
              detail="This SDK isn't available for execution. Check its status in the Library."
            />
            <ErrorCode
              code="version_not_found"
              status={404}
              detail="This SDK version isn't available. Check the published versions in the Library."
            />
            <ErrorCode
              code="quota_exceeded"
              status={429}
              detail="You've reached your API execution limit of 100 for the UTC day. Check your usage in Account. The response includes remaining: 0."
            />
            <ErrorCode
              code="concurrency_limit"
              status={429}
              detail="You have too many executions running. Try again when one finishes."
            />
            <ErrorCode
              code="spend_limit"
              status={429}
              detail="Execution is temporarily unavailable because a spending limit has been reached."
            />
            <ErrorCode
              code="provider_failure"
              status={502}
              detail="This SDK couldn't complete its provider request. Please try again later."
            />
            <ErrorCode
              code="timeout"
              status={504}
              detail="This SDK took too long to respond. Please try again."
            />
            <ErrorCode
              code="unavailable"
              status={503}
              detail="SDK execution is temporarily unavailable. Please try again later."
            />
            <ErrorCode
              code="internal_error"
              status={500}
              detail="We couldn't complete this execution. Please try again."
            />
          </dl>
        </section>

        <section id="limits" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            07
          </span>
          <h2>Stay within the account limits.</h2>
          <ul className="mt-4 grid list-disc gap-2 pl-5 text-[16px] leading-[1.7] text-muted-foreground">
            <li>
              100 API executions per account per UTC day, shared by every key on
              the account.
            </li>
            <li>
              Two executions in flight per account. A third is refused until one
              finishes.
            </li>
            <li>Up to five active API keys per account.</li>
            <li>The secret is shown only at creation.</li>
            <li>Keys can execute published SDKs.</li>
            <li>
              Keys cannot sign transactions, publish SDKs, or move wallet funds.
            </li>
          </ul>
          <p>
            Store the API key on the server. Installing{" "}
            <code>sdk-universal-client</code> in a browser bundle does not keep
            the key private. Execution is not unlimited, and a request is not
            guaranteed to complete.
          </p>
        </section>

        <section id="package" className="scroll-mt-23">
          <span className="mt-14 block font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
            08
          </span>
          <h2>Use the published package.</h2>
          <p>
            Install <code>sdk-universal-client</code> from the npm registry. The
            package page is{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4"
              href="https://www.npmjs.com/package/sdk-universal-client"
            >
              sdk-universal-client
            </a>
            .
          </p>
          <pre>
            <code>{INSTALL}</code>
          </pre>
          <p>
            Source for the client is also in the{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4"
              href="https://github.com/bigbadman-lab/SDK"
            >
              SDK repository
            </a>
            . The registry package is the install path.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Field({ name, detail }: { name: string; detail: string }): ReactNode {
  return (
    <div className="grid gap-1 border-t border-border pt-3 min-[561px]:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="font-mono text-[12px] text-foreground">{name}</dt>
      <dd>{detail}</dd>
    </div>
  );
}

function ErrorCode({
  code,
  status,
  detail,
}: {
  code: string;
  status: number;
  detail: string;
}): ReactNode {
  return (
    <div className="grid gap-1 border-t border-border pt-3 min-[561px]:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="font-mono text-[12px] text-foreground">
        {code}
        <span className="mt-1 block text-muted-foreground">{status}</span>
      </dt>
      <dd>{detail}</dd>
    </div>
  );
}
