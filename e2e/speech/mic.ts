// The microphone as a learner meets it: short German answers read by the app's voices, played as
// Chromium's microphone (`--use-file-for-fake-audio-capture`) into the page's own recorder — Settings
// → Speech's three-second test —, each take decoded and heard by Whisper. Each answer is played
// twice: at once, and after the exact silence a Mac's microphone gives while it starts (1.3 s of
// zeros, the owner's takes) with the answer said as soon as "recording" shows — the whole of it
// heard: the take's three seconds count from then. Fails when the
// take's first word differs from the answer's sent straight to Whisper (the voice and the recogniser
// are speech:check's; an answer not made out straight judges nothing), or "recording" shows while the microphone is still silent. Through the
// compiled binary on a throwaway data root (models cloned). `bun run speech:mic`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { checkRoot, speechApp, wav16k } from "./app.ts";

const PORT = 4593;
const ROOT = checkRoot("sprachanker-speech-mic");
const ANSWERS = ["Ja, gern.", "Danke, gut.", "Guten Tag.", "Nein, danke.", "Hallo Anna."];
/** The microphone's silence as it starts on a Mac (2026-10-12: 1.1–1.5 s). */
const WARM_UP = 1.3;
/** A quiet room once the microphone is live (-60 dBFS). */
const ROOM = 0.001;
/** Settings → Speech's test: three seconds; the file is longer, so it does not start again. */
const FILE_S = 4.5;
const RATE = 16000;

/** The answer from its first sound (the voices' own lead-in cut to 50 ms). */
function trimmed(s: Float32Array) {
  const at = s.findIndex((x) => Math.abs(x) > 0.003);
  return s.subarray(Math.max(0, at - 800));
}

/** The microphone's samples: `zeros` s of exact silence, `room` s of a quiet room, the answer,
 *  the room again. */
function microphone(answer: Float32Array, zeros: number, room: number) {
  const out = new Float32Array(FILE_S * RATE);
  const lead = Math.round((zeros + room) * RATE);
  for (let i = Math.round(zeros * RATE); i < out.length; i++)
    out[i] = ROOM * (Math.random() * 2 - 1);
  out.set(answer.subarray(0, out.length - lead), lead);
  return out;
}

const firstWord = (s: string) => (s.toLowerCase().match(/\p{L}+/u) ?? [""])[0] as string;

const app = await speechApp(ROOT, PORT);
const failures: string[] = [];
const files = join(ROOT, "mic");
mkdirSync(files, { recursive: true });
try {
  await fetch(`${app.base}/api/profile`, {
    method: "PUT",
    headers: app.headers,
    body: JSON.stringify({ onboarded: true }),
  });
  const cookie = app.headers.cookie.split("=");
  console.log(
    "| voice | said | heard straight | microphone | recording shown | heard |\n|---|---|---|---|---|---|",
  );
  for (const engine of ["piper", "qwen"]) {
    await app.set("speech.readEngine", engine);
    for (const text of ANSWERS) {
      const answer = trimmed(await app.say(text, "de"));
      const direct = await app.transcribe(wav16k(answer), "de");
      // A voice Whisper does not make out even straight (Qwen3-TTS's now and then) judges nothing.
      const unclear = firstWord(direct.text ?? "") !== firstWord(text);
      for (const [name, zeros, room] of [
        ["at once", 0, 0.15],
        ["warm-up", WARM_UP, 0.15],
      ] as const) {
        const file = join(files, `${engine}-${firstWord(text)}-${zeros}.wav`);
        writeFileSync(file, wav16k(microphone(answer, zeros, room)));
        const browser = await chromium.launch({
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${file}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        });
        try {
          const context = await browser.newContext();
          await context.addCookies([
            { name: cookie[0] as string, value: cookie.slice(1).join("="), url: app.base },
          ]);
          const page = await context.newPage();
          // The microphone opened and "recording" shown, as times on the page; the take kept.
          await page.addInitScript({
            content: `
              window.__mic = {};
              const open = MediaDevices.prototype.getUserMedia;
              MediaDevices.prototype.getUserMedia = async function (c) {
                const s = await open.call(this, c);
                window.__mic.opened = performance.now();
                return s;
              };
              const url = URL.createObjectURL;
              URL.createObjectURL = (b) => { if (b instanceof Blob && b.type.startsWith("audio")) window.__mic.take = b; return url(b); };
              new MutationObserver(() => {
                if (!window.__mic.shown && document.body?.innerText.includes("Say something"))
                  window.__mic.shown = performance.now();
              }).observe(document, { subtree: true, childList: true, characterData: true });`,
          });
          await page.goto(`${app.base}/settings`);
          await page.getByRole("tab", { name: "Speech" }).click();
          await page.getByRole("button", { name: "Record yourself" }).click();
          await page.waitForFunction(
            () => (window as never as { __mic: { take?: Blob } }).__mic.take,
            null,
            {
              timeout: 10_000,
            },
          );
          const got = await page.evaluate(async () => {
            const mic = (
              window as never as { __mic: { take: Blob; opened: number; shown?: number } }
            ).__mic;
            const data = await mic.take.arrayBuffer();
            const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(data);
            const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
            const src = off.createBufferSource();
            src.buffer = decoded;
            src.connect(off.destination);
            src.start();
            const out = await off.startRendering();
            return {
              samples: Array.from(out.getChannelData(0)),
              shownAfter: mic.shown === undefined ? undefined : (mic.shown - mic.opened) / 1000,
            };
          });
          const heard = await app.transcribe(wav16k(Float32Array.from(got.samples)), "de");
          const shown = got.shownAfter === undefined ? "never" : `${got.shownAfter.toFixed(2)} s`;
          console.log(
            `| ${engine} | ${text} | ${JSON.stringify(direct.text)}${unclear ? " (unclear)" : ""} | ${name} | ${shown} | ${heard.silent ? "∅ nothing" : JSON.stringify(heard.text)} |`,
          );
          if (unclear) continue;
          if (heard.silent || firstWord(heard.text ?? "") !== firstWord(direct.text ?? ""))
            failures.push(`${engine} "${text}" ${name}: heard ${JSON.stringify(heard.text ?? "")}`);
          if (zeros && (got.shownAfter ?? 0) < zeros - 0.2)
            failures.push(
              `${engine} "${text}" ${name}: recording shown at ${shown}, silent till ${zeros} s`,
            );
        } finally {
          await browser.close();
        }
      }
    }
  }
} finally {
  app.stop();
}
if (failures.length) {
  console.log(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nEvery first word heard.");
