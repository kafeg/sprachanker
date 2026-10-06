// Steps of the lesson besides its exercises (09): a reading page (grammar, culture) and the action bar
// they share — back, skip where a step can be left undone, next.
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { pageTitle } from "./reference.tsx";

/** The bar under a step, in the same place as the exercises' one: back, skip, next. */
export function StepBar({
  onBack,
  onNext,
  onSkip,
  next,
}: {
  onBack(): void;
  onNext(): void;
  /** Leave the step undone (it shows as skipped). */
  onSkip?(): void;
  /** The main button's label (next by default). */
  next?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex items-center gap-2 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <Button variant="ghost" size="lg" onClick={onBack}>
        {t("lesson.previous")}
      </Button>
      <div className="ml-auto flex gap-2">
        {onSkip && (
          <Button variant="ghost" size="lg" onClick={onSkip}>
            {t("lesson.skip")}
          </Button>
        )}
        <Button size="lg" className="w-32 text-base sm:w-40" onClick={onNext}>
          {next ?? t("lesson.next")}
        </Button>
      </div>
    </div>
  );
}

/** A grammar or culture page of the lesson as a step: read when opened. */
export function ReadingStep({
  section,
  page,
  children,
}: {
  /** "Grammar" or "Culture". */
  section: string;
  page: { title: string; bodyHtml: string; part?: number };
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section}
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{pageTitle(page, t)}</h1>
      </div>
      <CourseHtml className="text-lg" html={page.bodyHtml} />
      {children}
    </article>
  );
}
