// Piper on the phone as the server's reading aloud knows it (PiperHost), as on a computer
// (packages/server/src/runtime/piper.ts): sherpa-onnx's program the app carries, run once per text, its
// reading written to the engines' folder and taken back; its voices in <data-root>/models/voices over
// the phone's files — each archive downloaded and checked by the server's storage, unpacked by the
// native side, put in place whole.
import type { DataFs } from "@sprachanker/course-kit";
import { downloadChecked, type PiperHost, removeParts } from "@sprachanker/server/portable";
import { native } from "./native.ts";
import { type EnginePrograms, nativePrograms, programProcess } from "./speech.ts";

/** A reading takes a second or two; one that takes longer is stuck. */
const RUN_MS = 60_000;
/** As many threads as the computer's run: the phone's big cores are kept for the rest. */
const THREADS = 2;

export interface PiperFiles {
  /** Unpacks a .tar.bz2 archive into a folder (absolute paths). */
  untar(archive: string, into: string): Promise<void>;
  /** The folder the engine writes its readings into (absolute). */
  outputs(): Promise<string>;
  /** A reading written there, read and removed. */
  output(name: string): Promise<ArrayBuffer>;
}

const nativeFiles: PiperFiles = {
  untar: native.untarBz2,
  outputs: native.engineOutputs,
  output: native.engineOutput,
};

export function phonePiper(
  fs: DataFs,
  root: string,
  net: typeof fetch,
  options: { built: boolean; programs?: EnginePrograms; files?: PiperFiles },
): PiperHost {
  const programs = options.programs ?? nativePrograms;
  const files = options.files ?? nativeFiles;
  const voices = `${root}/models/voices`;
  removeParts(fs, voices);
  let made = 0;
  const leave = (id: string) => {
    fs.remove(`${voices}/${id}.tar.bz2.part`);
    fs.remove(`${voices}/${id}.part`);
  };
  return {
    binary: () => (options.built ? "in-app" : undefined),
    voiceDir(id) {
      const dir = `${voices}/${id}`;
      return fs.stat(`${dir}/${id}.onnx`) ? dir : undefined;
    },
    async download(url, voice, onProgress, signal) {
      fs.mkdir(voices);
      const archive = `${voices}/${voice.id}.tar.bz2.part`;
      const unpacked = `${voices}/${voice.id}.part`;
      await downloadChecked(fs, net, url, archive, voice.sha256, onProgress, signal);
      try {
        fs.remove(unpacked);
        // The archive holds one folder, vits-piper-<id>: the model, its tokens and espeak-ng data.
        await files.untar(archive, unpacked);
        fs.remove(`${voices}/${voice.id}`);
        fs.rename(`${unpacked}/vits-piper-${voice.id}`, `${voices}/${voice.id}`);
      } finally {
        leave(voice.id);
      }
    },
    remove(id) {
      fs.remove(`${voices}/${id}`);
      leave(id);
    },
    async run({ dir, id, text, lengthScale, signal }) {
      const name = `piper-${Date.now()}-${made++}.wav`;
      const proc = programProcess(programs, "piper", [
        `--vits-model=${dir}/${id}.onnx`,
        `--vits-tokens=${dir}/tokens.txt`,
        `--vits-data-dir=${dir}/espeak-ng-data`,
        `--vits-length-scale=${lengthScale}`,
        `--num-threads=${THREADS}`,
        `--output-filename=${await files.outputs()}/${name}`,
        text,
      ]);
      const timer = setTimeout(proc.kill, RUN_MS);
      // The request gone (and no other waiting for it): stopped.
      signal?.addEventListener("abort", proc.kill, { once: true });
      const code = await proc.exited.finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", proc.kill);
      });
      const wav = await files.output(name).catch(() => undefined);
      if (code !== 0 || !wav) throw new Error(`reading aloud failed (${code}): ${proc.stderr()}`);
      return new Uint8Array(wav);
    },
  };
}
