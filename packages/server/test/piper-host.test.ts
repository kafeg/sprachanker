// The runtime's Piper host and reading cache on the file system: a voice's archive downloaded, checked
// and unpacked whole; a reading made by the engine (a stand-in script), kept once however many ask for
// it together.
import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piperHost } from "../src/runtime/piper.ts";
import { readingCache } from "../src/runtime/readings.ts";
import type { PiperVoice } from "../src/services/read-aloud.ts";

const work = mkdtempSync(join(tmpdir(), "sprachanker-piper-"));
const ID = "de_DE-test-low";

// A voice archive shaped as sherpa-onnx publishes them: one folder with the model and its data.
const folder = join(work, "src", `vits-piper-${ID}`);
mkdirSync(join(folder, "espeak-ng-data"), { recursive: true });
writeFileSync(join(folder, `${ID}.onnx`), "model");
writeFileSync(join(folder, "tokens.txt"), "tokens");
const archive = join(work, `${ID}.tar.bz2`);
Bun.spawnSync(["tar", "-cjf", archive, "-C", join(work, "src"), `vits-piper-${ID}`]);
const bytes = readFileSync(archive);
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
afterAll(() => server.stop());

const voice = (hash = sha256): PiperVoice => ({
  id: ID,
  lang: "de",
  region: "DE",
  name: "test",
  quality: "low",
  bytes: bytes.length,
  sha256: hash,
});

test("a voice downloaded, checked and unpacked whole; a wrong one leaves nothing behind", async () => {
  const root = join(work, "root-download");
  const host = piperHost(root);
  const url = `http://127.0.0.1:${server.port}/voice`;
  await expect(
    host.download(url, voice("0".repeat(64)), () => {}, new AbortController().signal),
  ).rejects.toThrow("checksum");
  expect(host.voiceDir(ID)).toBeUndefined();
  expect(readdirSync(join(root, "models", "voices"))).toEqual([]);

  let done = 0;
  await host.download(url, voice(), (n) => (done = n), new AbortController().signal);
  expect(done).toBe(bytes.length);
  const dir = host.voiceDir(ID) as string;
  expect(existsSync(join(dir, "tokens.txt"))).toBe(true);
  expect(readdirSync(join(root, "models", "voices"))).toEqual([ID]);
  host.remove(ID);
  expect(host.voiceDir(ID)).toBeUndefined();
});

test("a reading is made once however many ask for it together, then served from the cache", async () => {
  const root = join(work, "root-say");
  const host = piperHost(root);
  const readings = readingCache(root);
  // The engine's stand-in: writes the text as the WAV after a moment, and counts its runs.
  const runs = join(work, "runs.txt");
  const engine = join(work, "engine.sh");
  writeFileSync(
    engine,
    `#!/bin/sh\nfor a in "$@"; do case "$a" in --output-filename=*) out="\${a#--output-filename=}";; esac; text="$a"; done\nsleep 0.2\necho run >> "${runs}"\nprintf '%s' "$text" > "$out"\n`,
  );
  chmodSync(engine, 0o755);
  const run = { binary: engine, dir: work, id: ID, text: "Guten Tag", lengthScale: 1 };
  const say = () => readings.kept("k1", () => host.run(run));
  const [a, b] = await Promise.all([say(), say()]);
  expect(new TextDecoder().decode(a)).toBe("Guten Tag");
  expect(new TextDecoder().decode(b)).toBe("Guten Tag");
  expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
  await say();
  expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
  expect(readdirSync(join(root, "cache", "tts"))).toEqual(["k1.wav"]);
});

test("what a stopped server left is gone once one starts; a reading kept counts as new when used", async () => {
  const root = join(work, "root-leftovers");
  const cache = join(root, "cache", "tts");
  const voices = join(root, "models", "voices");
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(voices, `${ID}.part`), { recursive: true });
  writeFileSync(join(cache, "a.part"), "x");
  writeFileSync(join(cache, "kept.wav"), "x");
  writeFileSync(join(voices, `${ID}.tar.bz2.part`), "x");
  piperHost(root);
  const readings = readingCache(root);
  expect(readdirSync(cache)).toEqual(["kept.wav"]);
  expect(readdirSync(voices)).toEqual([]);
  // Read from the cache: its time is now, so pruning the oldest keeps it.
  const old = new Date(2020, 0, 1);
  utimesSync(join(cache, "kept.wav"), old, old);
  const kept = await readings.kept("kept", async () => {
    throw new Error("made again");
  });
  expect(new TextDecoder().decode(kept)).toBe("x");
  expect(statSync(join(cache, "kept.wav")).mtimeMs).toBeGreaterThan(old.getTime());
});
