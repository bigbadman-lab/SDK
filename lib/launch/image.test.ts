import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { checkImage, IMAGE_MAX_BYTES } from "./image.ts";

test("a square png is accepted and a non-square png is rejected", async () => {
  const square = await checkImage(png(64, 64));
  assert.equal(square.ok, true);
  if (square.ok)
    assert.deepEqual(
      { type: square.type, width: square.width, height: square.height },
      {
        type: "image/png",
        width: 64,
        height: 64,
      }
    );
  const wide = await checkImage(png(80, 64));
  assert.equal(wide.ok, false);
  if (!wide.ok) assert.equal(wide.code, "image_square");
});

test("oversized, animated, and unsupported artwork is rejected", async () => {
  const oversized = await checkImage(new Uint8Array(IMAGE_MAX_BYTES + 1));
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.code, "image_large");
  const gif = new Uint8Array(16);
  gif.set(new TextEncoder().encode("GIF89a"), 0);
  const gifCheck = await checkImage(gif);
  assert.equal(gifCheck.ok, false);
  if (!gifCheck.ok) assert.equal(gifCheck.code, "image_type");
  const webp = new Uint8Array(16);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  const rejected = await checkImage(webp);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "image_type");
  const damaged = png(64, 64);
  damaged[damaged.length - 5] = damaged[damaged.length - 5] === 0 ? 1 : 0;
  const broken = await checkImage(damaged);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.code, "image_malformed");
});

test("jpeg dimensions come from the frame and must be square", async () => {
  const wide = await checkImage(jpeg(64, 32));
  assert.equal(wide.ok, false);
  if (!wide.ok) assert.equal(wide.code, "image_square");
  const square = await checkImage(jpeg(64, 64));
  assert.equal(square.ok, true);
  if (square.ok) assert.equal(square.width, 64);
  const cut = jpeg(64, 64).subarray(0, 8);
  const truncated = await checkImage(cut);
  assert.equal(truncated.ok, false);
});

function png(width: number, height: number): Uint8Array {
  const row = 1 + width * 3;
  const raw = new Uint8Array(height * row);
  const compressed = deflateSync(raw);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeU32(data, 0, width);
  writeU32(data, 4, height);
  data[8] = 8;
  data[9] = 2;
  return data;
}

function jpeg(height: number, width: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  const out = new Uint8Array(8 + body.length);
  writeU32(out, 0, data.length);
  out.set(body, 4);
  writeU32(out, 4 + body.length, crc32(body));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
