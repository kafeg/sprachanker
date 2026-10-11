// Course bundles, the library's side: what a course's bundle holds, and a bundle unpacked beside
// another library checked and installed there — added, the same again, replaced, its media deduped.
import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COURSE_BUNDLE_FORMAT,
  COURSE_BUNDLE_VERSION,
  CourseBundleManifest,
  type ExamSources,
  MediaIndex,
} from "@sprachanker/schema";
import {
  checkBundle,
  contentVersions,
  courseBundleContent,
  installBundle,
  planBundle,
} from "../src/bundle.ts";
import { prettyJson } from "../src/canonical-json.ts";
import { hashFile } from "../src/files.ts";
import { NotInstalledError, openLibrary } from "../src/library.ts";
import { MINI_AUDIO, MINI_EXAM, MINI_SERIES, writeMiniLibrary } from "./mini-library.ts";

const COURSE = `${MINI_SERIES}/basic`;
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
  const sha = async (path: string) => (await hashFile(join(series, path))).sha256;
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

/** The course's bundle as the server makes it, unpacked into a stage of its own (`files`, `aside`). */
async function bundled(root: string, editions?: string[]) {
  const content = await courseBundleContent(root, MINI_SERIES, "basic", editions);
  const stage = dir();
  const files = [];
  for (const f of content.files) {
    cpSync(f.file, join(stage, "files", f.path));
    files.push({ path: f.path, ...(await hashFile(f.file)) });
  }
  const manifest = CourseBundleManifest.parse({
    format: COURSE_BUNDLE_FORMAT,
    version: COURSE_BUNDLE_VERSION,
    appVersion: "test",
    exportedAt: 1,
    course: content.course,
    kind: content.kind,
    editions: content.editions,
    provider: null,
    source: content.source,
    titles: content.titles,
    content: contentVersions("basic", content.editions, files),
    media: content.media,
    keys: content.keys,
    files,
  });
  return { manifest, files: join(stage, "files"), aside: join(stage, "aside") };
}

async function install(root: string, bundle: Awaited<ReturnType<typeof bundled>>) {
  const plan = await planBundle(root, bundle.manifest);
  expect(plan.clash).toEqual([]);
  expect(await checkBundle(bundle.files, bundle.manifest)).toEqual([]);
  return { plan, ...(await installBundle({ libraryRoot: root, ...bundle, plan })) };
}

test("a course's bundle: its files of the editions asked, the media they use, its exams' copies, its lines of media.json and keys.json", async () => {
  const { root } = await library();
  const all = await courseBundleContent(root, MINI_SERIES, "basic");
  expect(all.editions).toEqual(["en-de", "ru-de"]);
  expect(all.kind).toBe("course");
  expect(all.titles).toEqual({ "en-de": "Mini", "ru-de": "Mini" });
  const one = await courseBundleContent(root, MINI_SERIES, "basic", ["ru-de"]);
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
  await expect(courseBundleContent(root, MINI_SERIES, "basic", ["fr-de"])).rejects.toBeInstanceOf(
    NotInstalledError,
  );
  await expect(courseBundleContent(root, MINI_SERIES, "nope")).rejects.toBeInstanceOf(
    NotInstalledError,
  );
});

test("a bundle installed into another library: verified whole, the series' state merged; the same again changes nothing", async () => {
  const { root } = await library();
  const other = dir();
  const otherSeries = join(other, MINI_SERIES);
  put(join(otherSeries, "keys.json"), JSON.stringify({ [`${MINI_SERIES}/x/u00`]: { "1": 1 } }));
  const first = await install(other, await bundled(root, ["ru-de"]));
  expect(first.status).toBe("added");
  expect(first.media).toEqual({ added: 2, kept: 0 });
  const report = await openLibrary(other).check(MINI_SERIES, "basic");
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
  expect(again.status).toBe("same");
  expect(again.media).toEqual({ added: 0, kept: 3 });
  // Another edition of it: added beside, the course's files the same.
  const en = await install(other, await bundled(root, ["en-de"]));
  expect(en.status).toBe("replaced");
  expect(openLibrary(other).courses()[0]?.editions).toEqual(["en-de", "ru-de"]);
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
  expect(changed.status).toBe("replaced");
  expect(existsSync(stale)).toBe(false);
  const installed = openLibrary(other);
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
  const plan = await planBundle(other, bundle.manifest);
  expect([...plan.skip]).toEqual(["media/image/frage.png"]);
  expect([...plan.link]).toEqual([[MINI_AUDIO, "media/audio/hallo-2.mp3"]]);
  expect([...plan.unpack].filter((p) => !p.endsWith(".json"))).toEqual([
    "raw/de-de/basic/quiz.pdf",
  ]);
  const done = await installBundle({ libraryRoot: other, ...bundle, plan });
  expect(done.media).toEqual({ added: 1, kept: 1 });
  expect(readFileSync(join(otherSeries, MINI_AUDIO), "utf8")).toBe("sprachanker-mini:hallo");

  const clashing = dir();
  put(join(clashing, MINI_SERIES, "media/image/frage.png"), "another picture");
  expect((await planBundle(clashing, bundle.manifest)).clash).toEqual(["media/image/frage.png"]);
});

test("a bundle's files are checked before anything is installed: schemas, places, the course's own, media it uses", async () => {
  const { root } = await library();
  const problemsOf = async (change: (b: Awaited<ReturnType<typeof bundled>>) => void) => {
    const b = await bundled(root, ["ru-de"]);
    change(b);
    return checkBundle(b.files, b.manifest);
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
  ).toEqual([
    "canonical/basic/lessons/00-02.json: not where its keys put it in sprachanker.mini/basic",
  ]);
  // Another course's bundle claiming to be this one.
  expect(
    await problemsOf((b) => {
      b.manifest.course = `${MINI_SERIES}/other` as typeof b.manifest.course;
    }),
  ).toContain("canonical/other/course.json: missing");
  // A media file nothing uses; a key map scope of another course.
  expect(
    await problemsOf((b) => {
      b.manifest.files.push({ path: "media/video/extra.mp4", size: 1, sha256: "0".repeat(64) });
      b.manifest.keys[`${MINI_SERIES}/other/u00`] = { "1": 1 };
    }),
  ).toEqual([
    "media/video/extra.mp4: a media file the course does not use",
    `keys.json ${MINI_SERIES}/other/u00: not a scope of ${COURSE}`,
  ]);
});
