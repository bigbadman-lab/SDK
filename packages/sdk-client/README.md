# sdk-universal-client

One client for every published SDK. It calls `POST https://sdk.fund/api/v1/sdk/execute` with an API key. It does not contain an execution engine, a wallet, or provider credentials.

## Install

```bash
npm install sdk-universal-client
```

```ts
import { SDKClient, SDKClientError } from "sdk-universal-client";
```

## API key

Sign in on the account page and create a key. Copy the secret when it is shown. It is not shown again. Revoke a key to stop it. Replace a key to revoke it and create a new secret in one step. An account can have five active keys.

Put the secret in the server environment that runs your program:

```bash
SDK_API_KEY=sdk_...
SDK_BASE_URL=https://sdk.fund
```

`SDK_BASE_URL` is the origin of the SDK API. The production origin is `https://sdk.fund`. Keep the key in that server environment. Do not put it in a browser bundle, a URL, or a log.

## Run a published SDK

Official and approved community SDKs use the same call. `sdkId` is the public Library id. Omit `version` to run the latest published version. Set `version` to keep an integration on one immutable version. `timeoutMs` is optional and defaults to 70 seconds.

```ts
const client = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: process.env.SDK_BASE_URL ?? "https://sdk.fund",
});
```

### Prompt Architect

```ts
const prompt = await client.run({
  sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
  version: 1,
  input: {
    original_prompt: "write a tweet about wallets",
    objective: "Explain one idea to a general reader.",
    audience: "A non-technical reader",
    output_format: "One short paragraph",
  },
});

console.log(prompt.status, prompt.output);
```

### Wallet DNA

```ts
const dna = await client.run({
  sdkId: "e414c609-c017-55f6-ba74-5354a6a006d3",
  input: {
    wallet: "11111111111111111111111111111111",
  },
});

console.log(dna.status, dna.output);
```

The Wallet DNA example uses the System Program address, the official sample account. For a community SDK, copy its id from the Library after it has been approved. A pending or rejected submission has no public id.

`result.output` is the structured output of that run. `result.version` and `result.contentHash` identify the immutable Blueprint that ran. `result.usage` reports provider requests and tokens for that run. `result.status` is `SUCCESS`, `FAILED`, `REJECTED`, or `TIMEOUT`. A completed HTTP response is returned with that status. It is not thrown.

## Errors

Requests that fail over HTTP throw `SDKClientError`. Show `message` to the developer. `code` is stable, `status` is the HTTP status, and `remaining` is set when the API sends it.

```ts
try {
  const result = await client.run({
    sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
    input: {
      original_prompt: "write a tweet about wallets",
      objective: "Explain one idea to a general reader.",
      audience: "A non-technical reader",
      output_format: "One short paragraph",
    },
  });
  console.log(result.status, result.output);
} catch (error) {
  if (error instanceof SDKClientError) {
    console.error(error.code, error.status, error.message, error.remaining);
  } else {
    throw error;
  }
}
```

- `missing_api_key`
- `invalid_api_key`
- `revoked_api_key`
- `quota_exceeded`
- `concurrency_limit`
- `spend_limit`
- `sdk_not_found`
- `sdk_unavailable`
- `version_not_found`
- `invalid_input`
- `provider_failure`
- `timeout`
- `unavailable`
- `cancelled`
- `internal_error`

`quota_exceeded` includes `remaining: 0`. `cancelled` is raised by this client when the supplied `AbortSignal` aborts. The client does not retry a failed execution.

Pass an `AbortSignal` as `signal` to cancel before the request is sent, or while it is in flight. Cancellation does not retry.

## Limits

Each wallet account has 100 API executions per UTC day, shared by all of its keys. A failed or rejected key does not use that allowance. A run that is admitted counts, including a provider failure or a timeout. Builder messages and website tests use separate allowances. A Blueprint run still has its own time, size, and provider budgets. This client does not promise unlimited throughput.

An API key cannot publish, edit, or delete an SDK.
