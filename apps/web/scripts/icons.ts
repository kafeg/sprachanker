// Renders the app icons from public/favicon.svg (the master): PNGs for home screens and the PWA
// manifest, the desktop app's source (macOS's grid: the tile 824 of 1024, transparent around;
// then `bun x tauri icon` in apps/desktop/src-tauri), and the phone app's own: Android's adaptive
// icon (the mark in the middle 66 of 108, the tile's colour behind; round and square ones for older
// launchers) at every density, iOS's opaque squares at every size its icon set names. Needs
// rsvg-convert (`brew install librsvg`).
// Usage: bun apps/web/scripts/icons.ts
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
// The phone app (apps/mobile/src-tauri/gen): Android's resources, iOS's icon set.
const res = "../../mobile/src-tauri/gen/android/app/src/main/res";
/** The mark alone on a transparent square, scaled about the centre (Android's foreground layer). */
const markOnly = (scale: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark}</g></svg>`;
/** The mark on a circle of the tile's colour (older launchers' round icon). */
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${tile[1]}"/><g transform="translate(32 32) scale(0.72) translate(-32 -32)">${mark}</g></svg>`;
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, k] of Object.entries(densities)) {
  // The adaptive foreground is 108 dp, of which the middle 66 always shows.
  outputs.push([`${res}/mipmap-${density}/ic_launcher_foreground.png`, markOnly(0.6), 108 * k]);
  outputs.push([`${res}/mipmap-${density}/ic_launcher.png`, master, 48 * k]);
  outputs.push([`${res}/mipmap-${density}/ic_launcher_round.png`, round, 48 * k]);
}
const appIcons = "../../mobile/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset";
for (const name of readdirSync(join(publicDir, appIcons)).filter((n) => n.endsWith(".png"))) {
  // "AppIcon-20x20@2x-1.png": 20 points at 2×; "AppIcon-512@2x.png": 512 at 2×.
  const [, points = "0", scale = "1"] = /^AppIcon-([\d.]+)(?:x[\d.]+)?@(\d)x/.exec(name) ?? [];
  outputs.push([`${appIcons}/${name}`, square(1), Math.round(Number(points) * Number(scale))]);
}

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
// Android: the adaptive icon's two layers, the tile's colour behind the mark.
const adaptive = (name: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
for (const name of ["ic_launcher", "ic_launcher_round"])
  writeFileSync(join(publicDir, res, "mipmap-anydpi-v26", `${name}.xml`), adaptive(name));
writeFileSync(
  join(publicDir, res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${tile[1]}</color>\n</resources>\n`,
);
