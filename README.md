# SDK

[SDK](https://sdk.fund) is a place to build working software with AI, publish it, and launch it on Solana.

Describe what you want. The builder turns that into a testable SDK. Publish it to the Library, or launch a token paired with [$SDK](https://sdk.fund). Other people can run a published SDK from the site or from their own program.

## NPM

One package runs every published SDK. There is no separate package for each one.

```bash
npm install sdk-universal-client
```

Create an API key on your [account](https://sdk.fund/account) and keep it in the server environment that runs your program.

```ts
import { SDKClient } from "sdk-universal-client";

const sdk = new SDKClient({
  apiKey: process.env.SDK_API_KEY ?? "",
  baseUrl: "https://sdk.fund",
});

const result = await sdk.run({
  sdkId: "eeed73cd-1971-5212-b882-ee6d0104941e",
  input: {
    original_prompt: "write a tweet about wallets",
    objective: "Explain one idea to a general reader.",
    audience: "A non-technical reader",
    output_format: "One short paragraph",
  },
});

console.log(result.status, result.output);
```

`sdkId` is the public Library id. Leave `version` unset to run the latest published version. The client calls `https://sdk.fund`. It does not contain provider credentials.

The guide is at [sdk.fund/code](https://sdk.fund/code). Package source is in `packages/sdk-client`.
