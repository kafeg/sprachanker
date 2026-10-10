// The player's frame (09): the plan beside the step on desktop (a sheet on a phone; ui/side-layout),
// the header with the steps worked, what optional features add there and the reference, and the
// reference panel.
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { SIDE_BACK, SideHeader, SideLayout } from "@/ui/side-layout.tsx";
import { Reference, type ReferenceTab, referenceTabs } from "./reference.tsx";

export function PlayerFrame({
  series,
  course,
  courseTitle,
  lesson,
  locale,
  worked,
  todo,
  plan,
  header,
  url,
  children,
}: {
  series: string;
  course: string;
  courseTitle: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  worked: number;
  todo: number;
  /** The plan; `chosen` closes the phone's sheet once a step is chosen in it. */
  plan(chosen?: () => void): React.ReactNode;
  /** What optional features add to the header (the tutor). */
  header?: React.ReactNode;
  url(path: string): string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [reference, setReference] = useState<ReferenceTab>();
  const firstTab = referenceTabs(lesson, locale)[0];
  // The way back to the course, the lesson and its plan: beside the lesson on a wide screen, in the
  // plan's panel on a phone.
  const side = (onPick?: () => void) => (
    <>
      <SideHeader
        back={
          <Link to="/course/$series/$course" params={{ series, course }} className={SIDE_BACK}>
            <ArrowLeft className="size-4 shrink-0" />{" "}
            <span className="truncate">{courseTitle}</span>
          </Link>
        }
        title={locale?.title}
        status={todo > 0 && t("lesson.stepsDone", { done: worked, total: todo })}
      />
      {plan(onPick)}
    </>
  );
  return (
    <>
      <SideLayout
        side={side}
        sideLabel={t("lesson.plan")}
        bar={
          <>
            {todo > 0 ? (
              <>
                <Progress value={(worked / todo) * 100} className="h-2 flex-1" />
                <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
                  {worked}/{todo}
                </span>
              </>
            ) : (
              <span className="flex-1" />
            )}
            {header}
            {firstTab && (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("lesson.reference")}
                onClick={() => setReference(firstTab)}
              >
                <BookOpenText className="size-4" />{" "}
                <span className="hidden sm:inline">{t("lesson.reference")}</span>
              </Button>
            )}
          </>
        }
      >
        {children}
      </SideLayout>
      <Sheet open={!!reference} onOpenChange={(open) => !open && setReference(undefined)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
          <SheetHeader className="p-0">
            <SheetTitle>{t("lesson.reference")}</SheetTitle>
          </SheetHeader>
          {reference && (
            <Reference
              lesson={lesson}
              locale={locale}
              url={url}
              tab={reference}
              onTab={setReference}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
