import "server-only";

import { ipfsGatewayUri } from "@/lib/launch/prepare";
import { requirePinata } from "@/lib/server/env";

export async function pinArtwork(
  bytes: Uint8Array,
  contentType: "image/png" | "image/jpeg"
): Promise<string> {
  const { jwt, gatewayDomain } = requirePinata();
  const form = new FormData();
  const name = contentType === "image/png" ? "artwork.png" : "artwork.jpg";
  form.append(
    "file",
    new File([new Uint8Array(bytes)], name, { type: contentType })
  );
  const response = await fetch(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    }
  );
  return readCid(response, gatewayDomain);
}

export async function pinMetadata(json: string): Promise<string> {
  const { jwt, gatewayDomain } = requirePinata();
  const form = new FormData();
  form.append(
    "file",
    new File([json], "metadata.json", { type: "application/json" })
  );
  const response = await fetch(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    }
  );
  return readCid(response, gatewayDomain);
}

async function readCid(
  response: Response,
  gatewayDomain: string
): Promise<string> {
  if (!response.ok) throw new Error("pin_failed");
  const body = (await response.json()) as { IpfsHash?: unknown };
  if (typeof body.IpfsHash !== "string") throw new Error("pin_failed");
  const uri = ipfsGatewayUri(gatewayDomain, body.IpfsHash);
  if (!uri) throw new Error("uri_too_long");
  return uri;
}
