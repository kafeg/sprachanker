// A Goethe exam's Sprechen held by voice in the browser, as a learner meets it (owner, 2026-10-18):
// the module begun on its exam's page (B1 first prepared, notes written), each Teil's script made,
// the examiner's and the partner's lines read aloud by the profile's voices, each of the learner's
// places SAID — the script's good line, every other one with a learner's mistake, read by the Mac's
// `say -v Anna` and played as the page's microphone into its own recorder —, heard by Whisper and
// kept; then the part rated by its criteria (practice: at once; a mock exam: handed in, each part's
// proposal asked on the result). Also a mock Schreiben (`EXAM_WRITE`), its texts typed from
// `EXAM_TEXTS` (a JSON of item key → text). Through the compiled binary on a throwaway data root:
// the Goethe exams an APFS clone of the library, normalised anew; Whisper's and Qwen3-TTS's models
// cloned. Writes `report.md` (each line as scripted, said and heard; each proposal) and screenshots
// of each state (`EXAM_SHOTS`). The Mac only, not in CI: `bun run speech:exam`.
// Env: EXAM_LEVELS (a1,a2,b1), EXAM_MODE (test | practice), EXAM_MODEL (fake, or
// <provider>:<model> — claude-code:sonnet), EXAM_BROWSER (chromium | webkit), EXAM_PHONE=1 (375 px),
// EXAM_UI (the interface's language: en), EXAM_OUT, EXAM_PORT (4920), EXAM_WRITE=1, EXAM_TEXTS.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Locator, type Page, webkit } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { FAKE_LLM_PORT } from "../fake-llm.ts";
import { checkRoot, speechApp } from "./app.ts";

const LEVELS = (process.env.EXAM_LEVELS ?? "a1,a2,b1").split(",");
const MODE = process.env.EXAM_MODE === "practice" ? "practice" : "test";
const MODEL = process.env.EXAM_MODEL ?? "fake";
const BROWSER = process.env.EXAM_BROWSER === "webkit" ? webkit : chromium;
const PHONE = process.env.EXAM_PHONE === "1";
const UI = process.env.EXAM_UI ?? "en";
const PORT = Number(process.env.EXAM_PORT ?? 4920);
const ROOT = checkRoot(`sprachanker-speech-exam-${PORT}`);
const OUT = process.env.EXAM_OUT ?? join(ROOT, "out");
const SHOTS = join(
  OUT,
  `shots-${process.env.EXAM_BROWSER ?? "chromium"}-${PHONE ? "phone" : "desktop"}`,
);
const WRITE = process.env.EXAM_WRITE === "1";
const LIBRARY = process.env.SPRACHANKER_LIBRARY ?? join(homedir(), "SprachAnker", "library");
const SERIES = "goethe.zertifikat";

/** The interface's strings, as the page shows them (`exams.conversation.start`). */
const catalog = JSON.parse(
  readFileSync(resolve(import.meta.dirname, `../../apps/web/src/i18n/${UI}.json`), "utf8"),
);
const L = (key: string, values: Record<string, string> = {}): string => {
  const text = key.split(".").reduce((o, k) => o?.[k], catalog) as unknown as string;
  if (typeof text !== "string") throw new Error(`no string ${key}`);
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);
};

/** Mistakes a learner says (heard as said: none of spelling), each made where it fits. */
const MISTAKES: Array<[RegExp, string]> = [
  [/\bich habe\b/i, "ich hat"],
  [/\bhabe ich\b/i, "hat ich"],
  [/\bich bin\b/i, "ich ist"],
  [/\bin der\b/, "in die"],
  [/\bmit dem\b/, "mit der"],
  [/\beinen\b/, "ein"],
  [/\bmöchte\b/, "möchten"],
  [/\bkann ich\b/, "ich kann"],
  [/\bgehe\b/, "gehen"],
  [/\bweil (\w+) (\w+)/, "weil $2 $1"],
];
/** The line with a learner's mistake, where one fits. */
function withMistake(text: string) {
  for (const [wrong, said] of MISTAKES) if (wrong.test(text)) return text.replace(wrong, said);
  return text;
}

/** A line read by the Mac's German voice: a 16 kHz WAV. */
function said(text: string, file: string) {
  execFileSync("say", [
    "-v",
    "Anna",
    "-o",
    file,
    "--data-format=LEI16@16000",
    "--file-format=WAVE",
    text,
  ]);
  return readFileSync(file);
}

// biome-ignore lint/suspicious/noExplicitAny: the API's replies as read back
type Json = any;
const report: string[] = [
  `# Goethe Sprechen by voice — ${MODE === "test" ? "mock exam" : "practice"}, ${MODEL}, ${process.env.EXAM_BROWSER ?? "chromium"}${PHONE ? " phone" : ""}`,
  "",
];
const log = (line: string) => {
  console.log(line);
  report.push(line);
};
const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  // A whole page where it is read as one (the preparation, the result); else the screen as the
  // learner has it (the part's newest lines in view).
  const whole = /preparation|result/.test(name);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: whole });
};

async function fakeModel(): Promise<ChildProcess | undefined> {
  if (MODEL !== "fake") return undefined;
  const fake = spawn("bun", [resolve(import.meta.dirname, "../fake-llm.ts")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    if ((await fetch(`http://127.0.0.1:${FAKE_LLM_PORT}/v1/models`).catch(() => undefined))?.ok)
      return fake;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the fake model did not start");
}

/** The page's microphone: what `__answer.wav` holds now, played as it opens, then a quiet room. */
const MICROPHONE = `
  if (typeof MediaDevices !== "undefined")
    MediaDevices.prototype.getUserMedia = async function () {
      const context = new AudioContext();
      void context.resume();
      const out = context.createMediaStreamDestination();
      const noise = context.createBufferSource();
      const room = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = room.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.001 * (Math.random() * 2 - 1);
      noise.buffer = room;
      noise.loop = true;
      noise.connect(out);
      noise.start();
      const wav = await (await fetch("/__answer.wav?" + Date.now())).arrayBuffer();
      if (wav.byteLength > 44) {
        const answer = context.createBufferSource();
        answer.buffer = await context.decodeAudioData(wav);
        answer.connect(out);
        answer.start(context.currentTime + 0.4);
        window.__playing = answer.buffer.duration;
      }
      return out.stream;
    };`;

async function main() {
  const fake = await fakeModel();
  const app = await speechApp(ROOT, PORT, {
    before(data) {
      // The Goethe exams cloned, and normalised by this build (each Teil's time, B1's preparation).
      mkdirSync(join(data, "library"), { recursive: true });
      execFileSync("cp", ["-c", "-R", join(LIBRARY, SERIES), join(data, "library")]);
      execFileSync(resolve(import.meta.dirname, "../../apps/cli/dist/sprachanker"), [
        "import",
        "goethe",
        "--data",
        data,
      ]);
    },
  });
  const failures: string[] = [];
  let browser: Browser | undefined;
  try {
    const api = async (method: string, path: string, body?: unknown): Promise<Json> => {
      const res = await fetch(`${app.base}${path}`, {
        method,
        headers: app.headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${await res.text()}`);
      return res.json();
    };
    await api("PUT", "/api/profile", { onboarded: true });
    await app.set("uiLanguage", UI);
    if (MODEL === "fake") {
      await api("PUT", "/api/llm/providers/custom", {
        baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
      });
      await api("PUT", "/api/llm/route", { provider: "custom", model: "fake-model" });
    } else {
      const [provider, model] = MODEL.split(":");
      await api("PUT", "/api/llm/route", { provider, model });
    }
    await api("PUT", "/api/settings", { key: "llm.offIn", value: [] });

    browser = await BROWSER.launch(
      BROWSER === chromium
        ? {
            args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
          }
        : {},
    );
    const context = await browser.newContext({
      ...(PHONE ? { viewport: { width: 375, height: 812 }, isMobile: BROWSER === chromium } : {}),
      ...(BROWSER === chromium && { permissions: ["microphone"] }),
    });
    const [name, ...value] = app.headers.cookie.split("=");
    await context.addCookies([{ name: name as string, value: value.join("="), url: app.base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.addInitScript({ content: MICROPHONE });
    // The take the microphone plays next.
    let answer: Buffer = Buffer.alloc(0);
    await page.route("**/__answer.wav*", (route) =>
      route.fulfill({ body: answer, contentType: "audio/wav" }),
    );
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
    // A proposal refused (the model's reply did not fit): not waited for.
    let refused = "";
    page.on("response", async (r) => {
      if (r.url().includes("/api/llm/exam-rating") && r.status() >= 400)
        refused = `${r.status()} ${await r.text().catch(() => "")}`;
    });
    const visible = (l: Locator) => l.filter({ visible: true }).first();
    const takes = join(OUT, "takes");
    mkdirSync(takes, { recursive: true });

    for (const level of LEVELS) {
      const exam = `${SERIES}/${level}/exam-modellsatz`;
      log(`\n## ${level.toUpperCase()}\n`);
      const modules = WRITE ? ["schreiben", "sprechen"] : ["sprechen"];
      for (const module of modules) {
        const { run } = await api("POST", "/api/exams/runs", {
          exam,
          edition: "de-de",
          mode: MODE,
          module,
        });
        await page.goto(`${app.base}/exam/${SERIES}/${level}/modellsatz/run/${run.id}`);
        const state = async () => api("GET", `/api/exams/runs/${run.id}`);
        if (module === "schreiben") {
          await writeTexts(page, run, level);
        } else {
          // B1: the preparation first — each Teil's task and a field for notes.
          const begin = page.getByRole("button", { name: L("exams.preparation.begin") });
          const items: string[] = run.plan.items;
          const regionOf = (n: number) =>
            page.getByRole("region", {
              name: L("exams.question")
                .replace("{n, number}", String(n + 1))
                .replace("{total, number}", String(items.length)),
            });
          await begin.or(regionOf(0)).first().waitFor({ timeout: 60_000 });
          if (await begin.isVisible()) {
            await shot(page, `${level}-0-preparation`);
            const fields = page.getByRole("textbox");
            for (let i = 0; i < (await fields.count()); i++)
              await fields.nth(i).fill(`Notizen ${i + 1}: Wann? Wo? Meine Meinung.`);
            await fields.first().blur();
            log("- preparation: shown, notes written, the parts begun");
            await begin.click();
          }
          for (const [n, itemKey] of items.entries()) {
            const teil = n + 1;
            log(`\n### ${level.toUpperCase()} Teil ${teil}\n`);
            const region = regionOf(n);
            await region.waitFor();
            const started = Date.now();
            await region.getByRole("button", { name: L("exams.conversation.start") }).click();
            // The script: its learner's places with the good lines.
            await region
              .getByRole("button", { name: L("speech.record") })
              .or(region.getByPlaceholder(L("scene.placeholder")))
              .first()
              .waitFor({ timeout: 300_000 });
            const scriptOf = async () =>
              (await state()).events.findLast(
                (e: Json) =>
                  e.type === "llm_verdict" &&
                  e.payload.task === "exam_part" &&
                  e.itemKey === itemKey,
              )?.payload;
            const script = await scriptOf();
            log(
              `- script: ${script.model}, ${Math.round(script.latencyMs / 1000)} s; partner ${script.result.partner?.name ?? "—"}`,
            );
            const places = script.result.lines.filter((l: Json) => l.speaker === "learner");
            if (teil === 1) await shot(page, `${level}-${teil}-a-begun`);
            for (const [p, place] of places.entries()) {
              const line = p % 2 ? withMistake(place.text) : place.text;
              const record = region.getByRole("button", { name: L("speech.record") });
              await record.waitFor({ timeout: 60_000 });
              // The others' lines read first, as a candidate listens before answering.
              await page
                .waitForFunction(() => !document.querySelector('[aria-pressed="true"]'), null, {
                  timeout: 120_000,
                })
                .catch(() => failures.push(`${level} T${teil}: a line still read after 2 min`));
              answer = said(line, join(takes, `${level}-${teil}-${p}.wav`));
              const seconds = (answer.length - 44) / 32000;
              await record.click();
              await page.waitForTimeout(seconds * 1000 + 1500);
              const stop = region.getByRole("button", { name: L("speech.stop") });
              if (await stop.isVisible()) await stop.click();
              const heard = region
                .getByText(L("speech.heard"))
                .locator("xpath=following-sibling::p[1]");
              await heard.waitFor({ timeout: 60_000 });
              const text = (await heard.textContent())?.trim() ?? "";
              if (p === 0) await shot(page, `${level}-${teil}-b-heard`);
              await region.getByRole("button", { name: L("talk.keep") }).click();
              log(
                `- ${place.hint ? `(${place.hint}) ` : ""}said: «${line}»${line !== place.text ? " (a mistake)" : ""} → heard: «${text}»`,
              );
              if (!text) failures.push(`${level} T${teil} line ${p + 1}: nothing heard`);
            }
            const lines = script.result.lines
              .map((l: Json) => `  - ${l.speaker}: ${l.text}`)
              .join("\n");
            log(`- the script:\n${lines}`);
            log(`- said through in ${Math.round((Date.now() - started) / 1000)} s`);
            await shot(page, `${level}-${teil}-c-said`);
            if (MODE === "practice") {
              await visible(
                page.getByRole("button", { name: L("lesson.check"), exact: true }),
              ).click();
              await proposal(itemKey, `${level}-${teil}`);
              await shot(page, `${level}-${teil}-d-rated`);
              if (n < items.length - 1)
                await visible(
                  page.getByRole("button", { name: L("exams.next"), exact: true }),
                ).click();
            } else if (n < items.length - 1)
              await visible(
                page.getByRole("button", { name: L("exams.next"), exact: true }),
              ).click();
          }
        }
        if (MODE === "test") {
          await visible(page.getByRole("button", { name: L("exams.handIn") })).click();
          const confirm = page
            .getByRole("alertdialog")
            .getByRole("button", { name: L("exams.handIn") });
          await page.waitForTimeout(1000);
          if (await confirm.isVisible()) await confirm.click();
          await page.getByRole("heading", { name: L("exams.rating.title") }).waitFor();
          const asks = page.getByRole("button", { name: L("exams.rating.propose") });
          for (const [n, itemKey] of (run.plan.items as string[]).entries()) {
            await asks.first().click();
            await proposal(itemKey, `${level} ${module} Teil ${n + 1}`);
          }
          await shot(page, `${level}-${module}-result`);
        }

        /** The part's proposal, as kept in the run: written to the report. */
        async function proposal(itemKey: string, what: string) {
          refused = "";
          for (let i = 0; i < 240; i++) {
            if (refused) {
              failures.push(`${what}: the proposal refused: ${refused.slice(0, 200)}`);
              log(`\n**Rating of ${what}**: refused (${refused.slice(0, 200)})`);
              return;
            }
            const kept = (await state()).events.findLast(
              (e: Json) =>
                e.type === "llm_verdict" && e.payload.task === "exam" && e.itemKey === itemKey,
            )?.payload;
            if (kept) {
              const r = kept.result;
              log(
                `\n**Rating of ${what}** (${kept.model}, ${Math.round(kept.latencyMs / 1000)} s):`,
              );
              for (const c of r.criteria) log(`- ${c.id}: ${c.points} — ${c.reason}`);
              for (const c of r.corrections ?? [])
                log(`- correction: «${c.wrong}» → «${c.right}» (${c.explanation})`);
              for (const p of r.points ?? []) log(`- point: ${p.score} — ${p.comment}`);
              if (r.modelText) log(`- model text: ${r.modelText}`);
              log(`- feedback: ${r.feedback}`);
              return;
            }
            await page.waitForTimeout(1000);
          }
          failures.push(`${what}: no proposal in 4 min`);
        }
      }
    }

    /** A Schreiben module's texts typed (EXAM_TEXTS: item key → text), each Teil in turn. */
    async function writeTexts(page: Page, run: Json, level: string) {
      const texts: Record<string, string> = process.env.EXAM_TEXTS
        ? JSON.parse(readFileSync(process.env.EXAM_TEXTS, "utf8"))
        : {};
      for (const [n, itemKey] of (run.plan.items as string[]).entries()) {
        const text = texts[itemKey];
        const box = visible(page.getByRole("textbox"));
        await box.waitFor({ timeout: 30_000 }).catch(() => {});
        if (text && (await box.isVisible())) {
          await box.fill(text);
          await box.blur();
          log(`\n### ${level.toUpperCase()} Schreiben Teil ${n + 1}\n\n${text}`);
        }
        if (n === 0) await shot(page, `${level}-schreiben-${n + 1}`);
        if (n < run.plan.items.length - 1)
          await visible(page.getByRole("button", { name: L("exams.next"), exact: true })).click();
      }
    }
  } finally {
    await browser?.close();
    app.stop();
    fake?.kill();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "report.md"), `${report.join("\n")}\n`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nHeld by voice. ${join(OUT, "report.md")}`);
}

if (!existsSync(join(LIBRARY, SERIES))) throw new Error(`no ${SERIES} in ${LIBRARY}`);
await main();
