import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { requireApiKeyPepper } from "@/lib/server/env";

export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `sdk_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 12), hash: digestApiKey(secret) };
}

export function digestApiKey(secret: string): string {
  return createHmac("sha256", requireApiKeyPepper()).update(secret).digest("hex");
}
