// Course order → keys: units are the course's lesson groups in order; the final test (no group)
// becomes its own unit after the last one. A lesson keeps its number in its unit by its source id
// (the key map), so one DW inserts shifts no other.
import type { KeyMap } from "@sprachanker/course-kit";
import {
  CANONICAL_FORMAT,
  type CourseIndex,
  type CourseKey,
  type GoalKey,
  type LessonKey,
  LOCALE_FORMAT,
  type LocaleCourse,
  lessonKey,
  type UnitKey,
  unitKey,
} from "@sprachanker/schema";
import { type ApolloState, entitiesOf } from "../apollo.ts";
import { SOURCE } from "../catalog.ts";

export interface CourseLesson {
  sourceId: number;
  key: LessonKey;
  unit: UnitKey;
  unitTitle: string;
}

export function courseLessons(course: CourseKey, state: ApolloState, keys: KeyMap): CourseLesson[] {
  const entity = entitiesOf(state, "Course")[0];
  const links = Object.entries(entity ?? {}).find(([k]) =>
    k.startsWith("contentLinks"),
  )?.[1] as Array<{
    __ref: string;
  }>;
  const out: CourseLesson[] = [];
  let unit = -1;
  let order = 0;
  let group: string | undefined;
  for (const ref of links) {
    const link = state[ref.__ref] ?? {};
    const name = String(link.groupName ?? "");
    if (name !== group || !name) {
      unit++;
      order = 0;
      group = name;
    }
    order++;
    const unitK = unitKey(course, unit);
    out.push({
      sourceId: Number(link.id),
      key: lessonKey(course, unit, keys.number(unitK, String(link.id), order)),
      unit: unitK,
      unitTitle: name.replace(/^\d+\s+/, ""),
    });
  }
  return out;
}

/** Course index and locale course file from the lessons and the goal texts they produced. */
export function courseFiles(
  course: CourseKey,
  edition: LocaleCourse["edition"],
  state: ApolloState,
  lessons: CourseLesson[],
  lessonTitles: Map<LessonKey, string>,
  goals: Map<LessonKey, Record<GoalKey, string>>,
  descriptionHtml: string | undefined,
  /** DW's level code for the title ("A1"). */
  level: string,
): { index: CourseIndex; locale: LocaleCourse } {
  const entity = entitiesOf(state, "Course")[0] ?? {};
  const units = new Map<UnitKey, { lessons: LessonKey[]; title: string }>();
  for (const lesson of lessons) {
    const unit = units.get(lesson.unit) ?? {
      lessons: [],
      title: lesson.unitTitle || (lessonTitles.get(lesson.key) ?? ""),
    };
    unit.lessons.push(lesson.key);
    units.set(lesson.unit, unit);
  }
  const goalEntries = [...goals].flatMap(([lesson, texts]) =>
    Object.entries(texts).map(([key, text]) => ({ key: key as GoalKey, lesson, text })),
  );
  return {
    index: {
      format: CANONICAL_FORMAT,
      key: course,
      source: SOURCE,
      units: [...units].map(([key, unit]) => ({ key, lessons: unit.lessons })),
      exams: [],
      goals: goalEntries.map((g) => ({ key: g.key, lessons: [g.lesson] })),
    },
    locale: {
      format: LOCALE_FORMAT,
      edition,
      course,
      sourceId: String(entity.id ?? ""),
      title: `${String(entity.name ?? "")} ${level.toUpperCase()}`.trim(),
      ...(descriptionHtml ? { descriptionHtml } : {}),
      units: Object.fromEntries([...units].map(([key, unit]) => [key, { title: unit.title }])),
      goals: Object.fromEntries(goalEntries.map((g) => [g.key, { text: g.text }])),
    },
  };
}
