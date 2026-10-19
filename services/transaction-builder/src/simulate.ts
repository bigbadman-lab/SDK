export async function simulateUnsignedTransaction(rpcUrl: string, wireBase64: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          wireBase64,
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "processed",
          },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { result?: { value?: { err?: unknown } } };
    return body.result?.value?.err === null;
  } catch {
    return false;
  }
}
