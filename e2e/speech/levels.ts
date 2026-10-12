// Speech levels: what the app hears of short answers said at four levels
// and of silence and noise — the measurements behind the server's silence thresholds
// (packages/server/src/services/silence.ts), taken again whenever whisper.cpp changes
// (native/whisper/VERSION): its log probabilities are its own computation. German answers read by
// Piper and Qwen3-TTS, and the recordings in `SPEECH_LEVELS_WAVS` (a folder with index.json:
// [{ id, who, text }] and <id>.wav — the owner's own takes or a course's, never committed), each at
// ×1, ×0.3, ×0.18, ×0.1; noise, breathing, hum, a click and a tap `SPEECH_TRIES` times (4). Through
// the compiled binary on a throwaway data root (models cloned). A take the page itself drops (never
// above -50 dBFS) is not sent. Fails when a phrase is not heard, or noise is heard as words.
// `bun run speech:levels`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRoot, samples16k, speechApp, wav16k } from "./app.ts";

const PORT = 4591;
const LEVELS = [1, 0.3, 0.18, 0.1];
const TRIES = Number(process.env.SPEECH_TRIES ?? 4);
const ANSWERS = [
  "Ja.",
  "Gut.",
  "Ich.",
  "Acht.",
  "Danke.",
  "Tschüss.",
  "Vielen Dank.",
  "Bis zum nächsten Mal.",
  "Ich heiße Nico.",
  "Ich möchte bitte einen Kaffee mit Milch.",
];

/** Peak in dBFS (10 ms windows) and ms at -50 dBFS and above; `dropped`: the page sends it not. */
function level(s: Float32Array) {
  const w = 160;
  let peak = 0;
  let loud = 0;
  for (let i = 0; i + w <= s.length; i += w) {
    let sum = 0;
    for (let k = i; k < i + w; k++) sum += (s[k] as number) ** 2;
    const rms = Math.sqrt(sum / w);
    peak = Math.max(peak, rms);
    if (rms >= 0.00316) loud += 10;
  }
  return {
    db: peak ? (20 * Math.log10(peak)).toFixed(1) : "-inf",
    ms50: loud,
    dropped: peak < 0.00316,
  };
}

const gauss = () => {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};
const rate = 16000;
const mk = (sec: number, f: (i: number) => number) =>
  Float32Array.from({ length: sec * rate }, (_, i) => f(i));
const breath = (amp: number) => {
  let lp = 0;
  return (i: number) => {
    const t = (i / rate) % 2;
    const env =
      t < 0.8 ? Math.sin((Math.PI * t) / 0.8) : 0.6 * Math.sin((Math.PI * (t - 0.8)) / 1.2);
    lp = 0.7 * lp + 0.3 * gauss();
    return amp * env * lp;
  };
};
const pink = (amp: number) => {
  let [b0, b1, b2] = [0, 0, 0];
  return () => {
    const w = gauss();
    b0 = 0.997 * b0 + 0.029591 * w;
    b1 = 0.985 * b1 + 0.032534 * w;
    b2 = 0.95 * b2 + 0.048056 * w;
    return amp * (b0 + b1 + b2 + 0.05 * w) * 3;
  };
};
const NOISE: Array<[string, () => Float32Array]> = [
  ["digital silence 3 s", () => mk(3, () => 0)],
  ["faint noise -50 dBFS 4 s", () => mk(4, () => 0.00316 * gauss())],
  ["noise -42 dBFS 4 s", () => mk(4, () => 0.008 * gauss())],
  ["noise -38 dBFS 4 s", () => mk(4, () => 0.0126 * gauss())],
  ["noise -34 dBFS 4 s", () => mk(4, () => 0.02 * gauss())],
  ["white -25 dBFS 3 s", () => mk(3, () => 0.056 * gauss())],
  ["pink ~-32 dBFS 4 s", () => mk(4, pink(0.006))],
  ["pink ~-23 dBFS 4 s", () => mk(4, pink(0.015))],
  ["breathing medium 4 s", () => mk(4, breath(0.03))],
  ["breathing close 4 s", () => mk(4, breath(0.08))],
  ["hum 50 Hz -40 dBFS 4 s", () => mk(4, (i) => 0.014 * Math.sin((2 * Math.PI * 50 * i) / rate))],
  ["click 5 ms 3 s", () => mk(3, (i) => (i > 8000 && i < 8080 ? 0.5 * gauss() : 0.0005 * gauss()))],
  [
    "tap 160 ms 4 s",
    () =>
      mk(4, (i) => (i > 32000 && i < 34560 ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate) : 0)),
  ],
];

const app = await speechApp(checkRoot("sprachanker-speech-levels"), PORT);
const failures: string[] = [];
try {
  const takes: Array<{ who: string; text: string; s: Float32Array }> = [];
  for (const engine of ["piper", "qwen"]) {
    await app.set("speech.readEngine", engine);
    for (const text of ANSWERS) takes.push({ who: engine, text, s: await app.say(text, "de") });
  }
  const own = process.env.SPEECH_LEVELS_WAVS;
  if (own)
    for (const e of JSON.parse(readFileSync(join(own, "index.json"), "utf8")) as Array<{
      id: string;
      who: string;
      text: string;
    }>)
      takes.push({
        who: e.who,
        text: e.text,
        s: samples16k(readFileSync(join(own, `${e.id}.wav`))),
      });

  console.log("| voice | said | level | peak dBFS | ms ≥-50 | heard |\n|---|---|---|---|---|---|");
  for (const t of takes)
    for (const scale of LEVELS) {
      const s = t.s.map((x) => x * scale);
      const l = level(s);
      const heard = l.dropped ? "(page: nothing)" : await app.transcribe(wav16k(s), "de");
      const shown =
        typeof heard === "string" ? heard : heard.silent ? "∅ nothing" : JSON.stringify(heard.text);
      console.log(`| ${t.who} | ${t.text} | ×${scale} | ${l.db} | ${l.ms50} | ${shown} |`);
      if (typeof heard !== "string" && heard.silent)
        failures.push(`${t.who} "${t.text}" ×${scale}: nothing`);
    }

  console.log("\n| noise | try | peak dBFS | ms ≥-50 | heard |\n|---|---|---|---|---|");
  for (const [name, make] of NOISE)
    for (let k = 1; k <= TRIES; k++) {
      const s = make();
      const l = level(s);
      const heard = l.dropped ? undefined : await app.transcribe(wav16k(s), "de");
      const shown = !heard
        ? "(page: nothing)"
        : heard.silent
          ? "∅ nothing"
          : JSON.stringify(heard.text);
      console.log(`| ${name} | ${k} | ${l.db} | ${l.ms50} | ${shown} |`);
      if (heard && !heard.silent)
        failures.push(`${name} #${k}: heard ${JSON.stringify(heard.text)}`);
    }
} finally {
  app.stop();
}
if (failures.length) {
  console.error(`\n${failures.length} not as they should be:\n${failures.join("\n")}`);
  process.exitCode = 1;
}
