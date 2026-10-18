// The course preparation step hearing the source's answers: by itself after a course is installed (a
// bundle, a download, the server's start), waiting for a model and going on once one is downloaded,
// stopped and resumed across restarts, failures remembered.
import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { addHeard, openLibrary } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import { CLIENT_HEADERS, courseKey, type SeriesKey } from "@sprachanker/schema";
import { mediaBlob } from "../src/runtime/bun.ts";
import { createContent } from "../src/services/content.ts";
import type { CourseInstaller } from "../src/services/downloads.ts";
import { createHeard } from "../src/services/heard.ts";
import { createHearing } from "../src/services/hearing.ts";
import { createSpeech } from "../src/services/speech.ts";
import { setup } from "./setup.ts";
import { SAID, whisper } from "./speech-fakes.ts";
import { heardFiles } from "./storage.ts";
import { until } from "./until.ts";

const FRAMED = "media/audio/guten-abend-danke.mp3";
const MODEL = "large-v3-turbo-q5_0";
const STATE = `/api/course/heard?${new URLSearchParams({ series: FIXTURE_SERIES, course: "demo" })}`;
type Api = Awaited<ReturnType<typeof setup>>;
const heardFile = (root: string) => join(root, "library", FIXTURE_SERIES, "heard/demo.json");

/** The demo course as a bundle (its recordings never heard). */
async function bundle() {
  const a = await setup();
  const ready = await a.sendJson("POST", "/api/courses/export", {
    series: FIXTURE_SERIES,
    course: "demo",
  });
  return new Uint8Array(await (await a.get(`/api/courses/export/${ready.id}`)).arrayBuffer());
}
const importInto = (api: Api, body: Uint8Array) =>
  api.get("/api/courses/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
      ...CLIENT_HEADERS,
    },
    body,
  });

test("a course bundle imported without its answers heard: heard by itself, written into the course", async () => {
  const m = whisper(SAID);
  const b = await setup({ empty: true, speech: m.speech, fetch: m.fetch });
  expect((await importInto(b, await bundle())).status).toBe(200);
  await until(async () => (await b.getJson(STATE)).heard === 2);
  expect(await b.getJson(STATE)).toMatchObject({
    recordings: 2,
    heard: 2,
    failed: 0,
    missing: 0,
    waiting: false,
    stopped: false,
    job: { state: "done", total: 1, done: 1 },
  });
  await until(() => existsSync(heardFile(b.root)));
  expect(m.heard.sort()).toEqual(["guten-abend-danke.mp3", "hallo-guten-tag.mp3"]);
});

test("no speech model: the step waits, and goes on by itself once one is downloaded", async () => {
  const m = whisper(SAID, [], { installed: false });
  const b = await setup({ empty: true, speech: m.speech, fetch: m.fetch });
  await importInto(b, await bundle());
  await until(async () => (await b.getJson(STATE)).waiting);
  expect(await b.getJson(STATE)).toMatchObject({ recordings: 2, heard: 0, job: null });
  expect(m.heard).toEqual([]);
  await b.send("POST", `/api/speech/models/${MODEL}`, {});
  await until(async () => (await b.getJson(STATE)).heard === 2);
  expect((await b.getJson(STATE)).waiting).toBe(false);
});

test("a server that installs courses hears every installed one at its start, and a course again after its download", async () => {
  const m = whisper(SAID);
  const installer: CourseInstaller = {
    offers: () => [
      {
        series: FIXTURE_SERIES,
        id: "demo",
        course: "demo",
        title: "Demo",
        editions: [],
        approxBytes: 1,
      } as never,
    ],
    run: async () => ({ failedMedia: [], goneMedia: [], normalised: {} }),
    remove: async () => ({ files: 0, bytes: 0 }),
    unfinished: async () => [],
    storage: async () => ({ dataRoot: "/data", series: [], free: null }),
  };
  const api = await setup({ installer, speech: m.speech, fetch: m.fetch });
  // No request: the start's look.
  await until(() => existsSync(heardFile(api.root)));
  expect(m.heard.length).toBe(2);
  // Normalised again without them (a download): heard again once it ends.
  await until(async () => (await api.getJson(STATE)).job?.state === "done");
  rmSync(heardFile(api.root));
  await api.send("POST", "/api/downloads", { series: FIXTURE_SERIES, course: "demo" });
  await until(() => m.heard.length === 4);
  await until(() => existsSync(heardFile(api.root)));
});

/** The step over a data root as a server runs it (no HTTP): a restart is a new one on the same root. */
function step(root: string, m: ReturnType<typeof whisper>) {
  const library = openLibrary(nodeFs, join(root, "library"));
  const speech = createSpeech({ host: m.speech, fetch: m.fetch });
  const files = heardFiles(root);
  const heard = createHeard({
    library,
    content: createContent(library),
    speech,
    files,
    mediaBlob,
    now: () => 5,
    sleep: async () => {},
  });
  return createHearing({
    heard,
    files,
    model: () => speech.modelFor(undefined),
    courses: () => library.courses(),
    now: () => 7,
    pause: async () => {},
  });
}

test("restarted, the step hears what is left; a failure is remembered with its model, tried again on start", async () => {
  const { root } = await setup();
  // A first run heard one recording before the server stopped.
  await addHeard(nodeFs, join(root, "library"), FIXTURE_SERIES, {
    course: courseKey(FIXTURE_SERIES as SeriesKey, "demo"),
    lang: "de",
    recordings: {
      [FRAMED]: { text: "Guten Abend! Danke, gut. Und dir?", model: MODEL, heardAt: 1 },
    },
  });
  const first = whisper(SAID, ["hallo-guten-tag.mp3"]);
  const one = step(root, first);
  await one.sweep();
  await until(async () => (await one.state(FIXTURE_SERIES, "demo")).job?.state === "done");
  expect(first.heard).toEqual(["hallo-guten-tag.mp3"]);
  expect(await one.state(FIXTURE_SERIES, "demo")).toMatchObject({ heard: 1, failed: 1 });

  // Restarted: what failed with this model is not heard again by itself; the learner's start does.
  const second = whisper(SAID);
  const two = step(root, second);
  await two.sweep();
  expect(await two.state(FIXTURE_SERIES, "demo")).toMatchObject({ heard: 1, failed: 1, job: null });
  expect(second.heard).toEqual([]);
  await two.start(FIXTURE_SERIES, "demo");
  await until(async () => (await two.state(FIXTURE_SERIES, "demo")).heard === 2);
  expect(second.heard).toEqual(["hallo-guten-tag.mp3"]);
});

test("stopped, a course stays stopped across a restart until started again", async () => {
  const { root } = await setup();
  const one = step(root, whisper(SAID, [], { installed: false }));
  await one.sweep();
  expect((await one.state(FIXTURE_SERIES, "demo")).waiting).toBe(true);
  expect((await one.stop(FIXTURE_SERIES, "demo")).stopped).toBe(true);

  const m = whisper(SAID);
  const two = step(root, m);
  await two.sweep();
  await two.modelReady();
  expect(await two.state(FIXTURE_SERIES, "demo")).toMatchObject({ stopped: true, heard: 0 });
  expect(m.heard).toEqual([]);
  await two.start(FIXTURE_SERIES, "demo");
  await until(async () => (await two.state(FIXTURE_SERIES, "demo")).heard === 2);
  expect((await two.state(FIXTURE_SERIES, "demo")).stopped).toBe(false);
});
