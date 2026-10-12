// A PDF read for its text lines and pictures (pdf.js): each line with its page and place, each
// picture decoded with its place — what the catalogue parser needs, nothing drawn.
/// <reference path="./pdfjs-worker.d.ts" />

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let loading: Promise<PdfJs> | undefined;
/** pdf.js, loaded when a PDF is first read (not with the server): its parser runs in this thread when
 *  its worker module is given (no worker file to find, also inside the compiled binary). */
function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return loading;
}

/** A line of text: the items of one baseline on a page, left to right. */
export interface PdfLine {
  page: number;
  /** Baseline height from the bottom of the page, in points. */
  y: number;
  /** Where its first item starts. */
  x: number;
  text: string;
}

/** A picture as drawn: its box on the page (points from the bottom left) and its pixels. */
export interface PdfImage {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Pixels;
}

/** Decoded pixels: 3 bytes a pixel (RGB) or 4 (RGBA, a picture with a soft mask). */
export interface Pixels {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
}

interface TextItem {
  str: string;
  transform: number[];
}

/** pdf.js's image kinds: RGB 24 bits, RGBA 32 bits (a 1-bit kind is never a photo or a crest). */
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

export async function readPdf(
  bytes: Uint8Array,
): Promise<{ lines: PdfLine[]; images: PdfImage[] }> {
  const { getDocument, OPS, Util } = await pdfjs();
  // pdf.js keeps the buffer it is given: a copy, so the caller's stays whole.
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const lines: PdfLine[] = [];
  const images: PdfImage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      lines.push(...linesOf(n, (await page.getTextContent()).items as TextItem[]));
      images.push(...(await imagesOf(n, page, OPS, Util)));
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.loadingTask?.destroy?.();
  }
  return { lines, images };
}

/** The text items of a page joined by baseline, top to bottom, each line left to right. */
function linesOf(page: number, items: TextItem[]): PdfLine[] {
  const byBaseline = new Map<number, Array<{ x: number; str: string }>>();
  for (const item of items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5] ?? 0);
    const x = item.transform[4] ?? 0;
    byBaseline.set(y, [...(byBaseline.get(y) ?? []), { x, str: item.str }]);
  }
  return [...byBaseline]
    .sort(([a], [b]) => b - a)
    .map(([y, parts]) => {
      parts.sort((a, b) => a.x - b.x);
      return { page, y, x: parts[0]?.x ?? 0, text: parts.map((p) => p.str).join("") };
    });
}

/** The pictures a page draws, with the box each is drawn in (the current transformation followed
 *  through the page's operators). */
async function imagesOf(
  page: number,
  pdfPage: Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>,
  OPS: PdfJs["OPS"],
  Util: PdfJs["Util"],
): Promise<PdfImage[]> {
  const ops = await pdfPage.getOperatorList();
  const out: PdfImage[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[]);
    else if (fn === OPS.paintImageXObject) {
      const id = args[0] as string;
      // Pictures used on several pages are the document's, the others the page's.
      const objs = id.startsWith("g_") ? pdfPage.commonObjs : pdfPage.objs;
      const image = await new Promise<{
        width: number;
        height: number;
        kind?: number;
        data?: Uint8ClampedArray;
      }>((resolve) => objs.get(id, resolve));
      if (!image.data || (image.kind !== RGB_24BPP && image.kind !== RGBA_32BPP)) continue;
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = ctm;
      out.push({
        page,
        x: Math.min(e, e + c),
        y: Math.min(f, f + b),
        width: Math.abs(a + c),
        height: Math.abs(b + d),
        pixels: {
          width: image.width,
          height: image.height,
          channels: image.kind === RGBA_32BPP ? 4 : 3,
          data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
        },
      });
    }
  }
  return out;
}
