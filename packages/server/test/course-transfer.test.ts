// A course moved as a bundle (02, "Course bundle"): exported from one data root and imported into
// another — installed, verified, its lessons played, its media deduped —, a bundle of a course already
// there found the same or replacing it with the learner's progress kept, and every file that is not a
// sound bundle refused with nothing left behind.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ulid } from "ulid";
import { withSeriesLock } from "../src/providers.ts";
import { courseTransferFiles } from "../src/runtime/course-transfer.ts";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const COURSE = "sprachanker.fixture/demo";
// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
const read = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Api = Awaited<ReturnType<typeof setup>>;

/** The demo course exported (`edition`: that edition's only): what the export said, and the file. */
async function exported(api: Api, edition?: string) {
  const ready = await read(
    api.send("POST", "/api/courses/export", { series: FIXTURE_SERIES, course: "demo", edition }),
  );
  const res = await api.get(`/api/courses/export/${ready.id}`);
  expect(res.status).toBe(200);
  return { ready, res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A bundle imported, its length told (as the web client's upload tells it). */
const importInto = (
  api: Api,
  body: Uint8Array | ReadableStream<Uint8Array>,
  length = body instanceof Uint8Array ? body.length : 0,
) =>
  api.get("/api/courses/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(length),
      ...CLIENT_HEADERS,
    },
    body,
  });

/** A bundle changed: its files, its manifest; the hashes listed made right again unless
 *  `keepHashes`. */
function repack(
  bytes: Uint8Array,
  change: {
    files?: (files: Record<string, Uint8Array>) => void;
    // biome-ignore lint/suspicious/noExplicitAny: a manifest changed at will.
    manifest?: (manifest: any) => void;
    keepHashes?: boolean;
  },
) {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array));
  delete files["manifest.json"];
  change.files?.(files);
  change.manifest?.(manifest);
  if (!change.keepHashes)
    manifest.files = manifest.files.map((f: { path: string }) => {
      const data = files[f.path] as Uint8Array;
      return { path: f.path, size: data.length, sha256: sha256(data) };
    });
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files }, { level: 0 });
}

/** The library's files under the series (the transfers aside), as `path → content`. */
function libraryOf(api: Api) {
  const series = join(api.root, "library", FIXTURE_SERIES);
  if (!existsSync(series)) return {};
  return Object.fromEntries(
    (readdirSync(series, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
      .filter((d) => d.isFile())
      .map((d) => {
        const file = join(d.parentPath, d.name);
        return [file.slice(series.length + 1), sha256(readFileSync(file))];
      }),
  );
}

/** Nothing of a refused import left: the library as it was, no transfer. */
function nothingLeft(api: Api, before: Record<string, string>) {
  expect(libraryOf(api)).toEqual(before);
  const transfers = join(api.root, "library", ".transfers");
  expect(existsSync(transfers) ? readdirSync(transfers) : []).toEqual([]);
}

test("a course exported and imported into another data root: installed, verified, its lessons played", async () => {
  const a = await setup();
  const { ready, res, bytes } = await exported(a);
  expect(ready.fileName).toMatch(
    /^sprachanker\.fixture-demo-en-de\+ru-de-\d{4}-\d{2}-\d{2}\.sprachanker-course$/,
  );
  expect(ready.editions).toEqual(["en-de", "ru-de"]);
  expect(Number(res.headers.get("content-length"))).toBe(ready.bytes);
  expect(bytes.length).toBe(ready.bytes);
  expect(res.headers.get("content-disposition")).toContain(ready.fileName);
  // Downloaded once; the transfer gone with it.
  expect((await a.get(`/api/courses/export/${ready.id}`)).status).toBe(404);
  expect(readdirSync(join(a.root, "library", ".transfers"))).toEqual([]);
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array));
  expect(manifest).toMatchObject({
    format: "sprachanker-course",
    version: 1,
    course: COURSE,
    kind: "course",
    provider: null,
  });
  expect(Object.keys(files).filter((p) => p.startsWith("raw/"))).toEqual([]);
  expect(Object.keys(files).some((p) => p.startsWith("media/"))).toBe(true);

  const b = await setup({ empty: true });
  expect(await read(b.get("/api/courses"))).toEqual([]);
  const result = await read(importInto(b, bytes));
  expect(result).toMatchObject({
    course: { key: COURSE, kind: "course", editions: ["en-de", "ru-de"] },
    status: "added",
    check: { problems: 0, missing: 0 },
  });
  expect(result.media.kept).toBe(0);
  expect((await read(b.get("/api/courses"))).map((c: { key: string }) => c.key)).toEqual([COURSE]);
  const { lesson, locale } = await read(
    b.get(`/api/lesson?series=${FIXTURE_SERIES}&key=${LESSON}&edition=ru-de`),
  );
  expect([lesson.key, locale.edition]).toEqual([LESSON, "ru-de"]);
  const { run } = await b.sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  expect(run.status).toBe("active");
  // Its media served from the library.
  const media = Object.keys(files).find((p) => p.startsWith("media/")) as string;
  expect((await b.get(`/library/${FIXTURE_SERIES}/${media}`)).status).toBe(200);
  expect(readdirSync(join(b.root, "library", ".transfers"))).toEqual([]);

  // The same again: nothing changed, every media file there already.
  const before = libraryOf(b);
  const again = await read(importInto(b, bytes));
  expect(again.status).toBe("same");
  expect(again.media).toEqual({ added: 0, kept: result.media.added });
  expect(libraryOf(b)).toEqual(before);
});

test("a bundle whose content differs replaces the course; the learner's progress stays", async () => {
  const a = await setup();
  const b = await setup();
  // Progress in B: a lesson begun, an item answered.
  const { run } = await b.sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  await b.sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [
      { id: ulid(), type: "page_shown", payload: { pageIndex: 0 } },
      {
        id: ulid(),
        type: "answered",
        itemKey: `${LESSON}/ex-01#1`,
        payload: { answer: { optionId: "a" }, attempt: 1, ms: 900 },
      },
    ],
  });
  // A's course as the same bundle: the same.
  expect((await read(importInto(b, (await exported(a, "ru-de")).bytes))).status).toBe("same");
  // A's ru-de title changed at the source: replaced.
  const title = join(a.root, "library", FIXTURE_SERIES, "locale/ru-de/demo/course.json");
  const text = readFileSync(title, "utf8");
  const changed = JSON.parse(text);
  changed.title = `${changed.title} 2`;
  writeFileSync(title, JSON.stringify(changed, null, 1));
  const result = await read(importInto(b, (await exported(a, "ru-de")).bytes));
  expect(result).toMatchObject({ status: "replaced", check: { problems: 0, missing: 0 } });
  const courses = await read(b.get("/api/courses"));
  expect(courses[0].titles["ru-de"]).toBe(changed.title);
  // Its other edition stays; the run goes on where it was.
  expect(courses[0].editions).toEqual(["en-de", "ru-de"]);
  const { state } = await read(
    b.get(`/api/runs/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}`),
  );
  expect(state.run.id).toBe(run.id);
  expect(state.events.some((e: { type: string }) => e.type === "answered")).toBe(true);
});

test("a file that is no sound bundle is refused before anything is installed: nothing left", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  const refused = async (body: Uint8Array, status: number, error: string) => {
    const res = await importInto(b, body);
    expect([res.status, await read(res)]).toEqual([status, { error }]);
    nothingLeft(b, {});
  };
  // Not a zip; a zip of something else; a profile file's manifest; compressed entries.
  await refused(strToU8("hello"), 422, "not_a_course_bundle");
  await refused(zipSync({ "notes.txt": strToU8("x") }, { level: 0 }), 422, "not_a_course_bundle");
  await refused(
    zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "sprachanker-profile" })) }),
    422,
    "not_a_course_bundle",
  );
  await refused(zipSync(unzipSync(bytes), { level: 6 }), 422, "not_a_course_bundle");
  // Paths a bundle may not hold: walking out, another folder.
  for (const path of [
    "../escape.json",
    "media/audio/../../../escape.mp3",
    "canonical/demo/../../x.json",
    "profiles/local/profile.sqlite",
  ])
    await refused(
      repack(bytes, { files: (f) => Object.assign(f, { [path]: strToU8("x") }) }),
      422,
      "not_a_course_bundle",
    );
  // A file changed after it was made; one listed that is not there; one there not listed.
  const lessonFile = "canonical/demo/lessons/00-01.json";
  await refused(
    repack(bytes, {
      files: (f) => Object.assign(f, { [lessonFile]: strToU8("{}") }),
      keepHashes: true,
    }),
    422,
    "course_bundle_damaged",
  );
  await refused(
    repack(bytes, { files: (f) => delete f[lessonFile], keepHashes: true }),
    422,
    "course_bundle_damaged",
  );
  // Consistent, yet not a lesson: hashes right, its schema not.
  await refused(
    repack(bytes, { files: (f) => Object.assign(f, { [lessonFile]: strToU8("{}") }) }),
    422,
    "course_bundle_damaged",
  );
  // A media file no file of it names.
  await refused(
    repack(bytes, { files: (f) => Object.assign(f, { "media/video/extra.mp4": strToU8("x") }) }),
    422,
    "course_bundle_damaged",
  );
  // From a newer app.
  await refused(
    repack(bytes, { manifest: (m) => Object.assign(m, { version: 99 }) }),
    422,
    "course_bundle_from_newer_app",
  );
});

test("names the disk refuses (a file where a folder would be) are the bundle's damage, not the server's fault", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  const res = await importInto(
    b,
    repack(bytes, {
      files: (f) =>
        Object.assign(f, {
          "raw/ru-de/demo/x.html": strToU8("x"),
          "raw/ru-de/demo/x.html/y.html": strToU8("y"),
        }),
    }),
  );
  expect([res.status, await read(res)]).toEqual([422, { error: "course_bundle_damaged" }]);
  nothingLeft(b, {});
});

test("an export does not wait for a download of its series: it says so", async () => {
  const a = await setup();
  let release = () => {};
  const held = withSeriesLock(
    join(a.root, "library"),
    FIXTURE_SERIES,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Bun.sleep(10);
  const busy = await a.send("POST", "/api/courses/export", {
    series: FIXTURE_SERIES,
    course: "demo",
  });
  expect([busy.status, await read(busy)]).toEqual([409, { error: "series_busy" }]);
  release();
  await held;
  expect(
    (await a.send("POST", "/api/courses/export", { series: FIXTURE_SERIES, course: "demo" }))
      .status,
  ).toBe(200);
  // A series that is not one: not installed, and no folder made for it.
  const absent = await a.send("POST", "/api/courses/export", { series: "no.such", course: "demo" });
  expect(absent.status).toBe(404);
  expect(existsSync(join(a.root, "library", "no.such"))).toBe(false);
});

test("a zip's directory is believed only as far as it is checked: entries overlapping", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  // Two directory entries naming the same bytes: the second points into the first one's data.
  const buffer = Buffer.from(bytes);
  const endAt = buffer.length - 22;
  const dirAt = buffer.readUInt32LE(endAt + 16);
  // The manifest's entry is first, at 0; the second entry pointed at it too.
  let p = dirAt;
  p += 46 + buffer.readUInt16LE(p + 28) + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  buffer.writeUInt32LE(0, p + 42);
  const res = await importInto(b, new Uint8Array(buffer));
  expect([res.status, await read(res)]).toEqual([422, { error: "not_a_course_bundle" }]);
  nothingLeft(b, {});
});

test("two names one file on a disk that does not tell case or Unicode forms apart: refused before a byte is unpacked", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  const media = Object.keys(unzipSync(bytes)).find((p) => p.startsWith("media/audio/")) as string;
  const upper = media.replace(/[^/]+$/, (name) => name.toUpperCase().replace(/\.MP3$/, ".mp3"));
  for (const alias of [upper, media.normalize("NFD") === media ? null : media.normalize("NFD")]) {
    if (!alias) continue;
    const res = await importInto(
      b,
      repack(bytes, { files: (f) => Object.assign(f, { [alias]: strToU8("other") }) }),
    );
    expect([res.status, await read(res)]).toEqual([422, { error: "not_a_course_bundle" }]);
  }
  nothingLeft(b, {});
});

test("a media file the library has under its name with other content stops the import", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const files = unzipSync(bytes);
  const media = Object.keys(files).find((p) => p.startsWith("media/")) as string;
  const b = await setup({
    empty: true,
    editLibrary: (library) => {
      const file = join(library, FIXTURE_SERIES, media);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "other content");
    },
  });
  const before = libraryOf(b);
  const res = await importInto(b, bytes);
  expect([res.status, await read(res)]).toEqual([409, { error: "course_bundle_clash" }]);
  nothingLeft(b, before);
});

test("an upload's length is told first; a bundle too large is refused before a byte is read", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  const unannounced = await b.get("/api/courses/import", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...CLIENT_HEADERS },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  expect([unannounced.status, await read(unannounced)]).toEqual([
    411,
    { error: "length_required" },
  ]);
  const huge = await importInto(b, bytes, 17 * 1024 ** 3);
  expect([huge.status, await read(huge)]).toEqual([413, { error: "course_bundle_too_large" }]);
  // More than announced.
  const more = await importInto(b, bytes, bytes.length - 10);
  expect([more.status, await read(more)]).toEqual([413, { error: "course_bundle_too_large" }]);
  nothingLeft(b, {});
});

test("a full disk: the export and the import say so and leave nothing behind", async () => {
  const GB = 1024 ** 3;
  const a = await setup();
  const { bytes } = await exported(a);
  const tight = await setup({
    empty: true,
    courseTransfers: (root) =>
      courseTransferFiles(root, { disk: () => ({ free: 0.5 * GB, size: 10 * GB }) }),
  });
  const res = await importInto(tight, bytes);
  expect([res.status, await read(res)]).toEqual([507, { error: "not_enough_space" }]);
  nothingLeft(tight, {});
  // An export links the course's files: it needs no room of its own (a copy, where the disk has no
  // hard links, has its room checked).
  const linking = await setup({
    courseTransfers: (root) =>
      courseTransferFiles(root, { disk: () => ({ free: 0.5 * GB, size: 10 * GB }) }),
  });
  expect(
    (await linking.send("POST", "/api/courses/export", { series: FIXTURE_SERIES, course: "demo" }))
      .status,
  ).toBe(200);
  // A course or edition not here.
  const absent = await a.send("POST", "/api/courses/export", {
    series: FIXTURE_SERIES,
    course: "demo",
    edition: "fr-de",
  });
  expect([absent.status, await read(absent)]).toEqual([404, { error: "not_installed" }]);
});

test("an upload that stalls ends: the next import is let in", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({
    empty: true,
    courseTransfers: (root) => courseTransferFiles(root, { uploadIdleMs: 50 }),
  });
  const stalled = await importInto(
    b,
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 100));
      },
    }),
    bytes.length,
  );
  expect([stalled.status, await read(stalled)]).toEqual([408, { error: "upload_stalled" }]);
  expect((await read(importInto(b, bytes))).status).toBe("added");
});

test("one import at a time", async () => {
  const a = await setup();
  const { bytes } = await exported(a);
  const b = await setup({ empty: true });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = importInto(
    b,
    new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(bytes.slice(0, 100));
        await held;
        controller.enqueue(bytes.slice(100));
        controller.close();
      },
    }),
    bytes.length,
  );
  await Bun.sleep(20);
  const busy = await importInto(b, bytes);
  expect([busy.status, await read(busy)]).toEqual([409, { error: "course_import_busy" }]);
  release();
  expect((await read(slow)).status).toBe("added");
});

test("a course folder an install stopped midway left aside comes back when its transfer is swept", async () => {
  const b = await setup();
  const transfers = courseTransferFiles(b.root);
  const id = transfers.begin();
  const series = join(b.root, "library", FIXTURE_SERIES);
  const aside = join(b.root, "library", ".transfers", id, "aside", FIXTURE_SERIES, "canonical");
  mkdirSync(aside, { recursive: true });
  renameSync(join(series, "canonical/demo"), join(aside, "demo"));
  const then = new Date(Date.now() - 2 * 60 * 60_000);
  utimesSync(join(b.root, "library", ".transfers", id), then, then);
  // Another process's sweep (this one knows the transfer as its own).
  courseTransferFiles(b.root).sweep();
  expect(existsSync(join(series, "canonical/demo/course.json"))).toBe(true);
  expect(readdirSync(join(b.root, "library", ".transfers"))).toEqual([]);
  expect((await read(b.get("/api/courses"))).length).toBe(1);
});

test("an install the process stopped midway is undone at the start, however new: media, folders and the series' files as they were", async () => {
  const b = await setup();
  const before = libraryOf(b);
  const series = join(b.root, "library", FIXTURE_SERIES);
  const id = courseTransferFiles(b.root).begin();
  const aside = join(b.root, "library", ".transfers", id, "aside");
  const kept = join(aside, FIXTURE_SERIES);
  // Stopped after everything but the end: a picture placed, the course's index folder replaced, the
  // key map rewritten.
  mkdirSync(join(kept, "canonical"), { recursive: true });
  renameSync(join(series, "canonical/demo"), join(kept, "canonical/demo"));
  cpSync(join(kept, "canonical/demo"), join(series, "canonical/demo"), { recursive: true });
  rmSync(join(series, "canonical/demo/lessons/00-01.json"));
  writeFileSync(join(series, "media/image/new.png"), "placed");
  const keys = join(series, "keys.json");
  if (existsSync(keys)) cpSync(keys, join(kept, "keys.json"));
  writeFileSync(keys, "{}");
  writeFileSync(
    join(aside, "install.json"),
    JSON.stringify({
      series: FIXTURE_SERIES,
      placed: ["media/image/new.png"],
      folders: [{ prefix: "canonical/demo", had: true }],
      state: ["keys.json"],
    }),
  );
  await courseTransferFiles(b.root).recover();
  expect(libraryOf(b)).toEqual(before);
  expect(existsSync(join(aside, "install.json"))).toBe(false);
});
