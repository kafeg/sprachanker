// /api/progress: the learner's progress as a whole — reset for a course (it leaves "My courses"), one
// of its lessons, or one of its exams (it leaves "My exams"), on the learner's confirmed request.
import { courseKey, ExamKey, LessonKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zod } from "../validate.ts";
import { CourseRef } from "./courses.ts";
import type { ProfileEnv } from "./env.ts";

export function progressRoutes() {
  return new Hono<ProfileEnv>().post(
    "/reset",
    zod("json", CourseRef.extend({ lesson: LessonKey.optional(), exam: ExamKey.optional() })),
    (c) => {
      const { series, course, lesson, exam } = c.req.valid("json");
      const key = courseKey(series, course);
      const inside = lesson ?? exam;
      if (inside && !inside.startsWith(`${key}/`))
        throw new HTTPException(400, { message: "not in this course" });
      return c.json(c.var.s.progress.reset(key, lesson ? { lesson } : exam ? { exam } : undefined));
    },
  );
}
