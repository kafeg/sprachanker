// Review (09): opens straight on the cards of the deck chosen last (the study session,
// study/session.tsx); Decks lists them as in Anki — each language the cards teach, and under it the
// courses the words were met in — with New, Learning and To Review counts; a deck chosen is studied.
// My words (words.tsx) opens from Decks.
import { Link } from "@tanstack/react-router";
import { BookA } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourses, useDecks, useSetSetting, useSettings } from "@/api/hooks.ts";
import { languageName } from "@/i18n/index.ts";
import { COUNT_TONE, StudySession } from "@/study/session.tsx";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { cn } from "@/ui/utils.ts";

type Counts = { new: number; learning: number; review: number };

/** A deck's name: a course's title, or a language. */
export function useDeckName() {
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

/** The deck Review opens on: the one chosen last, else the first language with cards. */
function useOpenDeck() {
  const decks = useDecks();
  const settings = useSettings();
  const set = useSetSetting();
  const scopes = (decks.data?.decks ?? []).flatMap((d) => [
    d.scope,
    ...d.courses.map((c) => c.scope),
  ]);
  const stored = settings.data?.["review.deck"];
  const deck =
    typeof stored === "string" && scopes.includes(stored) ? stored : decks.data?.decks[0]?.scope;
  return {
    deck,
    pending: decks.isPending || settings.isPending,
    error: decks.error,
    retry: () => decks.refetch(),
    choose: (scope: string) => set.mutate({ key: "review.deck", value: scope }),
  };
}

/** Review (09): the cards of the deck chosen last, straight away; Decks lists them all. */
export function ReviewPage({
  showDecks,
  go,
}: {
  showDecks: boolean;
  go(next: { decks?: boolean }): void;
}) {
  const { t } = useTranslation();
  const name = useDeckName();
  const open = useOpenDeck();
  if (showDecks)
    return (
      <Page title={t("study.toDecks")}>
        <div className="flex max-w-2xl items-center justify-between gap-2">
          <BackLink onClick={() => go({})}>{t("study.toCards")}</BackLink>
          <Link
            to="/review/words"
            className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-4 font-medium hover:bg-accent"
          >
            <BookA className="size-4" /> {t("myWords.title")}
          </Link>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("study.howTo")}</p>
        <Decks
          open={(scope) => {
            open.choose(scope);
            go({});
          }}
        />
      </Page>
    );
  if (open.pending) return <Loading />;
  if (open.error) return <ErrorState error={open.error} onRetry={open.retry} />;
  if (!open.deck)
    return (
      <Page title={t("nav.review")}>
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
          {t("study.noCards")}
        </p>
      </Page>
    );
  return (
    <Page title={name(open.deck)}>
      <BackLink onClick={() => go({ decks: true })}>{t("study.toDecks")}</BackLink>
      <div className="mx-auto flex max-w-2xl flex-col max-sm:min-h-[calc(100dvh-15rem)]">
        <StudySession scope={open.deck} />
      </div>
    </Page>
  );
}

export function BackLink({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 text-sm text-muted-foreground underline pointer-coarse:min-h-11"
    >
      {children}
    </button>
  );
}
