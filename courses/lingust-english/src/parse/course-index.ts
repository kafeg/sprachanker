// The course index page → stages with their lessons.
import { find, findAll, hasClass, parseHtml } from "../dom.ts";
import { textOf } from "./page.ts";

export interface IndexLesson {
  /** Last path segment: `lesson8`, `irregular-verbs`. */
  slug: string;
  title: string;
  desc: string;
  level: string;
}

export interface IndexStage {
  title: string;
  lessons: IndexLesson[];
}

/** The course index: stages ("ЭТАП 1. …") with their lessons, then the bonus materials. */
export function parseIndex(html: string): IndexStage[] {
  const container = find(parseHtml(html), (e) => hasClass(e, "course-container"));
  if (!container) throw new Error("course index: no course-container");
  const stages: IndexStage[] = [];
  for (const el of findAll(
    container,
    (e) => hasClass(e, "level-divider") || hasClass(e, "lesson-row"),
  )) {
    if (hasClass(el, "level-divider")) {
      const title = find(el, (e) => hasClass(e, "part-title"));
      stages.push({
        title: (title ? textOf(title) : "").replace(/^[^\p{L}\p{N}]+/u, ""),
        lessons: [],
      });
      continue;
    }
    const part = (cls: string) => {
      const e = find(el, (x) => hasClass(x, cls));
      return e ? textOf(e) : "";
    };
    const slug = (el.attrs.href ?? "").split("/").pop() ?? "";
    stages.at(-1)?.lessons.push({
      slug,
      title: part("lesson-title"),
      desc: part("lesson-desc"),
      level: part("lvl"),
    });
  }
  return stages;
}
