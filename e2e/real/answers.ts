// Every scored item of an installed course, answered with the course's own answer, must check as
// correct, and a different single choice must not (the course-check skill). Read-only.
//   bun e2e/real/answers.ts <library> <series> <course> <target language>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkItem } from "@sprachanker/engine";
import { type Exercise, Lesson } from "@sprachanker/schema";

const [library, series, course, lang] = process.argv.slice(2);
if (!library || !series || !course || !lang) {
  console.error("usage: bun e2e/real/answers.ts <library> <series> <course> <target language>");
  process.exit(2);
}

/** The course's own answer to an item, and a different single choice; none for what is not checked. */
function ownAnswer(exercise: Exercise, index: number): { right: unknown; wrong?: unknown } | null {
  const first = <T>(w: T | T[]) => (Array.isArray(w) ? w[0] : w);
  switch (exercise.type) {
    case "single_choice": {
      const item = exercise.items[index];
      if (!item) return null;
      const [right] = item.answer.optionIds;
      const same = (a: unknown, b: unknown) =>
        JSON.stringify({ ...(a as object), id: 0 }) === JSON.stringify({ ...(b as object), id: 0 });
      const rightOption = item.options.find((o) => o.id === right);
      const other = item.options.find((o) => o.id !== right && !same(o, rightOption));
      return { right: { optionId: right }, wrong: other && { optionId: other.id } };
    }
    case "multi_choice":
      return { right: { optionIds: exercise.items[index]?.answer.optionIds } };
    case "match":
      return { right: { pairs: exercise.items[index]?.answer.pairs } };
    case "order":
      return { right: { sequence: exercise.items[index]?.answer.sequence } };
    case "gap_choice":
      return {
        right: Object.fromEntries(
          Object.entries(exercise.items[index]?.answer ?? {}).map(([g, w]) => [g, first(w)]),
        ),
      };
    case "gap_text":
      return {
        right: Object.fromEntries(
          Object.entries(exercise.items[index]?.answer ?? {}).map(([g, w]) => [g, w.accepted[0]]),
        ),
      };
    case "dictation":
      return { right: { text: exercise.items[index]?.answer.accepted[0] } };
    default:
      return null;
  }
}

const dir = join(library, series, "canonical", course, "lessons");
const problems: string[] = [];
let checked = 0;
let skipped = 0;
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const lesson = Lesson.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
  for (const { exercise } of lesson.pages) {
    exercise.items.forEach((item, index) => {
      const answers = ownAnswer(exercise, index);
      if (!answers) {
        skipped++;
        return;
      }
      checked++;
      const where = `${file} ${item.key} ${exercise.type}`;
      try {
        const outcome = checkItem(exercise, index, answers.right, lang);
        if (outcome.result !== "correct" || outcome.score !== 1)
          problems.push(`${where}: its own answer is ${outcome.result} ${outcome.score}`);
        if (answers.wrong && checkItem(exercise, index, answers.wrong, lang).result === "correct")
          problems.push(`${where}: another option is right too`);
      } catch (error) {
        problems.push(`${where}: throws ${(error as Error).message}`);
      }
    });
  }
}
console.log(problems.join("\n"));
console.error(
  `checked ${checked}, not checked (speaking, free answers) ${skipped}, problems ${problems.length}`,
);
process.exit(problems.length ? 1 : 0);
