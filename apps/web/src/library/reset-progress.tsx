// Resetting progress (05): a course (it leaves "My courses"), a lesson or an exam (it leaves "My
// exams"), after a confirmation that says what is deleted. The caller draws the button; `open` shows the confirmation.
import type { ExamKey, LessonKey } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useResetProgress } from "@/api/courses.ts";
import { ConfirmDialog } from "@/ui/confirm.tsx";

export function ResetProgress({
  series,
  course,
  lesson,
  exam,
  title,
  onDone,
  children,
}: {
  series: string;
  course: string;
  /** Only this lesson, or only this exam; without them the whole course. */
  lesson?: LessonKey;
  exam?: ExamKey;
  /** Title of the course or lesson, for the question. */
  title: string;
  onDone?(): void;
  children(open: () => void): React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const reset = useResetProgress();
  return (
    <>
      {children(() => setOpen(true))}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t(
          lesson ? "progress.lessonTitle" : exam ? "progress.examTitle" : "progress.courseTitle",
          { title },
        )}
        description={t(
          lesson ? "progress.lessonBody" : exam ? "progress.examBody" : "progress.courseBody",
        )}
        confirm={t("progress.confirm")}
        cancel={t("common.cancel")}
        busy={reset.isPending}
        onConfirm={() =>
          reset.mutate(
            { series, course, lesson, exam },
            {
              onSuccess: () => {
                setOpen(false);
                onDone?.();
              },
            },
          )
        }
      />
    </>
  );
}
