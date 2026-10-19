import "server-only";

import { requireSupabaseSecret, requireEnv } from "@/lib/server/env";

const BUCKET = "launch-artwork";

export async function uploadArtwork(
  path: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const response = await storageFetch(`/object/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-upsert": "false",
      "cache-control": "private, max-age=0",
    },
    body: bytes,
  });
  if (!response.ok) throw new Error("storage_write");
}

export async function downloadArtwork(
  path: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const response = await storageFetch(`/object/${BUCKET}/${encodePath(path)}`, {
    method: "GET",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("storage_read");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function deleteArtwork(path: string): Promise<void> {
  const response = await storageFetch(`/object/${BUCKET}/${encodePath(path)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404)
    throw new Error("storage_delete");
}

async function storageFetch(
  path: string,
  init: { method: string; headers?: HeadersInit; body?: Uint8Array }
): Promise<Response> {
  const secret = requireSupabaseSecret();
  const base = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${secret}`);
  headers.set("apikey", secret);
  return fetch(`${base}/storage/v1${path}`, {
    method: init.method,
    headers,
    body: init.body ? new Blob([copyBytes(init.body)]) : null,
    signal: AbortSignal.timeout(20_000),
  });
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodePath(path: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/.test(path))
    throw new Error("storage_path");
  return path.split("/").map(encodeURIComponent).join("/");
}
