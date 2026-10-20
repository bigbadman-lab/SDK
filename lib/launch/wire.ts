import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function sealWire(
  wire: Uint8Array,
  key: Uint8Array | null,
): { ok: true; retained: false } | { ok: true; retained: true; ciphertext: string } | { ok: false; code: "key" } {
  if (!key) return { ok: true, retained: false };
  if (key.byteLength !== 32) return { ok: false, code: "key" };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(wire), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ok: true,
    retained: true,
    ciphertext: Buffer.concat([nonce, tag, body]).toString("base64"),
  };
}

export function openWire(
  ciphertext: string,
  key: Uint8Array | null,
): { ok: true; wire: Uint8Array } | { ok: false; code: "key" | "wire_absent" } {
  if (!key || key.byteLength !== 32) return { ok: false, code: "key" };
  try {
    const packed = Buffer.from(ciphertext, "base64");
    if (packed.byteLength < 12 + 16 + 1) return { ok: false, code: "wire_absent" };
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const body = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return { ok: true, wire: new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()])) };
  } catch {
    return { ok: false, code: "wire_absent" };
  }
}
