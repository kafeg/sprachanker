// Pictures taken out of the catalogue PDF, saved as PNG files: decoded pixels (pdf.ts) scaled down to
// a size a screen shows and encoded losslessly (zlib, no image library).
import { deflateSync } from "node:zlib";
import type { Pixels } from "./pdf.ts";

/** The longest side a picture is kept at (the PDF has photos of almost 3000 pixels). */
export const MAX_SIDE = 1200;

/** Pixels scaled down so the longer side is at most `max`, each new pixel the mean of the pixels it
 *  covers (box filter); smaller pictures as they are. */
export function shrink(pixels: Pixels, max = MAX_SIDE): Pixels {
  const { width, height, channels, data } = pixels;
  const scale = Math.max(width, height) / max;
  if (scale <= 1) return pixels;
  const w = Math.max(1, Math.round(width / scale));
  const h = Math.max(1, Math.round(height / scale));
  const out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++)
          for (let c = 0; c < channels; c++)
            sum[c] = (sum[c] ?? 0) + (data[(sy * width + sx) * channels + c] ?? 0);
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < channels; c++)
        out[(y * w + x) * channels + c] = Math.round((sum[c] ?? 0) / n);
    }
  }
  return { width: w, height: h, channels, data: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Paeth's predictor (the PNG filter that suits photos best). */
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** A PNG file of the pixels (8 bits a channel, RGB or RGBA, every row Paeth-filtered). */
export function encodePng(pixels: Pixels): Uint8Array {
  const { width, height, channels, data } = pixels;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  // Each row starts with its filter type: 4, Paeth (a byte less its prediction from the left, above
  // and above-left bytes).
  const row = width * channels;
  const raw = new Uint8Array(height * (row + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (row + 1);
    raw[at] = 4;
    for (let i = 0; i < row; i++) {
      const left = i >= channels ? (data[y * row + i - channels] ?? 0) : 0;
      const up = y > 0 ? (data[(y - 1) * row + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= channels ? (data[(y - 1) * row + i - channels] ?? 0) : 0;
      raw[at + 1 + i] = ((data[y * row + i] ?? 0) - paeth(left, up, upLeft)) & 0xff;
    }
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
