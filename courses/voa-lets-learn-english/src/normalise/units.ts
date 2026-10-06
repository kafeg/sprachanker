// Units of a course: its lessons grouped as the landing page groups them.
import type { LandingLesson } from "../parse.ts";

const lessonNumber = (title: string) => Number(/^Lesson (\d+)\b/.exec(title)?.[1] ?? Number.NaN);
const reviewRange = (title: string) => /^Review of\b.*?(\d+)\s*-+\s*(\d+)/.exec(title);

/**
 * Lessons grouped as the source groups them: by the landing's ranges ("Lessons 1 - 10") when it lists
 * them, else each review closes a group. A lesson outside every range joins the group before it.
 */
export function groupUnits<L extends { source: LandingLesson }>(
  lessons: L[],
  ranges: [number, number][],
): { title: string; lessons: L[] }[] {
  const groups: L[][] = [];
  if (ranges.length) {
    for (const lesson of lessons) {
      const n = lessonNumber(lesson.source.title);
      const i = ranges.findIndex(([a, b]) => n >= a && n <= b);
      const at = i >= 0 ? i : Math.max(groups.length - 1, 0);
      const group = groups[at] ?? [];
      groups[at] = group;
      group.push(lesson);
    }
  } else {
    let current: L[] = [];
    for (const lesson of lessons) {
      current.push(lesson);
      if (reviewRange(lesson.source.title)) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
  }
  return groups.filter(Boolean).map((group) => {
    const numbers = group.map((l) => lessonNumber(l.source.title)).filter((n) => !Number.isNaN(n));
    const title = numbers.length
      ? `Lessons ${Math.min(...numbers)}–${Math.max(...numbers)}`
      : (group[0]?.source.title ?? "");
    return { title, lessons: group };
  });
}
