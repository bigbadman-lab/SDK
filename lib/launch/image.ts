// Token artwork checks shared by the browser and the server.
// Identification uses the file signature. MIME headers are not evidence.
// Nothing here crops, resizes, or re-encodes the image.

export const IMAGE_MAX_BYTES = 5_000_000;
export const IMAGE_MIN_SIDE = 64;
export const IMAGE_MAX_SIDE = 4096;
export const JPEG_MAX_SIDE = 2048;

export type ImageType = "image/png" | "image/jpeg";

export type ImageCheck =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; code: ImageCode; error: string };

export type ImageCode =
  | "image_large"
  | "image_type"
  | "image_square"
  | "image_small"
  | "image_dimensions"
  | "image_malformed";

const fail = (code: ImageCode, error: string): ImageCheck => ({
  ok: false,
  code,
  error,
});

export async function checkImage(bytes: Uint8Array): Promise<ImageCheck> {
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return fail("image_large", "Artwork must be 5 MB or smaller.");
  }
  if (bytes.byteLength < 16) {
    return fail("image_malformed", "This file is not a complete PNG or JPEG.");
  }
  const kind = sniff(bytes);
  if (kind === "image/webp")
    return fail("image_type", "WebP artwork is not accepted. Use PNG or JPEG.");
  if (kind === "image/gif")
    return fail(
      "image_type",
      "Animated and GIF artwork is not accepted. Use PNG or JPEG."
    );
  if (kind === "image/png") return checkPng(bytes);
  if (kind === "image/jpeg") return checkJpeg(bytes);
  return fail("image_type", "Use a PNG or JPEG file.");
}

function sniff(
  bytes: Uint8Array
): ImageType | "image/webp" | "image/gif" | null {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
    return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  return null;
}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

async function checkPng(bytes: Uint8Array): Promise<ImageCheck> {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bits = 0;
  let sawData = false;
  let ended = false;
  const chunks: Uint8Array[] = [];
  let chunkBytes = 0;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength)
      return fail("image_malformed", "The PNG file is cut off.");
    const length = u32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (offset + 12 + length > bytes.byteLength)
      return fail("image_malformed", "The PNG file is cut off.");
    if (
      crc32(bytes, offset + 4, offset + 8 + length) !==
      u32(bytes, offset + 8 + length)
    ) {
      return fail("image_malformed", "The PNG file is damaged.");
    }
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13)
        return fail("image_malformed", "The PNG file is damaged.");
      width = u32(bytes, offset + 8);
      height = u32(bytes, offset + 12);
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const interlace = bytes[offset + 20];
      if (
        depth === undefined ||
        color === undefined ||
        interlace === undefined
      ) {
        return fail("image_malformed", "The PNG file is damaged.");
      }
      if (
        !PNG_DEPTHS[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0
      ) {
        return fail("image_malformed", "The PNG file is damaged.");
      }
      if (interlace !== 0)
        return fail("image_type", "Interlaced PNG artwork is not accepted.");
      const channels = PNG_CHANNELS[color];
      if (!channels) return fail("image_malformed", "The PNG file is damaged.");
      bits = depth * channels;
      const sized = square(width, height, IMAGE_MAX_SIDE);
      if (!sized.ok) return sized;
    } else if (type === "IHDR") {
      return fail("image_malformed", "The PNG file is damaged.");
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      return fail("image_type", "Animated PNG artwork is not accepted.");
    }
    if (type === "IDAT") {
      sawData = true;
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      chunkBytes += length;
    }
    offset += 12 + length;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.byteLength)
    return fail(
      "image_malformed",
      "The PNG file is cut off or has extra data."
    );
  if (!sawData)
    return fail("image_malformed", "The PNG file has no image data.");
  const row = 1 + Math.ceil((width * bits) / 8);
  const expected = height * row;
  if (expected <= 0 || expected > 70_000_000) {
    return fail(
      "image_dimensions",
      "This PNG is too large to validate safely."
    );
  }
  const packed = new Uint8Array(chunkBytes);
  let cursor = 0;
  for (const chunk of chunks) {
    packed.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  if (!(await inflateExact(packed, expected))) {
    return fail("image_malformed", "The PNG image data is damaged.");
  }
  return { ok: true, type: "image/png", width, height };
}

async function inflateExact(
  data: Uint8Array,
  expected: number
): Promise<boolean> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer
    .write(data as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
    }
  } catch {
    return false;
  }
  return total === expected;
}

function checkJpeg(bytes: Uint8Array): ImageCheck {
  if (
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    return fail("image_malformed", "The JPEG file is cut off.");
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let frames = 0;
  let scanned = false;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff)
      return fail("image_malformed", "The JPEG file is damaged.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined)
      return fail("image_malformed", "The JPEG file is cut off.");
    if (marker === 0xd9) {
      if (offset !== bytes.byteLength)
        return fail("image_malformed", "The JPEG file has extra data.");
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength)
      return fail("image_malformed", "The JPEG file is cut off.");
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength)
      return fail("image_malformed", "The JPEG file is cut off.");
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8)
        return fail("image_malformed", "The JPEG file is damaged.");
      height = u16(bytes, offset + 3);
      width = u16(bytes, offset + 5);
      frames += 1;
    }
    offset += length;
    if (marker === 0xda) {
      scanned = true;
      const end = findJpegEnd(bytes, offset);
      if (end === null)
        return fail("image_malformed", "The JPEG file is cut off.");
      if (end !== bytes.byteLength)
        return fail("image_malformed", "The JPEG file has extra data.");
      break;
    }
  }
  if (frames !== 1 || !scanned)
    return fail("image_malformed", "The JPEG file is damaged.");
  const sized = square(width, height, JPEG_MAX_SIDE);
  if (!sized.ok) return sized;
  return { ok: true, type: "image/jpeg", width, height };
}

function findJpegEnd(bytes: Uint8Array, offset: number): number | null {
  for (let index = offset; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] !== 0xff) continue;
    const next = bytes[index + 1];
    if (next === 0x00) {
      index += 1;
      continue;
    }
    if (next === 0xd9) return index + 2;
    if (next !== undefined && next >= 0xd0 && next <= 0xd7) {
      index += 1;
      continue;
    }
    return null;
  }
  return null;
}

function square(
  width: number,
  height: number,
  max: number
): ImageCheck | { ok: true } {
  if (!width || !height)
    return fail("image_malformed", "The image has no size.");
  if (width !== height) {
    return fail(
      "image_square",
      `Artwork must be exactly square. This image is ${width}×${height}.`
    );
  }
  if (width < IMAGE_MIN_SIDE) {
    return fail(
      "image_small",
      `Artwork must be at least ${IMAGE_MIN_SIDE}×${IMAGE_MIN_SIDE} pixels.`
    );
  }
  if (width > max) {
    return fail(
      "image_dimensions",
      `Artwork can be at most ${max}×${max} pixels.`
    );
  }
  return { ok: true };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1)
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1)
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      crcTable[value] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crcTable[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
