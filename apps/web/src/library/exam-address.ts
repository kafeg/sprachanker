// An exam's address: `/exam/<series>/<course>/<slug>` for the key `<series>/<course>/exam-<slug>`.
import { type ExamKey, parseExamKey } from "@sprachanker/schema";

export interface ExamParams {
  series: string;
  course: string;
  exam: string;
}

export function examParams(key: string): ExamParams {
  const { course, slug } = parseExamKey(key);
  const [series = "", id = ""] = course.split("/");
  return { series, course: id, exam: slug };
}

export const examKeyOf = (p: ExamParams) => `${p.series}/${p.course}/exam-${p.exam}` as ExamKey;
