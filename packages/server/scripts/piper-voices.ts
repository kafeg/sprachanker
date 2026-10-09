// Writes src/services/piper-voices.json: the Piper voices sherpa-onnx publishes (its `tts-models`
// release), each with its size and sha256 as GitHub gives them, so a download is checked like a
// recognition model (08). Novelty voices (game characters) are left out. Run again to take new voices:
//   bun packages/server/scripts/piper-voices.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const RELEASE = "https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/tts-models";
const NAME = /^vits-piper-([a-z]{2,3})_([A-Z]{2})-(.+)-(x_low|low|medium|high)\.tar\.bz2$/;
const NOVELTY = /glados|turret|emotional/;

const release = (await (await fetch(RELEASE)).json()) as {
  assets: Array<{ name: string; size: number; digest?: string }>;
};
const voices = release.assets
  .flatMap((a) => {
    const m = NAME.exec(a.name);
    const sha256 = a.digest?.replace(/^sha256:/, "");
    if (!m || NOVELTY.test(a.name) || !sha256) return [];
    const [, lang, region, name, quality] = m as unknown as string[];
    return [
      {
        id: `${lang}_${region}-${name}-${quality}`,
        lang,
        region,
        name,
        quality,
        bytes: a.size,
        sha256,
      },
    ];
  })
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(
  join(import.meta.dir, "../src/services/piper-voices.json"),
  `${JSON.stringify(voices, null, 1)}\n`,
);
console.log(`${voices.length} voices`);
