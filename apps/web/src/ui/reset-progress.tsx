// Resetting progress (05): a course (it leaves "My courses") or a lesson, after a confirmation that
// says what is deleted. The caller draws the button; `open` shows the confirmation.
import type { LessonKey } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useResetProgress } from "@/api/hooks.ts";
import { ConfirmDialog } from "./confirm.tsx";

export function ResetProgress({
  series,
  course,
  lesson,
  title,
  onDone,
  children,
}: {
  series: string;
  course: string;
  /** Only this lesson; without it the whole course. */
  lesson?: LessonKey;
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
        title={t(lesson ? "progress.lessonTitle" : "progress.courseTitle", { title })}
        description={t(lesson ? "progress.lessonBody" : "progress.courseBody")}
        confirm={t("progress.confirm")}
        cancel={t("common.cancel")}
        busy={reset.isPending}
        onConfirm={() =>
          reset.mutate(
            { series, course, lesson },
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
