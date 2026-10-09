// Steps of the lesson besides its exercises (09): a reading page (grammar, culture) and the action bar
// they share — back, skip where a step can be left undone, next.
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { CourseSections } from "@/ui/course-html.tsx";
import { cn } from "@/ui/utils.ts";
import { pageTitle } from "./reference.tsx";

/** A step's heading: what part of the lesson it is (small capitals), its title, what follows. */
export function StepHeader({
  label,
  title,
  children,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{title}</h1>
      {children}
    </div>
  );
}

/** The bar under a step, in the same place as the exercises' one: back, skip, next. */
export function StepBar({
  onBack,
  onNext,
  onSkip,
  next,
  nextDisabled,
  note,
  extra,
}: {
  onBack(): void;
  onNext(): void;
  /** Leave the step undone (it shows as skipped). */
  onSkip?(): void;
  /** The main button's label (next by default). */
  next?: string;
  nextDisabled?: boolean;
  /** A line about what the main button waits for (an exercise's Check). */
  note?: React.ReactNode;
  /** Another button before Skip (an exercise's Answer again). */
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <Button variant="ghost" size="lg" onClick={onBack}>
        {t("lesson.previous")}
      </Button>
      {note && (
        <p className="order-first w-full text-center text-xs text-muted-foreground sm:order-none sm:ml-auto sm:w-auto sm:text-right sm:text-sm">
          {note}
        </p>
      )}
      <div className={cn("flex gap-2", note ? "ml-auto sm:ml-0" : "ml-auto")}>
        {extra}
        {onSkip && (
          <Button variant="ghost" size="lg" onClick={onSkip}>
            {t("lesson.skip")}
          </Button>
        )}
        <Button
          size="lg"
          className="w-32 text-base sm:w-40"
          onClick={onNext}
          disabled={nextDisabled}
        >
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
  page: { title?: string; bodyHtml: string; part?: number };
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <StepHeader label={section} title={pageTitle(page, t) || section} />
      <CourseSections className="text-lg" html={page.bodyHtml} />
      {children}
    </article>
  );
}
