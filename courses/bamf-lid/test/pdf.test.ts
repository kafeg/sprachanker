// The PDF reader and the PNG writer on a PDF made here: one page with a line of text and a picture.
import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { readPdf } from "../src/pdf.ts";
import { encodePng, shrink } from "../src/png.ts";

/** A one-page PDF: text at (71, 700) and (114, 650), a 2×2 RGB picture drawn at (80, 500), 90×60. */
function samplePdf(pixels: Uint8Array): Uint8Array {
  const content =
    "BT /F1 12 Tf 71 700 Td (Aufgabe 1) Tj ET BT /F1 12 Tf 114 650 Td (eins) Tj 30 0 Td (zwei) Tj ET q 90 0 0 60 80 500 cm /Im1 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    {
      head: "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8",
      data: pixels,
    },
    { head: "<<", data: new TextEncoder().encode(content) },
  ];
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (p: Uint8Array | string) => {
    const bytes = typeof p === "string" ? new TextEncoder().encode(p) : p;
    parts.push(bytes);
    length += bytes.length;
  };
  add("%PDF-1.4\n");
  objects.forEach((o, i) => {
    offsets.push(length);
    if (typeof o === "string") add(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else {
      add(`${i + 1} 0 obj\n${o.head} /Length ${o.data.length} >>\nstream\n`);
      add(o.data);
      add("\nendstream\nendobj\n");
    }
  });
  const xref = length;
  add(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const at of offsets) add(`${String(at).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const PIXELS = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);

test("a PDF read: lines by baseline with their place, a picture with its box and pixels", async () => {
  const { lines, images } = await readPdf(samplePdf(PIXELS));
  expect(lines.map((l) => [l.page, l.y, Math.round(l.x), l.text])).toEqual([
    [1, 700, 71, "Aufgabe 1"],
    [1, 650, 114, "eins zwei"],
  ]);
  expect(images).toHaveLength(1);
  const [image] = images;
  expect([image?.page, image?.x, image?.y, image?.width, image?.height]).toEqual([
    1, 80, 500, 90, 60,
  ]);
  expect(image?.pixels).toMatchObject({ width: 2, height: 2, channels: 3 });
  expect([...(image?.pixels.data ?? [])]).toEqual([...PIXELS]);
});

/** The PNG's pixels back: its header read, its rows inflated and un-filtered (Paeth). */
function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const channels = png[25] === 6 ? 4 : 3;
  const idatLength = view.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  const row = width * channels;
  const out = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (row + 1)]).toBe(4);
    for (let i = 0; i < row; i++) {
      const a = i >= channels ? (out[y * row + i - channels] ?? 0) : 0;
      const b = y > 0 ? (out[(y - 1) * row + i] ?? 0) : 0;
      const c = y > 0 && i >= channels ? (out[(y - 1) * row + i - channels] ?? 0) : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * row + i] = ((raw[y * (row + 1) + 1 + i] ?? 0) + predicted) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

test("a picture saved as PNG reads back as it was", () => {
  const rgba = new Uint8Array(Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256));
  const back = decodePng(encodePng({ width: 3, height: 2, channels: 4, data: rgba }));
  expect(back).toEqual({ width: 3, height: 2, channels: 4, data: rgba });
});

test("a large picture is scaled down to the longest side kept, each pixel the mean of those it covers", () => {
  const data = new Uint8Array(4 * 2 * 3).fill(100);
  data.set([200, 200, 200], 0);
  const small = shrink({ width: 4, height: 2, channels: 3, data }, 2);
  expect([small.width, small.height]).toEqual([2, 1]);
  expect([...small.data]).toEqual([125, 125, 125, 100, 100, 100]);
  const kept = { width: 2, height: 2, channels: 3 as const, data: PIXELS };
  expect(shrink(kept, 10)).toBe(kept);
});
