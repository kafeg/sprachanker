// An exam as its pages read it (its page, its catalogue): its row in the list of exams, the edition it
// is shown in, its page's data; until all of it is there (`ready`),
// `gate` is what to show — loading, an error, or that it is not installed.
import { useEdition } from "@/api/edition.ts";
import { type ExamRow, useExamPage, useExams } from "@/api/exams.ts";
import { CourseGone } from "@/library/course-gone.tsx";
import { type ExamParams, examKeyOf } from "@/library/exam-address.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";

type PageData = NonNullable<ReturnType<typeof useExamPage>["data"]>;

type ExamData = { key: ReturnType<typeof examKeyOf>; edition?: string; data?: PageData } & (
  | { ready: false; gate: React.ReactNode; row?: ExamRow }
  | { ready: true; row: ExamRow; edition: string; data: PageData }
);

export function useExam(params: ExamParams): ExamData {
  const key = examKeyOf(params);
  const exams = useExams();
  const row = exams.data?.find((e) => e.key === key);
  const edition = useEdition(params.series, params.course, row?.editions);
  const page = useExamPage(key, edition);
  const data = page.data;
  if (exams.isError)
    return {
      key,
      ready: false,
      gate: <ErrorState error={exams.error} onRetry={() => exams.refetch()} />,
    };
  if (exams.isSuccess && !row)
    return {
      key,
      ready: false,
      gate: <CourseGone series={params.series} course={params.course} kind="exam" />,
    };
  if (page.isError)
    return {
      key,
      row,
      ready: false,
      gate: <ErrorState error={page.error} onRetry={() => page.refetch()} />,
    };
  if (!row || !edition || !data)
    return { key, row, edition, data, ready: false, gate: <Loading /> };
  return { key, row, edition, data, ready: true };
}
