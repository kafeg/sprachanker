// Renders the app icons from public/favicon.svg (the master): PNGs for home screens and the PWA
// manifest, and the desktop app's source (macOS's grid: the tile 824 of 1024, transparent around;
// then `bun x tauri icon` in apps/desktop/src-tauri). Needs rsvg-convert (`brew install librsvg`).
// Usage: bun apps/web/scripts/icons.ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const publicDir = resolve(import.meta.dir, "../public");
const master = readFileSync(join(publicDir, "favicon.svg"), "utf8");
const tile = /<rect [^>]*fill="(#[0-9A-F]+)"\/>/.exec(master);
const start = master.indexOf('<g id="mark">');
if (!tile || start < 0) throw new Error("favicon.svg: tile or mark not found");
// Everything after the tile: the mark group, up to the closing </svg>.
const mark = master.slice(start, master.lastIndexOf("</svg>"));

/** The mark on a full square (the OS rounds the corners), scaled about the centre. */
const square = (scale: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${tile[1]}"/>` +
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark}</g></svg>`;

const outputs: Array<[file: string, svg: string, size: number]> = [
  // iOS home screen: opaque square, iOS applies its own mask.
  ["apple-touch-icon.png", square(1), 180],
  // Install icons as drawn (rounded tile), and a maskable one with the mark inside the safe zone.
  ["icon-192.png", master, 192],
  ["icon-512.png", master, 512],
  ["icon-maskable-512.png", square(0.8), 512],
  // macOS: the rounded tile inside Apple's grid, as other apps' icons stand in the Dock.
  [
    "../../desktop/src-tauri/icons/app-icon.png",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><svg x="100" y="100" width="824" height="824" viewBox="0 0 64 64">${master.slice(master.indexOf(">") + 1, master.lastIndexOf("</svg>"))}</svg></svg>`,
    1024,
  ],
];
for (const [file, svg, size] of outputs) {
  const r = spawnSync(
    "rsvg-convert",
    ["-w", String(size), "-h", String(size), "-o", join(publicDir, file)],
    {
      input: svg,
    },
  );
  if (r.status !== 0) throw new Error(`rsvg-convert ${file}: ${r.stderr}`);
  console.log(`${file} ${size}×${size}`);
}
