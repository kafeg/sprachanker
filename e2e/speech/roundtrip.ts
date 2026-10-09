// Speech round-trip (10, "Speech round-trip"; 08): every text of corpus.json read by Qwen3-TTS and
// heard back by Whisper on this Mac, through the app's own endpoints of the compiled binary, against a
// throwaway data root whose models are an APFS clone of the real ones. Each text's words are scored by
// language — a mixed text's quoted words are the language learnt, the rest the learner's — as the share
// of the reference's words heard (the spoken check's word diff). Seeded synthesis and Whisper make it
// repeat. `bun run speech:check` (`SPEECH_LIMIT=n` for the first n texts).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { wordDiff } from "@sprachanker/engine";

const ROOT = join(tmpdir(), "sprachanker-speech");
const MODELS = process.env.SPRACHANKER_MODELS ?? join(homedir(), "SprachAnker", "models");
const PORT = 4592;
const BASE = `http://127.0.0.1:${PORT}`;
const binary = resolve(import.meta.dirname, "../../apps/cli/dist/sprachanker");

interface Text {
  lesson: string;
  edition: string;
  kind: "target" | "mixed";
  text: string;
}
const corpus = JSON.parse(
  readFileSync(new URL("./corpus.json", import.meta.url), "utf8"),
) as Text[];
const limit = Number(process.env.SPEECH_LIMIT ?? corpus.length);
/** Which texts: `target`, `mixed`, or all. */
const kind = process.env.SPEECH_KIND;
/** How a mixed text is asked for (to compare): `auto` (its languages told, the model telling them
 *  apart; the app's way), `learner` or `target` (the whole text in that language). */
const mixedAs = process.env.SPEECH_MIXED_AS ?? "auto";

/** A WAV's PCM (16-bit mono) and rate. */
function pcmOf(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let rate = 0;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = String.fromCharCode(...wav.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") rate = view.getUint32(at + 12, true);
    if (id === "data")
      return {
        rate,
        samples: new Int16Array(
          wav.buffer.slice(wav.byteOffset + at + 8, wav.byteOffset + at + 8 + size),
        ),
      };
    at += 8 + size + (size % 2);
  }
  throw new Error("no data in the WAV");
}

/** A 16 kHz WAV of the PCM (linear interpolation): what the recogniser takes. */
function to16k(wav: Uint8Array): Uint8Array<ArrayBuffer> {
  const { rate, samples } = pcmOf(wav);
  const n = Math.floor((samples.length * 16000) / rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / 16000;
    const a = samples[Math.floor(x)] ?? 0;
    const b = samples[Math.min(Math.floor(x) + 1, samples.length - 1)] ?? a;
    out[i] = Math.round(a + (b - a) * (x - Math.floor(x)));
  }
  const head = new DataView(new ArrayBuffer(44));
  const str = (at: number, s: string) => {
    for (const [i, c] of [...s].entries()) head.setUint8(at + i, c.charCodeAt(0));
  };
  str(0, "RIFF");
  head.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, 16000, true);
  head.setUint32(28, 32000, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  str(36, "data");
  head.setUint32(40, n * 2, true);
  const file = new Uint8Array(44 + n * 2);
  file.set(new Uint8Array(head.buffer), 0);
  file.set(new Uint8Array(out.buffer), 44);
  return file;
}

/** A text's words by language: a mixed one's quoted words the language learnt, the rest the learner's. */
function parts(t: Text): Record<string, string> {
  const [learner, target] = t.edition.split("-") as [string, string];
  if (t.kind === "target") return { [target]: t.text };
  const quoted = [...t.text.matchAll(/[«"“„]([^»"”“]+)[»"”“]/g)].map((m) => m[1]).join(" ");
  const rest = t.text.replace(/[«"“„][^»"”“]+[»"”“]/g, " ");
  return { [learner]: rest, [target]: quoted };
}

/** The share of the reference's words heard (words heard joined or split count as said). */
function heard(lang: string, reference: string, transcript: string) {
  const { diff } = wordDiff(lang, reference, transcript, true);
  const words = diff.reduce((n, d) => n + (d.expected ? d.expected.split(" ").length : 0), 0);
  const said = diff.reduce(
    (n, d) => n + (d.op === "equal" ? (d.expected ?? "").split(" ").length : 0),
    0,
  );
  return words ? said / words : 1;
}

// The data root: the models cloned, nothing else.
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
if (!existsSync(MODELS)) throw new Error(`no models at ${MODELS} (set SPRACHANKER_MODELS)`);
execFileSync("cp", ["-c", "-R", MODELS, join(ROOT, "models")]);
const server = spawn(binary, ["serve", "--port", String(PORT), "--data", ROOT], {
  stdio: "ignore",
  cwd: tmpdir(),
});
try {
  for (let i = 0; i < 50 && !(await fetch(`${BASE}/api/health`).catch(() => undefined))?.ok; i++)
    await new Promise((r) => setTimeout(r, 200));
  const made = await fetch(`${BASE}/api/profiles`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sprachanker": "1" },
    body: JSON.stringify({ name: "Speech" }),
  });
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const headers = { "content-type": "application/json", "x-sprachanker": "1", cookie };
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ key: "speech.readEngine", value: "qwen" }),
  });

  const rows: Array<{ t: Text; scores: Record<string, number>; heardAs: Record<string, string> }> =
    [];
  for (const t of corpus.filter((t) => !kind || t.kind === kind).slice(0, limit)) {
    const own = parts(t);
    const langs = Object.keys(own);
    const [learner, target] = t.edition.split("-") as [string, string];
    const lang = t.kind === "target" || mixedAs === "target" ? target : learner;
    const res = await fetch(`${BASE}/api/speech/say`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: t.text,
        lang,
        ...(t.kind === "mixed" && mixedAs === "auto" && { langs }),
      }),
    });
    if (!res.ok) throw new Error(`say ${res.status}: ${t.text}`);
    const wav = to16k(new Uint8Array(await res.arrayBuffer()));
    const scores: Record<string, number> = {};
    const heardAs: Record<string, string> = {};
    for (const l of langs) {
      const r = await fetch(`${BASE}/api/speech/transcribe?lang=${l}`, {
        method: "POST",
        headers: { "content-type": "audio/wav", "x-sprachanker": "1", cookie },
        body: wav,
      });
      heardAs[l] = ((await r.json()) as { text: string }).text;
      scores[l] = heard(l, own[l] as string, heardAs[l]);
    }
    rows.push({ t, scores, heardAs });
    const shown = Object.entries(scores)
      .map(([l, s]) => `${l} ${Math.round(s * 100)}%`)
      .join(" · ");
    console.log(`${t.kind.padEnd(6)} ${t.edition}  ${shown.padEnd(18)} ${t.text}`);
  }
  writeFileSync(join(ROOT, "results.json"), JSON.stringify(rows, null, 2));

  // How it went, by edition, kind and language: the median and the lowest share of words heard.
  const groups = new Map<string, number[]>();
  for (const r of rows)
    for (const [l, s] of Object.entries(r.scores)) {
      const k = `${r.t.edition} ${r.t.kind} ${l}`;
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const failures: string[] = [];
  console.log("\nedition kind lang: median · lowest · texts");
  for (const [k, xs] of [...groups].sort()) {
    const m = median(xs);
    console.log(
      `${k}: ${Math.round(m * 100)}% · ${Math.round(Math.min(...xs) * 100)}% · ${xs.length}`,
    );
    // What is said in a text's own language is heard almost whole; a language quoted in another's,
    // a word or two, less surely.
    const quoted = k.includes("mixed") && !k.endsWith(` ${k.split(" ")[0]?.split("-")[0]}`);
    if (m < (quoted ? 0.6 : 0.85)) failures.push(`${k}: median ${Math.round(m * 100)}%`);
  }
  console.log(`\nresults: ${join(ROOT, "results.json")}`);
  if (failures.length) {
    console.error(`\nbelow the bar:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  server.kill();
}
