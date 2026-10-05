// Course order → keys: units are the course's lesson groups in order; the final test (no group)
// becomes its own unit after the last one (03).
import {
  type CourseKey,
  type LessonKey,
  lessonKey,
  type UnitKey,
  unitKey,
} from "@sprachanker/schema";
import { type ApolloState, entitiesOf } from "../apollo.ts";

export interface CourseLesson {
  sourceId: number;
  key: LessonKey;
  unit: UnitKey;
  /** Position of the lesson in its unit, from 1. */
  order: number;
  unitTitle: string;
}

export function courseLessons(course: CourseKey, state: ApolloState): CourseLesson[] {
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
    out.push({
      sourceId: Number(link.id),
      key: lessonKey(course, unit, order),
      unit: unitKey(course, unit),
      order,
      unitTitle: name.replace(/^\d+\s+/, ""),
    });
  }
  return out;
}
