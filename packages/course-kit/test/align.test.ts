import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import type { Exercise, Lesson, LessonKey, LocaleLesson } from "@sprachanker/schema";
import { alignLocale, exerciseSignature } from "../src/align.ts";
import { openLibrary } from "../src/library.ts";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-align-"));
  await writeFixtureLibrary(root);
  const lib = openLibrary(root);
  const key = "sprachanker.fixture/demo/00-01" as LessonKey;
  const lesson = await lib.lesson("sprachanker.fixture", key);
  const locale = (await lib.localeLesson("sprachanker.fixture", key, "en-de")) as LocaleLesson;
  return { lesson, locale };
}

/** The edition's own numbering: exercise n gets ex-0n, items follow. */
function renumber(exercises: Exercise[], lesson: Lesson): Exercise[] {
  return exercises.map((ex, i) => {
    const key = `${lesson.key}/ex-${String(i + 1).padStart(2, "0")}`;
    return {
      ...ex,
      key,
      items: ex.items.map((it, j) => ({ ...it, key: `${key}#${j + 1}` })),
    } as Exercise;
  });
}

test("the same exercise with its options in another order has the same signature", async () => {
  const { lesson } = await fixture();
  const choice = lesson.pages.map((p) => p.exercise).find((e) => e.type === "single_choice");
  if (choice?.type !== "single_choice") throw new Error("fixture has no single_choice");
  const item = choice.items[0] as (typeof choice.items)[number];
  const reversed = { ...item, options: [...item.options].reverse() };
  expect(exerciseSignature({ ...choice, items: [reversed, ...choice.items.slice(1)] })).toBe(
    exerciseSignature(choice),
  );
});

test("an edition with an inserted exercise and reordered options is re-keyed by content", async () => {
  const { lesson, locale } = await fixture();
  const canonical = lesson.pages.map((p) => p.exercise);
  const choiceAt = canonical.findIndex((e) => e.type === "single_choice");
  const choice = canonical[choiceAt] as Extract<Exercise, { type: "single_choice" }>;
  // The edition: an extra exercise first, then the same exercises; the choice's options reversed
  // and its option ids reassigned in the new order (as a source would number them).
  const item = choice.items[0] as (typeof choice.items)[number];
  const ids = item.options.map((o) => o.id);
  const reversed = [...item.options].reverse().map((o, i) => ({ ...o, id: ids[i] as string }));
  const newId = (old: string) => ids[item.options.length - 1 - ids.indexOf(old)] as string;
  const edited = {
    ...choice,
    items: [
      {
        ...item,
        options: reversed,
        answer: { optionIds: item.answer.optionIds.map(newId) as [string] },
      },
      ...choice.items.slice(1),
    ],
  } as Exercise;
  const extra = { ...(canonical[0] as Exercise), text: "Ein ganz neuer Text." } as Exercise;
  const draftExercises = renumber(
    [extra, ...canonical.map((e, i) => (i === choiceAt ? edited : e))],
    lesson,
  );
  const draft: Lesson = { ...lesson, pages: draftExercises.map((exercise) => ({ exercise })) };
  // The edition's locale texts, keyed by its own numbering, option texts by its own ids.
  const texts = Object.fromEntries(
    canonical.map((e, i) => {
      const t = locale.exercises[e.key] ?? { sourceId: String(i), items: {} };
      const own = draftExercises[i + 1] as Exercise;
      if (i !== choiceAt) return [own.key, t];
      const options = Object.fromEntries(ids.map((id) => [newId(id), `label of ${id}`]));
      return [own.key, { ...t, items: { "#1": { options } } }];
    }),
  );
  const editionLocale: LocaleLesson = {
    ...locale,
    exercises: {
      ...texts,
      [(draftExercises[0] as Exercise).key]: { sourceId: "x", title: "Extra", items: {} },
    },
  };

  const { locale: aligned, report } = alignLocale(lesson, draft, editionLocale);
  expect(report.unmatchedExercises).toEqual([(draftExercises[0] as Exercise).key]);
  expect(Object.keys(aligned.exercises).sort()).toEqual(
    canonical
      .filter((e) => locale.exercises[e.key] || e === choice)
      .map((e) => e.key)
      .sort(),
  );
  // Each canonical option keeps the label that was written for it.
  expect(aligned.exercises[choice.key]?.items["#1"]?.options).toEqual(
    Object.fromEntries(ids.map((id) => [id, `label of ${id}`])),
  );
  for (const e of canonical)
    if (e !== choice && locale.exercises[e.key])
      expect(aligned.exercises[e.key]?.title).toBe(locale.exercises[e.key]?.title);
});
