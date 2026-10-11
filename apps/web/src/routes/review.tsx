// Review (09): tabs — Study (the cards of the deck chosen last, study/session.tsx), Decks (the
// profile's decks as Anki lists them, each language and its courses and imported decks with New,
// Learning and To review; more new cards today, leaving a deck, how its audio and examples stand; the
// decks to take — each of My courses' words and each imported deck —, all their words read aloud or
// given examples (a slot), what was made removed or made again, a deck file imported, an imported deck
// deleted) and My words (words.tsx). "How it works" opens the guide beside.
import { settingOf } from "@sprachanker/schema";
import { useLocation } from "@tanstack/react-router";
import { Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeckActions, useDeckOffers, useDecks } from "@/api/cards.ts";
import { useDeleteDeck } from "@/api/decks.ts";
import { useSetSetting, useSettings } from "@/api/settings.ts";
import { DeckAudio } from "@/study/deck-audio.tsx";
import { DeckImport } from "@/study/deck-import.tsx";
import { deckAnchor } from "@/study/deck-link.tsx";
import { useDeckName } from "@/study/decks.ts";
import { GuideButton } from "@/study/guide.tsx";
import { StudySession } from "@/study/session.tsx";
import { useStudySlots } from "@/study/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { errorText } from "@/ui/error-text.ts";
import { PairFlags, usePairName } from "@/ui/flags.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel, panelClass } from "@/ui/panel.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";
import { cn } from "@/ui/utils.ts";
import { COUNT_TONE } from "@/word/tones.ts";
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
    <span className={cn("text-end tabular-nums", n ? tone : "text-muted-foreground")}>{n}</span>
  );
  return (
    <>
      {cell(counts.new, COUNT_TONE.new)}
      {cell(counts.learning, COUNT_TONE.learning)}
      {cell(counts.review, COUNT_TONE.review)}
    </>
  );
}

/** The profile's decks as Anki lists them, a course's or an imported one's with its language pair;
 *  under each deck what it does, at hand: study it, more new cards today, and for a course's or an
 *  imported one, leave it (after asking) and how its audio and examples stand (made under the deck to
 *  take). */
function MyDecks({ open }: { open(scope: string): void }) {
  const { t } = useTranslation();
  const decks = useDecks();
  if (decks.isPending) return <Loading />;
  if (decks.isError) return <ErrorState error={decks.error} onRetry={() => decks.refetch()} />;
  if (!decks.data.decks.length) return <EmptyState>{t("study.noCards")}</EmptyState>;
  return <DeckRows decks={decks.data.decks} open={open} />;
}

/** The decks' rows. */
function DeckRows({
  decks,
  open,
}: {
  decks: NonNullable<ReturnType<typeof useDecks>["data"]>["decks"];
  open(scope: string): void;
}) {
  const { t } = useTranslation();
  const name = useDeckName();
  const pairName = usePairName();
  const actions = useDeckActions();
  const slots = useStudySlots();
  const [leaving, setLeaving] = useState<{ scope: string; lang: string; title: string }>();
  // Narrower counts on a phone, so the deck's name keeps its room.
  const row =
    "grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem_2.25rem] items-center gap-2 px-4 sm:grid-cols-[minmax(0,1fr)_3rem_3rem_3rem]";
  return (
    <div className={panelClass}>
      <div className={cn(row, "border-b py-2 text-xs text-muted-foreground")}>
        <span>{t("study.deck")}</span>
        <span className="text-end">{t("study.count.new")}</span>
        <span className="text-end">{t("study.count.learning")}</span>
        <span className="text-end">{t("study.count.review")}</span>
      </div>
      {decks.map((lang) => (
        <div key={lang.scope} className="border-b last:border-b-0">
          {[
            { ...lang, child: false, editions: [] as string[] },
            ...lang.decks.map((d) => ({ ...d, child: true })),
          ].map((deck) => (
            <div key={deck.scope} className={cn("py-2", deck.child && "border-t border-dashed")}>
              <div className={row}>
                <span className={cn("min-w-0", deck.child ? "ps-5" : "font-semibold")}>
                  <button
                    type="button"
                    onClick={() => open(deck.scope)}
                    className="block max-w-full truncate text-start hover:underline pointer-coarse:py-2.5"
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
              <div className={cn("mt-1.5 flex flex-wrap gap-2 px-4", deck.child && "ps-9")}>
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
                {deck.child && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLeaving({
                        scope: deck.scope,
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
              {deck.child && <DeckAudio scope={deck.scope} status className="mt-1.5 px-4 ps-9" />}
              {deck.child &&
                deck.editions[0] &&
                slots.deck?.({
                  scope: deck.scope,
                  edition: deck.editions[0],
                  status: true,
                  className: "mt-1.5 px-4 ps-9",
                })}
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
            { scope: leaving.scope, lang: leaving.lang },
            { onSuccess: () => setLeaving(undefined) },
          )
        }
      />
    </div>
  );
}

/** The decks to take: each of My courses' words and each imported deck, with how many are cards
 *  already; all their words read aloud and given examples (what was made removed or made again); an
 *  imported deck deleted (after asking); a deck file imported. A deck named by the address's hash (a
 *  card's way to its deck) in sight. */
function DeckOffers() {
  const { t, i18n } = useTranslation();
  const offers = useDeckOffers();
  const actions = useDeckActions();
  const remove = useDeleteDeck();
  const pairName = usePairName();
  const slots = useStudySlots();
  const hash = useLocation({ select: (l) => l.hash });
  const loaded = !!offers.data;
  useEffect(() => {
    if (hash && loaded) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, loaded]);
  const list = new Intl.ListFormat(i18n.language, { type: "conjunction" });
  const [removing, setRemoving] = useState<{
    id: string;
    title: string;
    /** The profiles studying it: it is deleted only when none does. */
    studiedBy: string[];
  }>();
  const open = [
    ...(offers.data?.courses ?? []).map((o) => ({
      ...o,
      take: { series: o.series, course: o.course, edition: o.edition },
      deck: undefined,
    })),
    ...(offers.data?.imported ?? []).map((o) => ({ ...o, take: { deck: o.deck } })),
    // Every deck stays listed, taken whole or not: what is made for its words is made here (and an
    // imported deck deleted).
  ];
  const taking = actions.take.isPending ? actions.take.variables : undefined;
  const takingThis = (o: (typeof open)[number]) =>
    !!taking &&
    ("deck" in taking
      ? taking.deck === o.deck
      : "course" in o.take && taking.course === o.take.course);
  return (
    <Panel title={t("decks.offers")}>
      <p className="mb-3 text-sm text-muted-foreground">{t("decks.offersHint")}</p>
      <ul className="mb-3 space-y-2 empty:hidden">
        {open.map((o, i) => (
          <li
            key={`${o.scope}:${o.edition}`}
            // A course in two pairs: its first is where a card's way to its deck lands.
            id={open.findIndex((p) => p.scope === o.scope) === i ? deckAnchor(o.scope) : undefined}
            className="scroll-mt-20 space-y-2 rounded-xl border p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="text-sm text-muted-foreground">
                  {pairName(o.edition)} · {t("decks.words", { words: o.words, mine: o.mine })}
                </span>
              </span>
              {o.mine < o.words && (
                <Button
                  variant="outline"
                  loading={takingThis(o)}
                  onClick={() => actions.take.mutate(o.take)}
                >
                  {o.mine ? t("decks.takeRest", { count: o.words - o.mine }) : t("decks.take")}
                </Button>
              )}
              {o.deck && (
                <Button
                  variant="outline"
                  aria-label={t("decks.remove")}
                  onClick={() =>
                    setRemoving({
                      id: o.deck,
                      title: o.title,
                      studiedBy: "studiedBy" in o ? o.studiedBy : [],
                    })
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <DeckAudio scope={o.scope} title={o.title} />
            {slots.deck?.({ scope: o.scope, edition: o.edition, title: o.title })}
          </li>
        ))}
      </ul>
      {actions.take.isError && (
        <p className="mb-3 text-sm text-wrong">{errorText(t, actions.take.error)}</p>
      )}
      <DeckImport />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(undefined);
            remove.reset();
          }
        }}
        title={t("decks.removeTitle", { deck: removing?.title ?? "" })}
        description={
          remove.isError
            ? errorText(t, remove.error)
            : removing?.studiedBy.length
              ? t("decks.removeStudied", {
                  count: removing.studiedBy.length,
                  profiles: list.format(removing.studiedBy),
                })
              : t("decks.removeBody")
        }
        confirm={t("decks.remove")}
        cancel={removing?.studiedBy.length ? t("common.close") : t("common.cancel")}
        busy={remove.isPending}
        hideConfirm={!!removing?.studiedBy.length}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(undefined) })
        }
      />
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
    ...d.decks.map((c) => c.scope),
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
  return (
    <Page title={t("nav.review")} actions={<GuideButton />}>
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
    </Page>
  );
}
