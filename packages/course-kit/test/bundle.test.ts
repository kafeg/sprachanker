// Course bundles, the library's side: what a course's bundle holds, and a bundle unpacked beside
// another library checked and installed there — added, the same again, replaced, its media deduped.
import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COURSE_BUNDLE_FORMAT,
  COURSE_BUNDLE_VERSION,
  CourseBundleManifest,
  type CourseKey,
  courseIdOf,
  type ExamSources,
  MediaIndex,
  type PracticeLesson,
} from "@sprachanker/schema";
import {
  bundleGroups,
  checkBundle,
  contentVersions,
  courseBundleContent,
  installBundle,
  planBundle,
} from "../src/bundle.ts";
import { prettyJson } from "../src/canonical-json.ts";
import { hashFile } from "../src/files.ts";
import { NotInstalledError, openLibrary } from "../src/library.ts";
import { nodeFs } from "../src/node-fs.ts";
import { MINI_AUDIO, MINI_EXAM, MINI_SERIES, writeMiniLibrary } from "./mini-library.ts";

const COURSE = `${MINI_SERIES}/basic` as CourseKey;
const TWIN = `${MINI_SERIES}/twin` as CourseKey;
const dir = () => mkdtempSync(join(tmpdir(), "sprachanker-bundle-"));
const put = (file: string, data: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

/** The mini library with what an import keeps beside it: a media index (one line of another
 *  course's), a key map (a scope of another course), the exam's sources with the copy it was read
 *  from. */
async function library() {
  const root = dir();
  const series = await writeMiniLibrary(root);
  const sha = async (path: string) => (await hashFile(nodeFs, join(series, path))).sha256;
  const entry = async (path: string, kind: string, mime: string) => ({
    kind,
    path,
    sha256: await sha(path),
    size: statSync(join(series, path)).size,
    mime,
  });
  put(join(series, "media/audio/other.mp3"), "another course's");
  put(
    join(series, "media.json"),
    JSON.stringify({
      "https://example.org/hallo.mp3": await entry(MINI_AUDIO, "audio", "audio/mpeg"),
      "https://example.org/frage.png": await entry("media/image/frage.png", "image", "image/png"),
      "https://example.org/other.mp3": await entry("media/audio/other.mp3", "audio", "audio/mpeg"),
    }),
  );
  put(
    join(series, "keys.json"),
    JSON.stringify({ [`${COURSE}/u00`]: { "11": 1 }, [`${MINI_SERIES}/other/u00`]: { "7": 1 } }),
  );
  put(join(series, "raw/de-de/basic/quiz.pdf"), "the quiz as read");
  const sources: ExamSources = {
    format: 1,
    exam: MINI_EXAM,
    read: 1,
    documents: [
      {
        id: "quiz",
        title: "Quiz",
        url: "https://example.org/quiz.pdf",
        raw: "raw/de-de/basic/quiz.pdf",
        sha256: await sha("raw/de-de/basic/quiz.pdf"),
      },
    ],
    checks: [],
    items: Object.fromEntries(
      ["001", "002", "be-01"].map((q) => [`${MINI_EXAM}/q-${q}`, [{ document: "quiz", at: "1" }]]),
    ),
  };
  put(join(series, "canonical/basic/sources/quiz.json"), prettyJson(sources));
  return { root, series };
}

/** The bundle of courses (basic, unless others are named) as the server makes it, unpacked into a
 *  stage of its own (`files`, `aside`). */
async function bundled(root: string, editions?: string[], courses = ["basic"]) {
  const content = await courseBundleContent(nodeFs, root, MINI_SERIES, courses, editions);
  const stage = dir();
  const files: Array<{ path: string; sha256: string; size: number }> = [];
  for (const f of content.files) {
    cpSync(f.file, join(stage, "files", f.path));
    files.push({ path: f.path, ...(await hashFile(nodeFs, f.file)) });
  }
  const manifest = CourseBundleManifest.parse({
    format: COURSE_BUNDLE_FORMAT,
    version: COURSE_BUNDLE_VERSION,
    appVersion: "test",
    exportedAt: 1,
    courses: content.courses.map((c) => ({
      ...c,
      content: contentVersions(courseIdOf(c.course), c.editions, files),
    })),
    provider: null,
    media: content.media,
    keys: content.keys,
    files,
  });
  return { manifest, files: join(stage, "files"), aside: join(stage, "aside") };
}

/** The bundle's one course (the manifest's first). */
const only = (b: Awaited<ReturnType<typeof bundled>>) =>
  b.manifest.courses[0] as (typeof b.manifest.courses)[number];

async function install(root: string, bundle: Awaited<ReturnType<typeof bundled>>) {
  const plan = await planBundle(nodeFs, root, bundle.manifest);
  expect(plan.clash).toEqual([]);
  expect(await checkBundle(nodeFs, bundle.files, bundle.manifest)).toEqual([]);
  return { plan, ...(await installBundle({ fs: nodeFs, libraryRoot: root, ...bundle, plan })) };
}

test("a course's bundle: its files of the editions asked, the media they use, its exams' copies, its lines of media.json and keys.json", async () => {
  const { root } = await library();
  const all = await courseBundleContent(nodeFs, root, MINI_SERIES, ["basic"]);
  expect(all.courses.map((c) => c.course)).toEqual([COURSE]);
  expect(all.courses[0]?.editions).toEqual(["en-de", "ru-de"]);
  expect(all.courses[0]?.kind).toBe("course");
  expect(all.courses[0]?.titles).toEqual({ "en-de": "Mini", "ru-de": "Mini" });
  const one = await courseBundleContent(nodeFs, root, MINI_SERIES, ["basic"], ["ru-de"]);
  expect(one.files.map((f) => f.path)).toEqual([
    "canonical/basic/course.json",
    "canonical/basic/exams/quiz.json",
    "canonical/basic/lessons/00-01.json",
    "canonical/basic/sources/quiz.json",
    "locale/ru-de/basic/course.json",
    "locale/ru-de/basic/exams/quiz.json",
    "locale/ru-de/basic/lessons/00-01.json",
    MINI_AUDIO,
    "media/image/frage.png",
    "raw/de-de/basic/quiz.pdf",
  ]);
  expect(Object.keys(one.media).sort()).toEqual([
    "https://example.org/frage.png",
    "https://example.org/hallo.mp3",
  ]);
  expect(one.keys).toEqual({ [`${COURSE}/u00`]: { "11": 1 } });
  await expect(
    courseBundleContent(nodeFs, root, MINI_SERIES, ["basic"], ["fr-de"]),
  ).rejects.toBeInstanceOf(NotInstalledError);
  await expect(courseBundleContent(nodeFs, root, MINI_SERIES, ["nope"])).rejects.toBeInstanceOf(
    NotInstalledError,
  );
  await expect(courseBundleContent(nodeFs, root, MINI_SERIES, [])).rejects.toBeInstanceOf(
    NotInstalledError,
  );
});

test("a bundle installed into another library: verified whole, the series' state merged; the same again changes nothing", async () => {
  const { root } = await library();
  const other = dir();
  const otherSeries = join(other, MINI_SERIES);
  put(join(otherSeries, "keys.json"), JSON.stringify({ [`${MINI_SERIES}/x/u00`]: { "1": 1 } }));
  const first = await install(other, await bundled(root, ["ru-de"]));
  expect(first.courses).toEqual([{ course: COURSE, status: "added", variants: 0 }]);
  expect(first.media).toEqual({ added: 2, kept: 0 });
  const report = await openLibrary(nodeFs, other).check(MINI_SERIES, "basic");
  expect(report.problems).toEqual([]);
  expect(report.editions).toEqual(["ru-de"]);
  expect(report.media.missing).toBe(0);
  const media = MediaIndex.parse(JSON.parse(readFileSync(join(otherSeries, "media.json"), "utf8")));
  expect(Object.keys(media).sort()).toEqual([
    "https://example.org/frage.png",
    "https://example.org/hallo.mp3",
  ]);
  expect(JSON.parse(readFileSync(join(otherSeries, "keys.json"), "utf8"))).toEqual({
    [`${MINI_SERIES}/x/u00`]: { "1": 1 },
    [`${COURSE}/u00`]: { "11": 1 },
  });
  const again = await install(other, await bundled(root, ["ru-de"]));
  expect(again.courses).toEqual([{ course: COURSE, status: "same", variants: 0 }]);
  expect(again.media).toEqual({ added: 0, kept: 3 });
  // Another edition of it: added beside, the course's files the same.
  const en = await install(other, await bundled(root, ["en-de"]));
  expect(en.courses).toEqual([{ course: COURSE, status: "replaced", variants: 0 }]);
  expect(openLibrary(nodeFs, other).courses()[0]?.editions).toEqual(["en-de", "ru-de"]);
});

test("a bundle whose content differs replaces the course's folders whole; editions it does not carry stay", async () => {
  const { root, series } = await library();
  const other = dir();
  await install(other, await bundled(root));
  // A lesson file the source no longer has, in the library it goes to.
  const stale = join(other, MINI_SERIES, "canonical/basic/lessons/00-02.json");
  put(stale, "{}");
  const title = join(series, "locale/ru-de/basic/course.json");
  writeFileSync(title, readFileSync(title, "utf8").replace('"Mini"', '"Mini 2"'));
  const changed = await install(other, await bundled(root, ["ru-de"]));
  expect(changed.courses).toEqual([{ course: COURSE, status: "replaced", variants: 0 }]);
  expect(existsSync(stale)).toBe(false);
  const installed = openLibrary(nodeFs, other);
  expect((await installed.localeCourse(MINI_SERIES, "basic", "ru-de"))?.title).toBe("Mini 2");
  expect((await installed.localeCourse(MINI_SERIES, "basic", "en-de"))?.title).toBe("Mini");
  expect((await installed.check(MINI_SERIES, "basic")).problems).toEqual([]);
});

test("media already in the library are not unpacked: the same name skipped, the same content linked; other content under its name is a clash", async () => {
  const { root } = await library();
  const bundle = await bundled(root, ["ru-de"]);
  const other = dir();
  const otherSeries = join(other, MINI_SERIES);
  // The picture as it is, the recording under another name.
  cpSync(
    join(root, MINI_SERIES, "media/image/frage.png"),
    join(otherSeries, "media/image/frage.png"),
  );
  cpSync(join(root, MINI_SERIES, MINI_AUDIO), join(otherSeries, "media/audio/hallo-2.mp3"));
  const audio = bundle.manifest.files.find((f) => f.path === MINI_AUDIO);
  put(
    join(otherSeries, "media.json"),
    JSON.stringify({
      "https://example.org/elsewhere.mp3": {
        kind: "audio",
        path: "media/audio/hallo-2.mp3",
        sha256: audio?.sha256,
        size: audio?.size,
        mime: "audio/mpeg",
      },
    }),
  );
  const plan = await planBundle(nodeFs, other, bundle.manifest);
  expect([...plan.skip]).toEqual(["media/image/frage.png"]);
  expect([...plan.link]).toEqual([[MINI_AUDIO, "media/audio/hallo-2.mp3"]]);
  expect([...plan.unpack].filter((p) => !p.endsWith(".json"))).toEqual([
    "raw/de-de/basic/quiz.pdf",
  ]);
  const done = await installBundle({ fs: nodeFs, libraryRoot: other, ...bundle, plan });
  expect(done.media).toEqual({ added: 1, kept: 1 });
  expect(readFileSync(join(otherSeries, MINI_AUDIO), "utf8")).toBe("sprachanker-mini:hallo");

  const clashing = dir();
  put(join(clashing, MINI_SERIES, "media/image/frage.png"), "another picture");
  expect((await planBundle(nodeFs, clashing, bundle.manifest)).clash).toEqual([
    "media/image/frage.png",
  ]);
});

test("a bundle's files are checked before anything is installed: schemas, places, the course's own, media it uses", async () => {
  const { root } = await library();
  const problemsOf = async (change: (b: Awaited<ReturnType<typeof bundled>>) => void) => {
    const b = await bundled(root, ["ru-de"]);
    change(b);
    return checkBundle(nodeFs, b.files, b.manifest);
  };
  const lesson = "canonical/basic/lessons/00-01.json";
  expect(await problemsOf(() => {})).toEqual([]);
  // A field the schema does not know.
  expect(
    await problemsOf((b) => {
      const file = join(b.files, lesson);
      writeFileSync(file, readFileSync(file, "utf8").replace('"format": 1', '"format": 1, "x": 1'));
    }),
  ).toContain(`${lesson}: does not fit its schema`);
  // A lesson under another lesson's name.
  expect(
    await problemsOf((b) => {
      cpSync(join(b.files, lesson), join(b.files, "canonical/basic/lessons/00-02.json"));
      b.manifest.files.push({
        path: "canonical/basic/lessons/00-02.json",
        size: 0,
        sha256: "0".repeat(64),
      });
    }),
  ).toContain(
    "canonical/basic/lessons/00-02.json: not where its keys put it in the bundle's courses",
  );
  // Content versions that are not its files': "the same" would be believed wrongly.
  expect(
    await problemsOf((b) => {
      only(b).content.canonical = "0".repeat(64);
    }),
  ).toEqual([`manifest: content versions of ${COURSE} not those of its files`]);
  // Another course's bundle claiming to be this one.
  expect(
    await problemsOf((b) => {
      only(b).course = `${MINI_SERIES}/other` as ReturnType<typeof only>["course"];
    }),
  ).toContain("canonical/other/course.json: missing");
  // A media file nothing uses; a key map scope of another course.
  expect(
    await problemsOf((b) => {
      b.manifest.files.push({ path: "media/video/extra.mp4", size: 1, sha256: "0".repeat(64) });
      b.manifest.keys[`${MINI_SERIES}/other/u00`] = { "1": 1 };
    }),
  ).toEqual([
    "media/video/extra.mp4: a media file its courses do not use",
    `keys.json ${MINI_SERIES}/other/u00: not a scope of the bundle's courses`,
  ]);
});

test("a bundle's lines of media.json say what it holds: its file, of that kind, size and content, of a web address", async () => {
  const { root } = await library();
  const problemsOf = async (change: (b: Awaited<ReturnType<typeof bundled>>) => void) => {
    const b = await bundled(root, ["ru-de"]);
    change(b);
    return checkBundle(nodeFs, b.files, b.manifest);
  };
  const url = "https://example.org/hallo.mp3";
  const line = (b: Awaited<ReturnType<typeof bundled>>) =>
    b.manifest.media[url] as { sha256: string; size: number; kind: string };
  const refused = [`media.json ${url}: not a media file of the bundle as listed`];
  expect(await problemsOf((b) => (line(b).sha256 = "0".repeat(64)))).toEqual(refused);
  expect(await problemsOf((b) => (line(b).size += 1))).toEqual(refused);
  expect(await problemsOf((b) => (line(b).kind = "image"))).toEqual(refused);
  expect(
    await problemsOf((b) => {
      b.manifest.media["javascript:alert(1)"] = b.manifest.media[url] as never;
    }),
  ).toEqual(["media.json javascript:alert(1): not a media file of the bundle as listed"]);
});

/** Every file under `dir` with its content. */
const filesOf = (dir: string) =>
  Object.fromEntries(
    (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
      .filter((d) => d.isFile())
      .map((d) => [
        join(d.parentPath, d.name).slice(dir.length),
        readFileSync(join(d.parentPath, d.name), "utf8"),
      ]),
  );

test("an install that fails midway is undone: media placed removed, the course's folders as they were", async () => {
  const { root, series } = await library();
  const other = dir();
  await install(other, await bundled(root, ["ru-de"]));
  const otherSeries = join(other, MINI_SERIES);
  // The library to install into lacks a picture; the bundle's course differs, and adds an edition.
  rmSync(join(otherSeries, "media/image/frage.png"));
  const index = join(series, "canonical/basic/course.json");
  writeFileSync(index, `${readFileSync(index, "utf8")}\n`);
  const bundle = await bundled(root);
  const before = filesOf(other);
  const plan = await planBundle(nodeFs, other, bundle.manifest);
  expect(await checkBundle(nodeFs, bundle.files, bundle.manifest)).toEqual([]);
  // The new edition's folder cannot be moved in: after the picture and the course's index were.
  rmSync(join(bundle.files, "locale/en-de/basic"), { recursive: true });
  await expect(
    installBundle({ fs: nodeFs, libraryRoot: other, ...bundle, plan }),
  ).rejects.toThrow();
  expect(filesOf(other)).toEqual(before);
});

test("a bundle replaces nothing of the library but its course's folders: a source copy there with other content is a clash, another course's copy no bundle's", async () => {
  const { root } = await library();
  const bundle = await bundled(root, ["ru-de"]);
  const other = dir();
  put(join(other, MINI_SERIES, "raw/de-de/basic/quiz.pdf"), "the quiz as read elsewhere");
  expect((await planBundle(nodeFs, other, bundle.manifest)).clash).toEqual([
    "raw/de-de/basic/quiz.pdf",
  ]);
  // A copy in another course's folder, named by this course's exam sources.
  const theirs = "raw/de-de/other/quiz.pdf";
  cpSync(join(bundle.files, "raw/de-de/basic/quiz.pdf"), join(bundle.files, theirs));
  const sources = join(bundle.files, "canonical/basic/sources/quiz.json");
  writeFileSync(
    sources,
    readFileSync(sources, "utf8").replace("raw/de-de/basic/", "raw/de-de/other/"),
  );
  bundle.manifest.files.push({ path: theirs, size: 1, sha256: "0".repeat(64) });
  expect(await checkBundle(nodeFs, bundle.files, bundle.manifest)).toContain(
    `${theirs}: not of the bundle's courses`,
  );
  // Nor is it exported.
  const series = join(root, MINI_SERIES);
  writeFileSync(
    join(series, "canonical/basic/sources/quiz.json"),
    readFileSync(join(series, "canonical/basic/sources/quiz.json"), "utf8").replace(
      "raw/de-de/basic/",
      "raw/de-de/other/",
    ),
  );
  put(join(series, theirs), "another course's copy");
  const content = await courseBundleContent(nodeFs, root, MINI_SERIES, ["basic"], ["ru-de"]);
  expect(content.files.map((f) => f.path).filter((p) => p.startsWith("raw/"))).toEqual([]);
});

test("the same content under another name is linked only when that file holds it now, not as the index says", async () => {
  const { root } = await library();
  const bundle = await bundled(root, ["ru-de"]);
  const other = dir();
  const otherSeries = join(other, MINI_SERIES);
  const audio = bundle.manifest.files.find((f) => f.path === MINI_AUDIO);
  // The index says hallo-2.mp3 holds the recording; the file holds something else of its size.
  put(join(otherSeries, "media/audio/hallo-2.mp3"), "x".repeat(audio?.size ?? 0));
  put(
    join(otherSeries, "media.json"),
    JSON.stringify({
      "https://example.org/elsewhere.mp3": {
        kind: "audio",
        path: "media/audio/hallo-2.mp3",
        sha256: audio?.sha256,
        size: audio?.size,
        mime: "audio/mpeg",
      },
    }),
  );
  const plan = await planBundle(nodeFs, other, bundle.manifest);
  expect([...plan.link]).toEqual([]);
  expect(plan.unpack.has(MINI_AUDIO)).toBe(true);
});

/** Another course of the series made from basic, its keys its own: naming basic's media (`own`:
 *  a recording of its own, of that content, instead of basic's; its exam, and so its picture, kept). */
function twin(series: string, id: string, own?: string) {
  const recording = `media/audio/${id}.mp3`;
  const copy = (from: string, to: string) => {
    const text = readFileSync(join(series, from), "utf8").replaceAll(
      `${MINI_SERIES}/basic`,
      `${MINI_SERIES}/${id}`,
    );
    put(join(series, to), own === undefined ? text : text.replaceAll(MINI_AUDIO, recording));
  };
  for (const f of ["course.json", "lessons/00-01.json", "exams/quiz.json"]) {
    copy(`canonical/basic/${f}`, `canonical/${id}/${f}`);
    for (const e of ["ru-de", "en-de"]) copy(`locale/${e}/basic/${f}`, `locale/${e}/${id}/${f}`);
  }
  if (own !== undefined) put(join(series, recording), own);
}

test("a bundle of two courses sharing media: each media file once, both checked and installed, each course's status its own", async () => {
  const { root, series } = await library();
  twin(series, "twin");
  const bundle = await bundled(root, undefined, ["twin", "basic"]);
  expect(bundle.manifest.courses.map((c) => c.course)).toEqual([COURSE, TWIN]);
  const paths = bundle.manifest.files.map((f) => f.path);
  expect(paths.filter((p) => p.startsWith("media/"))).toEqual([
    MINI_AUDIO,
    "media/image/frage.png",
  ]);
  expect(paths).toContain("canonical/twin/lessons/00-01.json");
  expect(paths).toContain("locale/en-de/twin/course.json");

  const other = dir();
  // basic there already, as the bundle has it: the same; twin new.
  await install(other, await bundled(root, undefined, ["basic"]));
  const done = await install(other, bundle);
  expect(done.courses).toEqual([
    { course: COURSE, status: "same", variants: 0 },
    { course: TWIN, status: "added", variants: 0 },
  ]);
  // Its two media files and basic's exam's copy, there already.
  expect(done.media).toEqual({ added: 0, kept: 3 });
  const installed = openLibrary(nodeFs, other);
  expect(installed.courses().map((c) => c.course)).toEqual(["basic", "twin"]);
  // Each finds its media (twin's fingerprints are basic's: a copy, not checked here).
  for (const id of ["basic", "twin"])
    expect((await installed.check(MINI_SERIES, id)).media.missing).toBe(0);
  expect((await installed.check(MINI_SERIES, "basic")).problems).toEqual([]);
});

test("a bundle's file of a course its manifest does not list is refused", async () => {
  const { root, series } = await library();
  twin(series, "twin");
  const bundle = await bundled(root, ["ru-de"], ["basic", "twin"]);
  // twin's files kept, twin taken off the manifest's courses.
  bundle.manifest.courses = bundle.manifest.courses.filter((c) => c.course === COURSE);
  const problems = await checkBundle(nodeFs, bundle.files, bundle.manifest);
  expect(problems).toContain(
    "canonical/twin/course.json: not where its keys put it in the bundle's courses",
  );
  expect(problems).toContain("canonical/twin/course.json: not of the bundle's courses");
});

test("a series' courses grouped for bundles: those sharing most of their media's bytes together, those sharing a small file apart", async () => {
  const { root, series } = await library();
  // basic's recording large beside its picture (22 bytes).
  put(join(series, MINI_AUDIO), "a".repeat(1000));
  // twin: basic's recording and picture, all its media shared.
  twin(series, "twin");
  // level: a large recording of its own, basic's picture only shared.
  twin(series, "level", "b".repeat(1000));
  expect(await bundleGroups(nodeFs, root, MINI_SERIES)).toEqual([["basic", "twin"], ["level"]]);
  // Its own bundle holds the picture it shares too.
  const level = await courseBundleContent(nodeFs, root, MINI_SERIES, ["level"]);
  expect(level.files.filter((f) => f.path.startsWith("media/")).map((f) => f.path)).toEqual([
    "media/audio/level.mp3",
    "media/image/frage.png",
  ]);
});

/** A lesson's practice in ru-de with the variants given (by id), each a text to hear recorded. */
function practice(series: string, ids: string[]) {
  const lesson = `${MINI_SERIES}/basic/00-01`;
  const value: PracticeLesson = {
    format: 1,
    lesson: lesson as PracticeLesson["lesson"],
    edition: "ru-de",
    language: "ru",
    reading: [],
    listening: ids.map((id, i) => ({
      id,
      model: "m",
      madeAt: i + 1,
      text: {
        kind: "dialogue",
        step: "listening",
        title: "Im Café",
        situation: "Двое в кафе.",
        lines: [{ speaker: "Anna", text: "Hallo!" }],
        glossary: [],
        questions: [{ phase: "listening", question: "Кто?", options: ["Анна", "Ник"], answer: 0 }],
        recording: `practice/ru-de/basic/00-01/${id}.wav`,
      },
    })),
    writing: [],
    speaking: [],
  };
  put(join(series, "practice/ru-de/basic/00-01.json"), prettyJson(value));
  for (const id of ids) put(join(series, `practice/ru-de/basic/00-01/${id}.wav`), `wav of ${id}`);
}

test("a course's practice travels in its bundle with its recordings; installed, a lesson's variants gather", async () => {
  const { root, series } = await library();
  practice(series, ["aaaaaaaa", "bbbbbbbb"]);
  const bundle = await bundled(root);
  const paths = bundle.manifest.files.map((f) => f.path);
  expect(paths).toContain("practice/ru-de/basic/00-01.json");
  expect(paths).toContain("practice/ru-de/basic/00-01/aaaaaaaa.wav");
  expect(Object.keys(only(bundle).content.practice ?? {})).toEqual(["ru-de"]);

  // Another library made a variant of its own of the lesson, and one the bundle has too.
  const other = dir();
  await install(other, await bundled((await library()).root));
  practice(join(other, MINI_SERIES), ["aaaaaaaa", "cccccccc"]);
  const done = await install(other, bundle);
  expect(done.courses).toEqual([{ course: COURSE, status: "same", variants: 1 }]);
  const merged = await openLibrary(nodeFs, other).practice(
    MINI_SERIES,
    `${MINI_SERIES}/basic/00-01` as never,
    "ru-de",
  );
  expect(merged?.listening.map((v) => v.id).sort()).toEqual(["aaaaaaaa", "bbbbbbbb", "cccccccc"]);
  expect(
    openLibrary(nodeFs, other).practiceFile(MINI_SERIES, "practice/ru-de/basic/00-01/bbbbbbbb.wav"),
  ).toBeTruthy();
  expect(openLibrary(nodeFs, other).practiceLessons(MINI_SERIES, "basic", "ru-de")).toEqual([
    "00-01",
  ]);
  // The same again brings nothing.
  expect((await install(other, bundle)).courses).toEqual([
    { course: COURSE, status: "same", variants: 0 },
  ]);
});

test("a bundle's practice is checked: a recording no variant names, an edition it does not carry", async () => {
  const { root, series } = await library();
  practice(series, ["aaaaaaaa"]);
  const bundle = await bundled(root, ["ru-de"]);
  put(join(bundle.files, "practice/ru-de/basic/00-01/stray.wav"), "x");
  const stray = {
    ...bundle.manifest,
    files: [
      ...bundle.manifest.files,
      { path: "practice/ru-de/basic/00-01/stray.wav", size: 1, sha256: "0".repeat(64) },
    ],
  };
  expect((await checkBundle(nodeFs, bundle.files, stray)).join()).toContain(
    "a recording no practice names",
  );
  const en = { ...bundle.manifest, courses: [{ ...only(bundle), editions: ["en-de"] }] };
  expect((await checkBundle(nodeFs, bundle.files, en)).join()).toContain(
    "practice/ru-de/basic/00-01.json: not where its keys put it",
  );
});
