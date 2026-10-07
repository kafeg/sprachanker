// Review (09) as in Anki: the decks — each language the cards teach, and under it the courses the words
// were met in — with New, Learning and To Review counts; a deck's overview with "Study now"; then the
// study session (study/session.tsx). The deck and the session are kept in the address.
import { useTranslation } from "react-i18next";
import { useCardActions, useCourses, useDecks, useStudy } from "@/api/hooks.ts";
import { languageName } from "@/i18n/index.ts";
import { COUNT_TONE, StudySession } from "@/study/session.tsx";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { cn } from "@/ui/utils.ts";

type Counts = { new: number; learning: number; review: number };

/** A deck's name: a course's title, or a language. */
function useDeckName() {
  const { i18n } = useTranslation();
  const courses = useCourses().data ?? [];
  return (scope: string) => {
    if (scope.startsWith("lang:")) return languageName(scope.slice(5), i18n.language, true);
    const key = scope.slice("course:".length);
    const course = courses.find((c) => c.key === key);
    return (course && (course.titles[course.editions[0] ?? ""] || course.key)) ?? key;
  };
}

function CountCells({ counts }: { counts: Counts }) {
  const cell = (n: number, tone: string) => (
    <span className={cn("text-right tabular-nums", n ? tone : "text-muted-foreground")}>{n}</span>
  );
  return (
    <>
      {cell(counts.new, COUNT_TONE.new)}
      {cell(counts.learning, COUNT_TONE.learning)}
      {cell(counts.review, COUNT_TONE.review)}
    </>
  );
}

function Decks({ open }: { open(scope: string): void }) {
  const { t } = useTranslation();
  const decks = useDecks();
  const name = useDeckName();
  if (decks.isPending) return <Loading />;
  if (decks.isError) return <ErrorState error={decks.error} onRetry={() => decks.refetch()} />;
  if (!decks.data.decks.length)
    return (
      <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
        {t("study.noCards")}
      </p>
    );
  const row = "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-2 px-4";
  return (
    <div className="max-w-2xl rounded-2xl border bg-card">
      <div className={cn(row, "border-b py-2 text-xs text-muted-foreground")}>
        <span>{t("study.deck")}</span>
        <span className="text-right">{t("study.count.new")}</span>
        <span className="text-right">{t("study.count.learning")}</span>
        <span className="text-right">{t("study.count.review")}</span>
      </div>
      {decks.data.decks.map((lang) => (
        <div key={lang.scope} className="border-b last:border-b-0">
          {[{ ...lang, child: false }, ...lang.courses.map((c) => ({ ...c, child: true }))].map(
            (deck) => (
              <button
                type="button"
                key={deck.scope}
                onClick={() => open(deck.scope)}
                className={cn(
                  row,
                  "min-h-11 w-full py-2 text-left hover:bg-accent",
                  deck.child ? "pl-9" : "font-semibold",
                )}
              >
                <span className="truncate">{name(deck.scope)}</span>
                <CountCells counts={deck.counts} />
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/** Anki's overview: the deck's counts, Study now, and Unbury when cards are buried. */
function Overview({ scope, study }: { scope: string; study(): void }) {
  const { t } = useTranslation();
  const data = useStudy(scope);
  const actions = useCardActions();
  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const { counts, buried } = data.data;
  const line = (label: string, n: number, tone: string) => (
    <div className="flex justify-between gap-6">
      <span>{label}</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{n}</span>
    </div>
  );
  return (
    <div className="max-w-sm space-y-5 rounded-2xl border bg-card p-6">
      <div className="space-y-1.5 text-lg">
        {line(t("study.overview.new"), counts.new, COUNT_TONE.new)}
        {line(t("study.overview.learning"), counts.learning, COUNT_TONE.learning)}
        {line(t("study.overview.review"), counts.review, COUNT_TONE.review)}
      </div>
      <Button size="lg" className="w-full text-base" autoFocus onClick={study}>
        {t("study.studyNow")}
      </Button>
      {buried > 0 && (
        <Button variant="outline" className="w-full" onClick={() => actions.unbury.mutate(scope)}>
          {t("study.unbury")}
        </Button>
      )}
    </div>
  );
}

export function ReviewPage({
  deck,
  studying,
  go,
}: {
  deck?: string;
  studying: boolean;
  go(next: { deck?: string; study?: boolean }): void;
}) {
  const { t } = useTranslation();
  const name = useDeckName();
  if (!deck)
    return (
      <Page title={t("nav.review")}>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("study.howTo")}</p>
        <Decks open={(scope) => go({ deck: scope })} />
      </Page>
    );
  return (
    <Page title={name(deck)}>
      <button
        type="button"
        onClick={() => go(studying ? { deck } : {})}
        className="mb-4 text-sm text-muted-foreground underline pointer-coarse:min-h-11"
      >
        ← {studying ? t("study.toOverview") : t("study.toDecks")}
      </button>
      {studying ? (
        <div className="mx-auto flex max-w-2xl flex-col max-sm:min-h-[calc(100dvh-15rem)]">
          <StudySession scope={deck} />
        </div>
      ) : (
        <Overview scope={deck} study={() => go({ deck, study: true })} />
      )}
    </Page>
  );
}
