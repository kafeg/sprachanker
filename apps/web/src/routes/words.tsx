// My words (09), under Decks: every word with cards as a table, like Anki's browser — search by word or
// translation, filters by deck (a language, a course) and by state with their counts, columns sortable;
// a row opens the word sheet. On a phone a row takes two lines.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type MyWord, useWords } from "@/api/hooks.ts";
import { useDeckName } from "@/study/decks.ts";
import { useDueText } from "@/study/time.ts";
import { COUNT_TONE } from "@/study/tones.ts";
import { WordSheet } from "@/study/word-sheet.tsx";
import { Chip } from "@/ui/chip.tsx";
import { Input } from "@/ui/components/input.tsx";
import { ListRow } from "@/ui/history.tsx";
import { EmptyState, ErrorState, Loading } from "@/ui/page.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GenderWord } from "@/word/word.tsx";

const STATES = ["all", "new", "learning", "review", "suspended", "marked"] as const;
type StateFilter = (typeof STATES)[number];
type Column = "word" | "translation" | "state" | "due";
const STAGE_ORDER = { new: 0, learning: 1, review: 2 };

const inState = (w: MyWord, s: StateFilter) =>
  s === "all" ||
  (s === "suspended" ? w.suspended : s === "marked" ? w.marked : !w.suspended && w.state === s);

/** Sort keys; words without a due date go last. */
const KEY: Record<Column, (w: MyWord) => string | number> = {
  word: (w) => w.display.target.replace(/^(der|die|das)\s+/i, "").toLowerCase(),
  translation: (w) => (w.display.translation ?? "").toLowerCase(),
  state: (w) => (w.suspended ? 3 : STAGE_ORDER[w.state]),
  due: (w) => w.due ?? Number.MAX_SAFE_INTEGER,
};

/** Review → My words: the profile's words as Anki's browser shows them. */
export function MyWords() {
  const { t, i18n } = useTranslation();
  const words = useWords();
  const deckName = useDeckName();
  const due = useDueText();
  const [query, setQuery] = useState("");
  const [deck, setDeck] = useState("all");
  const [state, setState] = useState<StateFilter>("all");
  const [sort, setSort] = useState<{ by: Column; desc: boolean }>();
  const [open, setOpen] = useState<string>();

  if (words.isPending) return <Loading />;
  if (words.isError) return <ErrorState error={words.error} onRetry={() => words.refetch()} />;
  const all = words.data.words;
  if (!all.length) return <EmptyState>{t("study.noCards")}</EmptyState>;

  // Decks as in Decks: each language, then the courses in it.
  const langs = [...new Set(all.map((w) => w.lang))];
  const decks = langs.flatMap((lang) => [
    `lang:${lang}`,
    ...[...new Set(all.filter((w) => w.lang === lang).map((w) => w.course))].map(
      (c) => `course:${c}`,
    ),
  ]);
  const inDeck = (w: MyWord) =>
    deck === "all" ||
    (deck.startsWith("lang:") ? w.lang === deck.slice(5) : w.course === deck.slice(7));
  const q = query.trim().toLocaleLowerCase(i18n.language);
  const found = all.filter(
    (w) =>
      inDeck(w) &&
      (!q ||
        w.display.target.toLocaleLowerCase(i18n.language).includes(q) ||
        (w.display.translation ?? "").toLocaleLowerCase(i18n.language).includes(q)),
  );
  const shown = found.filter((w) => inState(w, state));
  if (sort) {
    const key = KEY[sort.by];
    shown.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const order = typeof x === "number" ? x - (y as number) : x.localeCompare(y as string);
      return sort.desc ? -order : order;
    });
  }
  const now = Date.now();
  const sortBy = (by: Column) =>
    setSort(sort?.by === by ? { by, desc: !sort.desc } : { by, desc: false });
  const heading = (by: Column, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => sortBy(by)}
      className={cn("text-left hover:text-foreground", className)}
    >
      {label}
      {sort?.by === by && (sort.desc ? " ↓" : " ↑")}
    </button>
  );
  const row =
    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_6rem]";

  return (
    <div>
      <div className="max-w-4xl space-y-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("myWords.search")}
          aria-label={t("myWords.search")}
          className="h-11 rounded-xl bg-card px-4 text-base md:text-base dark:bg-card"
        />
        <div className="flex flex-wrap gap-2">
          <Chip on={deck === "all"} onClick={() => setDeck("all")}>
            {t("myWords.allDecks")}
          </Chip>
          {(langs.length > 1 ? decks : decks.filter((d) => d.startsWith("course:"))).map((d) => (
            <Chip key={d} on={deck === d} onClick={() => setDeck(d)}>
              {deckName(d)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <Chip key={s} on={state === s} onClick={() => setState(s)}>
              {s === "all" ? t("myWords.all") : t(`myWords.state.${s}`)}{" "}
              <span className="tabular-nums text-muted-foreground">
                {found.filter((w) => inState(w, s)).length}
              </span>
            </Chip>
          ))}
        </div>
        <div className={cn(panelClass, "overflow-hidden")}>
          <div
            className={cn(row, "hidden border-b px-4 py-2 text-xs text-muted-foreground sm:grid")}
          >
            {heading("word", t("myWords.column.word"))}
            {heading("translation", t("myWords.column.translation"))}
            {heading("state", t("myWords.column.state"))}
            {heading("due", t("myWords.column.due"), "text-right")}
          </div>
          {shown.length ? (
            <ul className="divide-y">
              {shown.map((w) => (
                <li key={w.cardId}>
                  <ListRow
                    chevron={false}
                    flush
                    onClick={() => setOpen(w.cardId)}
                    className={cn(row, "items-baseline", w.suspended && "text-muted-foreground")}
                  >
                    <span className="truncate sm:order-1">
                      <TargetLang value={w.lang}>
                        <GenderWord text={w.display.target} gender={w.display.gender} />
                      </TargetLang>
                      {w.marked && <span className="ml-1 text-amber-500">★</span>}
                    </span>
                    <span
                      className={cn(
                        "text-right text-sm sm:order-3 sm:text-left",
                        !w.suspended && COUNT_TONE[w.state],
                      )}
                    >
                      {w.suspended ? t("myWords.state.suspended") : t(`myWords.state.${w.state}`)}
                    </span>
                    <span className="truncate text-sm text-muted-foreground sm:order-2 sm:text-base sm:text-foreground">
                      {w.display.translation}
                    </span>
                    <span className="text-right text-sm text-muted-foreground sm:order-4">
                      {w.suspended ? "—" : due(w.due, now)}
                    </span>
                  </ListRow>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-center text-muted-foreground">{t("myWords.nothing")}</p>
          )}
        </div>
      </div>
      <WordSheet word={all.find((w) => w.cardId === open)} onClose={() => setOpen(undefined)} />
    </div>
  );
}
