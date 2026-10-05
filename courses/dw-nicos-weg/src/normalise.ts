// Normalises downloaded raw pages into canonical/ and locale/ files of the library (offline).
// Usage: bun src/normalise.ts [--data <root>] [--course a1] [--edition ru-de] [--lessons 1,2]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { prettyJson } from "@sprachanker/course-kit";
import { courseKey, Lesson, LocaleLesson, seriesKey } from "@sprachanker/schema";
import { type ApolloState, exerciseIds } from "./apollo.ts";
import { COURSES, SERIES } from "./catalog.ts";
import type { MediaIndex } from "./media.ts";
import { createContext } from "./normalise/context.ts";
import { courseLessons } from "./normalise/course.ts";
import { normaliseLesson } from "./normalise/lesson.ts";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: join(homedir(), "SprachAnker") },
    course: { type: "string", default: "a1" },
    edition: { type: "string", default: "ru-de" },
    lessons: { type: "string" },
  },
});
const seriesDir = join(values.data, "library", SERIES);
const dw = COURSES.find((c) => c.course === values.course && c.edition === values.edition);
if (!dw) throw new Error(`unknown course/edition ${values.course} ${values.edition}`);
const rawDir = `raw/${dw.edition}/${dw.course}`;
// Canonical files come from the course's first edition; other editions only add their locale files
// (aligning editions is stage 11).
const primary = COURSES.find((c) => c.course === dw.course) === dw;
const read = async (file: string): Promise<ApolloState> =>
  JSON.parse(await readFile(join(seriesDir, rawDir, file), "utf8"));
const write = async (path: string, value: unknown) => {
  await mkdir(dirname(join(seriesDir, path)), { recursive: true });
  await writeFile(join(seriesDir, path), prettyJson(value));
};

const ctx = createContext(
  JSON.parse(await readFile(join(seriesDir, "media.json"), "utf8")) as MediaIndex,
);
const course = courseKey(seriesKey("dw", "nicos-weg"), dw.course);
const wanted = values.lessons?.split(",").map(Number);
const all = courseLessons(course, await read("course.json"));
let problems = 0;
for (const [i, entry] of all.entries()) {
  if (wanted && !wanted.includes(i + 1)) continue;
  const lesson = await read(`l-${entry.sourceId}.json`);
  const exercises = new Map<number, ApolloState>();
  for (const id of exerciseIds(lesson, entry.sourceId))
    exercises.set(id, await read(`e-${id}.json`));
  const downloads = existsSync(join(seriesDir, rawDir, `le-${entry.sourceId}.json`))
    ? await read(`le-${entry.sourceId}.json`)
    : {};
  const out = normaliseLesson(ctx, {
    ...entry,
    edition: dw.edition,
    rawDir,
    lesson,
    downloads,
    exercises,
  });
  const name = entry.key.split("/").pop();
  const files = [
    ...(primary
      ? [[Lesson, out.lesson, `canonical/${dw.course}/lessons/${name}.json`] as const]
      : []),
    [LocaleLesson, out.locale, `locale/${dw.edition}/${dw.course}/lessons/${name}.json`] as const,
  ];
  for (const [schema, value, path] of files) {
    const result = schema.safeParse(value);
    if (!result.success) {
      problems++;
      console.error(
        `${path}: ${result.error.issues
          .slice(0, 3)
          .map((x) => `${x.path.join(".")} ${x.message}`)
          .join("; ")}`,
      );
    }
    await write(path, value);
  }
  const unknown = out.lesson.unmapped.length;
  console.log(
    `${entry.key}: ${out.lesson.pages.length} exercises, ${out.lesson.vocab.length} words${unknown ? `, ${unknown} unknown` : ""}`,
  );
}
console.log(problems ? `${problems} files failed validation` : "all files valid");
