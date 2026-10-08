// Review (09): tabs — Study (the cards of the deck chosen last, study/session.tsx), Decks (the
// profile's decks as Anki lists them, each language and its courses with New, Learning and To review;
// more new cards today or leaving a course's deck; the decks to take — each installed course's words)
// and My words (words.tsx). "How it works" opens the guide beside.
import { settingOf } from "@sprachanker/schema";
import { HelpCircle, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeckActions,
  useDeckOffers,
  useDecks,
  useSetSetting,
  useSettings,
} from "@/api/hooks.ts";
import { useDeckName } from "@/study/decks.ts";
import { StudyGuide } from "@/study/guide.tsx";
import { StudySession } from "@/study/session.tsx";
import { COUNT_TONE } from "@/study/tones.ts";
import { Button } from "@/ui/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu.tsx";
import { usePairName } from "@/ui/flags.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { cn } from "@/ui/utils.ts";
import { MyWords } from "./words.tsx";

export type ReviewTab = "study" | "decks" | "words";
const PATH: Record<ReviewTab, string> = {
  study: "/review",
  decks: "/review/decks",
  words: "/review/words",
};
/** New cards one "more today" adds. */
const MORE = 10;

type Counts = { new: number; learning: number; review: number };

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

/** The profile's decks: a deck chosen is studied; a course's has more new cards today and leaving. */
function MyDecks({ open }: { open(scope: string): void }) {
  const { t } = useTranslation();
  const decks = useDecks();
  const name = useDeckName();
  const actions = useDeckActions();
  if (decks.isPending) return <Loading />;
  if (decks.isError) return <ErrorState error={decks.error} onRetry={() => decks.refetch()} />;
  if (!decks.data.decks.length) return <EmptyState>{t("study.noCards")}</EmptyState>;
  const row = "grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_2.75rem] items-center gap-2 px-4";
  return (
    <div className="rounded-2xl border bg-card">
      <div className={cn(row, "border-b py-2 text-xs text-muted-foreground")}>
        <span>{t("study.deck")}</span>
        <span className="text-right">{t("study.count.new")}</span>
        <span className="text-right">{t("study.count.learning")}</span>
        <span className="text-right">{t("study.count.review")}</span>
        <span />
      </div>
      {decks.data.decks.map((lang) => (
        <div key={lang.scope} className="border-b last:border-b-0">
          {[
            { ...lang, child: false, course: undefined as string | undefined },
            ...lang.courses.map((c) => ({ ...c, child: true })),
          ].map((deck) => (
            <div key={deck.scope} className={cn(row, "min-h-11 py-1 hover:bg-accent/50")}>
              <button
                type="button"
                onClick={() => open(deck.scope)}
                className={cn("truncate py-2 text-left", deck.child ? "pl-5" : "font-semibold")}
              >
                {name(deck.scope)}
              </button>
              <CountCells counts={deck.counts} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("decks.actions", { deck: name(deck.scope) })}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => actions.more.mutate({ scope: deck.scope, count: MORE })}
                  >
                    {t("decks.more", { count: MORE })}
                  </DropdownMenuItem>
                  {deck.course && (
                    <DropdownMenuItem
                      onSelect={() =>
                        actions.leave.mutate({ course: deck.course as string, lang: lang.language })
                      }
                    >
                      {t("decks.leave")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The decks to take: each installed course's words, with how many are cards already. */
function DeckOffers() {
  const { t } = useTranslation();
  const offers = useDeckOffers();
  const actions = useDeckActions();
  const pairName = usePairName();
  const open = (offers.data?.offers ?? []).filter((o) => o.mine < o.words);
  if (!open.length) return null;
  return (
    <Panel title={t("decks.offers")}>
      <p className="mb-3 text-sm text-muted-foreground">{t("decks.offersHint")}</p>
      <ul className="space-y-2">
        {open.map((o) => (
          <li
            key={`${o.key}:${o.edition}`}
            className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{o.title}</span>
              <span className="text-sm text-muted-foreground">
                {pairName(o.edition)} · {t("decks.words", { words: o.words, mine: o.mine })}
              </span>
            </span>
            <Button
              variant="outline"
              loading={actions.take.isPending && actions.take.variables?.course === o.course}
              onClick={() =>
                actions.take.mutate({ series: o.series, course: o.course, edition: o.edition })
              }
            >
              {o.mine ? t("decks.takeRest", { count: o.words - o.mine }) : t("decks.take")}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
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
  const stored = settingOf(settings.data, "review.deck");
  const deck = stored && scopes.includes(stored) ? stored : decks.data?.decks[0]?.scope;
  return {
    deck,
    pending: decks.isPending || settings.isPending,
    error: decks.error,
    retry: () => decks.refetch(),
    choose: (scope: string) => set.mutate({ key: "review.deck", value: scope }),
  };
}

function Study() {
  const { t } = useTranslation();
  const name = useDeckName();
  const open = useOpenDeck();
  if (open.pending) return <Loading />;
  if (open.error) return <ErrorState error={open.error} onRetry={open.retry} />;
  if (!open.deck) return <EmptyState>{t("study.noCards")}</EmptyState>;
  return (
    <div className="mx-auto flex max-w-2xl flex-col max-sm:min-h-[calc(100dvh-17rem)]">
      <p className="mb-3 text-sm text-muted-foreground">
        {t("decks.studying", { deck: name(open.deck) })}
      </p>
      <StudySession scope={open.deck} />
    </div>
  );
}

export function ReviewPage({ tab, go }: { tab: ReviewTab; go(tab: ReviewTab): void }) {
  const { t } = useTranslation();
  const open = useOpenDeck();
  const [guide, setGuide] = useState(false);
  return (
    <Page
      title={t("nav.review")}
      actions={
        <Button variant="outline" onClick={() => setGuide(true)}>
          <HelpCircle /> {t("guide.open")}
        </Button>
      }
    >
      <SectionTabs
        label={t("nav.review")}
        tabs={(["study", "decks", "words"] as const).map((id) => ({
          to: PATH[id],
          label: t(`decks.tabs.${id}`),
          current: tab === id,
        }))}
      />
      {tab === "study" && <Study />}
      {tab === "decks" && (
        <div className="max-w-3xl space-y-6">
          <MyDecks
            open={(scope) => {
              open.choose(scope);
              go("study");
            }}
          />
          <DeckOffers />
        </div>
      )}
      {tab === "words" && <MyWords />}
      <SideSheet open={guide} onOpenChange={setGuide} title={t("guide.title")}>
        <StudyGuide />
      </SideSheet>
    </Page>
  );
}
