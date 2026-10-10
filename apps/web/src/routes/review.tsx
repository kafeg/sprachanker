// Review (09): tabs — Study (the cards of the deck chosen last, study/session.tsx), Decks (the
// profile's decks as Anki lists them, each language and its courses with New, Learning and To review;
// more new cards today or leaving a course's deck; the decks to take — each installed course's words)
// and My words (words.tsx). "How it works" opens the guide beside.
import { settingOf } from "@sprachanker/schema";
import { HelpCircle, Play, Trash2 } from "lucide-react";
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
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { PairFlags, usePairName } from "@/ui/flags.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel, panelClass } from "@/ui/panel.tsx";
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

type Counts = NonNullable<ReturnType<typeof useDecks>["data"]>["decks"][number]["counts"];

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

/** The profile's decks as Anki lists them, a course's with its language pair; under each deck what it
 *  does, at hand: study it, more new cards today, and for a course's, leave it (after asking). */
function MyDecks({ open }: { open(scope: string): void }) {
  const { t } = useTranslation();
  const decks = useDecks();
  const name = useDeckName();
  const pairName = usePairName();
  const actions = useDeckActions();
  const [leaving, setLeaving] = useState<{ course: string; lang: string; title: string }>();
  if (decks.isPending) return <Loading />;
  if (decks.isError) return <ErrorState error={decks.error} onRetry={() => decks.refetch()} />;
  if (!decks.data.decks.length) return <EmptyState>{t("study.noCards")}</EmptyState>;
  // Narrower counts on a phone, so the deck's name keeps its room.
  const row =
    "grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem_2.25rem] items-center gap-2 px-4 sm:grid-cols-[minmax(0,1fr)_3rem_3rem_3rem]";
  return (
    <div className={panelClass}>
      <div className={cn(row, "border-b py-2 text-xs text-muted-foreground")}>
        <span>{t("study.deck")}</span>
        <span className="text-right">{t("study.count.new")}</span>
        <span className="text-right">{t("study.count.learning")}</span>
        <span className="text-right">{t("study.count.review")}</span>
      </div>
      {decks.data.decks.map((lang) => (
        <div key={lang.scope} className="border-b last:border-b-0">
          {[
            {
              ...lang,
              child: false,
              course: undefined as string | undefined,
              editions: [] as string[],
            },
            ...lang.courses.map((c) => ({ ...c, child: true })),
          ].map((deck) => (
            <div key={deck.scope} className={cn("py-2", deck.child && "border-t border-dashed")}>
              <div className={row}>
                <span className={cn("min-w-0", deck.child ? "pl-5" : "font-semibold")}>
                  <button
                    type="button"
                    onClick={() => open(deck.scope)}
                    className="block max-w-full truncate text-left hover:underline pointer-coarse:py-2.5"
                  >
                    {name(deck.scope)}
                  </button>
                  {deck.editions.map((edition) => (
                    <span
                      key={edition}
                      className="flex items-center gap-2 text-sm font-normal text-muted-foreground"
                    >
                      <PairFlags edition={edition} />
                      {/* On a phone the flags say it; the pair's name is still read out. */}
                      <span className="max-sm:sr-only">{pairName(edition)}</span>
                    </span>
                  ))}
                </span>
                <CountCells counts={deck.counts} />
              </div>
              <div className={cn("mt-1.5 flex flex-wrap gap-2 px-4", deck.child && "pl-9")}>
                <Button variant="outline" size="sm" onClick={() => open(deck.scope)}>
                  <Play className="size-3.5" /> {t("decks.study")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={actions.more.isPending && actions.more.variables?.scope === deck.scope}
                  onClick={() => actions.more.mutate({ scope: deck.scope, count: MORE })}
                >
                  <span className="sm:hidden">{t("decks.moreShort", { count: MORE })}</span>
                  <span className="max-sm:hidden">{t("decks.more", { count: MORE })}</span>
                </Button>
                {deck.course && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLeaving({
                        course: deck.course as string,
                        lang: lang.language,
                        title: `${name(deck.scope)}${deck.editions.length ? ` (${deck.editions.map(pairName).join(", ")})` : ""}`,
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />{" "}
                    <span className="max-sm:sr-only">{t("decks.leave")}</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(undefined)}
        title={t("decks.leaveTitle", { deck: leaving?.title ?? "" })}
        description={t("decks.leaveBody")}
        confirm={t("decks.leave")}
        cancel={t("common.cancel")}
        busy={actions.leave.isPending}
        onConfirm={() =>
          leaving &&
          actions.leave.mutate(
            { course: leaving.course, lang: leaving.lang },
            { onSuccess: () => setLeaving(undefined) },
          )
        }
      />
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
