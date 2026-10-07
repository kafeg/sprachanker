// The player's frame (09): the plan beside the step on desktop (a sheet on a phone), the header with the
// steps worked, what optional features add there and the reference, and the reference panel.
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText, ListOrdered } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
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
  const [planOpen, setPlanOpen] = useState(false);
  const [reference, setReference] = useState<ReferenceTab>();
  const firstTab = referenceTabs(lesson, locale)[0];
  return (
    <div className="lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r p-4 lg:block">
        <Link
          to="/course/$series/$course"
          params={{ series, course }}
          className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {courseTitle}
        </Link>
        <h2 className="mb-1 px-2 text-xl font-bold">{locale?.title}</h2>
        <p className="mb-3 px-2 text-sm text-muted-foreground">
          {todo > 0 && t("lesson.stepsDone", { done: worked, total: todo })}
        </p>
        {plan()}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={t("lesson.plan")}
              onClick={() => setPlanOpen(true)}
            >
              <ListOrdered className="size-5" />
            </Button>
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
          </div>
        </header>
        <div className="mx-auto max-w-3xl px-4 py-6">{children}</div>
      </div>
      <Sheet open={planOpen} onOpenChange={setPlanOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{locale?.title}</SheetTitle>
          </SheetHeader>
          {plan(() => setPlanOpen(false))}
        </SheetContent>
      </Sheet>
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
    </div>
  );
}
