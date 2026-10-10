// Piper on this machine (08): sherpa-onnx's `sherpa-onnx-offline-tts` run once per text, its voices in
// <data-root>/models/voices (each archive checked, unpacked by `tar`, put in place whole), a reading
// written to a temporary folder and read back.
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiperHost } from "../services/read-aloud.ts";
import { engineAt } from "./engines.ts";
import { downloadChecked, removeParts } from "./model-files.ts";

/** A text of a reply is read in a second or two; one that takes longer is stuck. */
const RUN_MS = 60_000;

export function piperHost(dataRoot: string): PiperHost {
  const voices = join(dataRoot, "models", "voices");
  removeParts(voices);
  /** Piper's output while it is read back. */
  const out = mkdtempSync(join(tmpdir(), "sprachanker-piper-"));
  let runs = 0;
  return {
    binary: () => engineAt("piper"),
    voiceDir(id) {
      const dir = join(voices, id);
      return existsSync(join(dir, `${id}.onnx`)) ? dir : undefined;
    },
    async download(url, voice, onProgress, signal) {
      mkdirSync(voices, { recursive: true });
      const archive = join(voices, `${voice.id}.tar.bz2.part`);
      const unpacked = join(voices, `${voice.id}.part`);
      await downloadChecked(url, archive, voice.sha256, onProgress, signal);
      try {
        rmSync(unpacked, { recursive: true, force: true });
        mkdirSync(unpacked, { recursive: true });
        // The archive holds one folder, vits-piper-<id>: the model, its tokens and espeak-ng data.
        // Unpacked by another process, so the server goes on answering meanwhile.
        const tar = Bun.spawn(["tar", "-xjf", archive, "-C", unpacked], { stderr: "pipe" });
        if ((await tar.exited) !== 0)
          throw new Error(
            `unpacking failed: ${(await new Response(tar.stderr).text()).slice(0, 200)}`,
          );
        rmSync(join(voices, voice.id), { recursive: true, force: true });
        renameSync(join(unpacked, `vits-piper-${voice.id}`), join(voices, voice.id));
      } finally {
        rmSync(archive, { force: true });
        rmSync(unpacked, { recursive: true, force: true });
      }
    },
    remove(id) {
      rmSync(join(voices, id), { recursive: true, force: true });
      rmSync(join(voices, `${id}.part`), { recursive: true, force: true });
      rmSync(join(voices, `${id}.tar.bz2.part`), { force: true });
    },
    async run({ binary, dir, id, text, lengthScale }) {
      const wav = join(out, `${++runs}.wav`);
      const proc = Bun.spawn(
        [
          binary,
          `--vits-model=${join(dir, `${id}.onnx`)}`,
          `--vits-tokens=${join(dir, "tokens.txt")}`,
          `--vits-data-dir=${join(dir, "espeak-ng-data")}`,
          `--vits-length-scale=${lengthScale}`,
          "--num-threads=2",
          `--output-filename=${wav}`,
          text,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const timer = setTimeout(() => proc.kill(), RUN_MS);
      try {
        const code = await proc.exited.finally(() => clearTimeout(timer));
        if (code !== 0 || !existsSync(wav)) throw new Error(`reading aloud failed (${code})`);
        return new Uint8Array(await Bun.file(wav).arrayBuffer());
      } finally {
        rmSync(wav, { force: true });
      }
    },
  };
}
