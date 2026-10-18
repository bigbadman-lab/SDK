"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/motion";

const SOURCE = "/images/agentframe-landscape.jpg";
const FRAME_MS = 1000 / 24;
const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const PALETTE = new Uint8Array([
  17, 32, 34, 20, 46, 37, 29, 62, 39, 46, 80, 45, 65, 98, 54, 91, 121, 64, 122,
  144, 81, 153, 166, 107, 189, 193, 145, 226, 220, 179, 244, 238, 211, 255, 251,
  235, 48, 69, 70, 69, 91, 91, 89, 113, 114, 113, 137, 138, 142, 164, 166, 171,
  192, 194, 205, 219, 216, 231, 237, 226, 45, 76, 91, 61, 105, 127, 81, 137,
  159, 110, 164, 184, 150, 191, 203, 190, 215, 220, 15, 61, 69, 19, 86, 94, 25,
  114, 120, 40, 141, 143, 59, 169, 164, 85, 190, 180, 123, 212, 196, 167, 228,
  210, 210, 244, 226,
]);
const GLINT_COUNT = 15;

export function LandscapeCanvas({
  className,
}: {
  className?: string;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!host || !canvas || !context) return;

    const photo = new window.Image();
    const texture = document.createElement("canvas");
    const textureContext = texture.getContext("2d", {
      willReadFrequently: true,
    });
    if (!textureContext) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let resizeFrame = 0;
    let visible = false;
    let ready = false;
    let disposed = false;
    let lastThrottle = 0;
    let lastDraw = 0;
    let clock = 7;
    let pointer = 0;
    let targetPointer = 0;
    let textureWidth = 0;
    let textureHeight = 0;
    let waterStart = 0;
    let pixelScale = 1;
    const glints = new Float32Array(GLINT_COUNT * 4);
    for (let i = 0; i < GLINT_COUNT; i++) {
      glints[i * 4] = ((i * 0.618033) % 1) * 0.9 + 0.05;
      glints[i * 4 + 1] = ((i * 0.414214) % 1) * 0.82 + 0.1;
      glints[i * 4 + 2] = i * 2.39996;
      glints[i * 4 + 3] = 0.6 + (i % 4) * 0.2;
    }

    function prepareTexture(): void {
      if (!textureContext || !photo.naturalWidth || !width || !height) return;

      texture.width = Math.min(640, Math.max(192, Math.round(width / 2)));
      texture.height = Math.round((texture.width * height) / width);
      textureWidth = texture.width;
      textureHeight = texture.height;
      pixelScale = height / textureHeight;
      const cover = Math.max(
        texture.width / photo.naturalWidth,
        texture.height / photo.naturalHeight
      );
      const imageWidth = photo.naturalWidth * cover;
      const imageHeight = photo.naturalHeight * cover;
      const imageTop = (textureHeight - imageHeight) / 2;
      waterStart = Math.max(
        0,
        Math.min(textureHeight, Math.round(imageTop + imageHeight * 0.695))
      );
      textureContext.drawImage(
        photo,
        (texture.width - imageWidth) / 2,
        (texture.height - imageHeight) / 2,
        imageWidth,
        imageHeight
      );
      const pixels = textureContext.getImageData(
        0,
        0,
        texture.width,
        texture.height
      );
      for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
          const offset = (y * texture.width + x) * 4;
          const red = pixels.data[offset] ?? 0;
          const green = pixels.data[offset + 1] ?? 0;
          const blue = pixels.data[offset + 2] ?? 0;
          const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          const threshold = (DITHER[(y % 4) * 4 + (x % 4)] ?? 0) / 16 - 0.5;
          const water = Math.min(1, Math.max(0, (y - waterStart) / 12));
          const light = Math.max(0, (luminance - 150) / 105);
          const lift = Math.pow(luminance / 255, 0.88) * 255 - luminance;
          const r =
            luminance +
            (red - luminance) * 1.3 +
            lift +
            light * 7 -
            water * luminance * 0.2 +
            threshold * 25;
          const g =
            luminance +
            (green - luminance) * 1.3 +
            lift +
            light * 4 +
            water * 10 +
            threshold * 25;
          const b =
            luminance +
            (blue - luminance) * 1.25 +
            lift -
            light * 3 +
            water * luminance * 0.22 +
            threshold * 25;
          let best = 0;
          let distance = Infinity;
          for (let p = 0; p < PALETTE.length; p += 3) {
            const dr = r - (PALETTE[p] ?? 0);
            const dg = g - (PALETTE[p + 1] ?? 0);
            const db = b - (PALETTE[p + 2] ?? 0);
            const candidate = dr * dr * 0.3 + dg * dg * 0.5 + db * db * 0.2;
            if (candidate < distance) {
              distance = candidate;
              best = p;
            }
          }
          pixels.data[offset] = PALETTE[best] ?? 0;
          pixels.data[offset + 1] = PALETTE[best + 1] ?? 0;
          pixels.data[offset + 2] = PALETTE[best + 2] ?? 0;
          pixels.data[offset + 3] = 255;
        }
      }
      textureContext.putImageData(pixels, 0, 0);
      ready = true;
    }

    function draw(): void {
      if (!context || !ready) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(texture, 0, 0, width, height);

      for (let y = waterStart; y < textureHeight; y += 2) {
        const depth = (y - waterStart) / (textureHeight - waterStart);
        const ripple =
          Math.sin(y * 0.16 - clock * 1.5) * depth * 6 +
          Math.sin(y * 0.047 + clock * 0.7) * depth * 3 +
          pointer * depth * 3;
        const shift = Math.round(ripple) * pixelScale;
        const stripeHeight = Math.min(2, textureHeight - y);
        context.drawImage(
          texture,
          0,
          y,
          textureWidth,
          stripeHeight,
          shift,
          y * pixelScale,
          width,
          stripeHeight * pixelScale
        );
      }

      context.fillStyle = "#e9ffe9";
      for (let i = 0; i < GLINT_COUNT; i++) {
        const phase = glints[i * 4 + 2] ?? 0;
        const speed = glints[i * 4 + 3] ?? 1;
        const pulse = Math.max(0, Math.sin(clock * speed + phase));
        const depth = glints[i * 4 + 1] ?? 0;
        const x = (((glints[i * 4] ?? 0) + clock * 0.012 * speed) % 1) * width;
        const y =
          (waterStart + depth * (textureHeight - waterStart)) * pixelScale;
        const glintWidth = (2 + depth * 7) * pixelScale;
        context.globalAlpha = pulse * pulse * pulse * 0.55;
        context.fillRect(
          Math.round(x / pixelScale) * pixelScale,
          Math.round(y / pixelScale) * pixelScale,
          glintWidth,
          pixelScale
        );
      }
      context.globalAlpha = 1;
    }

    function tick(now: number): void {
      frame = requestAnimationFrame(tick);
      const throttleElapsed = now - lastThrottle;
      if (throttleElapsed < FRAME_MS) return;
      lastThrottle = now - (throttleElapsed % FRAME_MS);
      const elapsed = Math.min(now - lastDraw, 50);
      lastDraw = now;
      clock += elapsed / 1000;
      const ease = 1 - Math.pow(1 - 0.07, elapsed / FRAME_MS);
      pointer += (targetPointer - pointer) * ease;
      draw();
    }

    function sync(): void {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!ready) return;
      draw();
      if (!reduced && visible && !document.hidden) {
        lastThrottle = performance.now();
        lastDraw = lastThrottle;
        frame = requestAnimationFrame(tick);
      }
    }

    function resize(): void {
      if (!host || !canvas || !context) return;
      width = Math.round(host.clientWidth);
      height = Math.round(host.clientHeight);
      if (!width || !height) return;

      canvas.width = width;
      canvas.height = height;
      prepareTexture();
      sync();
    }

    function queueResize(): void {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    }

    function move(event: PointerEvent): void {
      if (reduced || !host || event.pointerType !== "mouse") return;
      const bounds = host.getBoundingClientRect();
      targetPointer = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    }

    function resetPointer(): void {
      targetPointer = 0;
    }

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        sync();
      },
      { rootMargin: "80px" }
    );
    const resizer = new ResizeObserver(queueResize);
    intersection.observe(host);
    resizer.observe(host);
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", resetPointer);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("blur", resetPointer);
    photo.onload = () => {
      if (!disposed) resize();
    };
    photo.src = SOURCE;

    return () => {
      disposed = true;
      photo.onload = null;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      intersection.disconnect();
      resizer.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", resetPointer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("blur", resetPointer);
    };
  }, [reduced]);

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 overflow-hidden ${className ?? ""}`}
      aria-hidden="true"
    >
      <Image
        src={SOURCE}
        alt=""
        fill
        preload
        unoptimized
        sizes="(max-width: 1160px) 100vw, 1100px"
        className="object-cover contrast-104 saturate-125"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
