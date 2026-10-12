// What the speech checks share: the compiled binary started on a throwaway data root whose
// models are an APFS clone of the real ones (`SPRACHANKER_MODELS`, else ~/SprachAnker/models), a
// profile signed in, and takes as the recogniser gets them (16 kHz mono WAV).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(import.meta.dirname, "../../apps/cli/dist/sprachanker");

/** The app on `port` over `root` (made anew), signed in; `stop` ends it. */
export async function speechApp(root: string, port: number) {
  const models = process.env.SPRACHANKER_MODELS ?? join(homedir(), "SprachAnker", "models");
  const base = `http://127.0.0.1:${port}`;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "data"), { recursive: true });
  if (!existsSync(models)) throw new Error(`no models at ${models} (set SPRACHANKER_MODELS)`);
  execFileSync("cp", ["-c", "-R", models, join(root, "data", "models")]);
  // Its app-data folder (the secret key) inside the throwaway root, never the machine's.
  const server = spawn(binary, ["serve", "--port", String(port), "--data", join(root, "data")], {
    stdio: "ignore",
    cwd: tmpdir(),
    env: { ...process.env, SPRACHANKER_APP_DATA: join(root, "app") },
  });
  for (let i = 0; i < 50 && !(await fetch(`${base}/api/health`).catch(() => undefined))?.ok; i++)
    await new Promise((r) => setTimeout(r, 200));
  const made = await fetch(`${base}/api/profiles`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sprachanker": "1" },
    body: JSON.stringify({ name: "Speech" }),
  });
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const headers = { "content-type": "application/json", "x-sprachanker": "1", cookie };
  return {
    base,
    headers,
    /** Sets one of the profile's settings. */
    set: (key: string, value: unknown) =>
      fetch(`${base}/api/settings`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ key, value }),
      }),
    /** A text read aloud by the profile's engine, as a 16 kHz WAV's samples. */
    async say(text: string, lang: string) {
      const res = await fetch(`${base}/api/speech/say`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, lang }),
      });
      if (!res.ok) throw new Error(`say ${res.status}: ${text}`);
      return samples16k(new Uint8Array(await res.arrayBuffer()));
    },
    /** What the app heard in a take (`silent`: nothing). */
    async transcribe(wav: Uint8Array<ArrayBuffer>, lang: string) {
      const r = await fetch(`${base}/api/speech/transcribe?lang=${lang}`, {
        method: "POST",
        headers: { "content-type": "audio/wav", "x-sprachanker": "1", cookie },
        body: wav,
      });
      return (await r.json()) as { text: string; silent?: boolean; error?: string };
    },
    stop: () => server.kill(),
  };
}

/** A WAV's PCM (16-bit, its first channel) and rate. */
function pcmOf(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let rate = 0;
  let channels = 1;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = String.fromCharCode(...wav.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
    }
    if (id === "data") {
      const n = Math.floor(size / 2 / channels);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++)
        samples[i] = view.getInt16(at + 8 + i * 2 * channels, true) / 32768;
      return { rate, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data in the WAV");
}

/** A WAV's samples at 16 kHz (linear interpolation): what the recogniser takes. */
export function samples16k(wav: Uint8Array): Float32Array {
  const { rate, samples } = pcmOf(wav);
  const n = Math.floor((samples.length * 16000) / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / 16000;
    const a = samples[Math.floor(x)] ?? 0;
    const b = samples[Math.min(Math.floor(x) + 1, samples.length - 1)] ?? a;
    out[i] = a + (b - a) * (x - Math.floor(x));
  }
  return out;
}

/** 16 kHz samples (-1…1) as a 16-bit mono WAV. */
export function wav16k(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const n = samples.length;
  const file = new Uint8Array(44 + n * 2);
  const view = new DataView(file.buffer);
  const str = (at: number, s: string) => {
    for (const [i, c] of [...s].entries()) view.setUint8(at + i, c.charCodeAt(0));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767), true);
  return file;
}

/** Where a check's data root goes. */
export const checkRoot = (name: string) => join(tmpdir(), name);
