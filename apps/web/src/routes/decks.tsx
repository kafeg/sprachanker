// Review → Decks (owner, 2026-10-15: one row a deck). Each language the profile studies, its counts
// and Study, then its decks — a course's or an imported one —, each in a row: its counts, Study and a
// menu (more new cards today, leave it, export it to a file, delete an imported one); how many of its
// words are cards (the rest added); how its audio and examples stand in a line that opens what makes
// them. Below, the decks to take — none of their words cards yet —, the same way; a deck file
// imported above all.

import { useLocation } from "@tanstack/react-router";
import { ChevronDown, MoreHorizontal, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeckActions, useDeckOffers, useDecks } from "@/api/cards.ts";
import { inPhoneApp } from "@/api/client.ts";
import { useDeleteDeck, useExportDeck } from "@/api/decks.ts";
import { DeckAudio } from "@/study/deck-audio.tsx";
import { DeckImport } from "@/study/deck-import.tsx";
import { deckAnchor } from "@/study/deck-link.tsx";
import { useDeckName } from "@/study/decks.ts";
import { useStudySlots } from "@/study/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { errorText } from "@/ui/error-text.ts";
import { PairFlags, usePairName } from "@/ui/flags.tsx";
import { useBytes } from "@/ui/format.ts";
import { EmptyState, ErrorState, Loading } from "@/ui/page.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { COUNT_TONE } from "@/word/tones.ts";

/** New cards one "more today" adds. */
const MORE = 10;

type Lang = NonNullable<ReturnType<typeof useDecks>["data"]>["decks"][number];
type Counts = Lang["counts"];
type Offers = NonNullable<ReturnType<typeof useDeckOffers>["data"]>;
/** A deck to take: a course's words in a pair, or an imported deck. */
type Offer = (Offers["courses"][number] | Offers["imported"][number]) & { deck?: string };
/** What a deck to take is called: the learner's own (Finds) by the app's name. */
const useOfferTitle = () => {
  const { t } = useTranslation();
  return (o: Offer) => ("own" in o && o.own ? t("decks.finds") : o.title);
};

/** New, learning and to review: each its colour, its name beside (short). */
function CountLine({ counts, className }: { counts: Counts; className?: string }) {
  const { t } = useTranslation();
  const one = (n: number, tone: string, label: string) => (
    <span>
      <span className={cn("font-semibold tabular-nums", n ? tone : "text-muted-foreground")}>
        {n}
      </span>{" "}
      {label}
    </span>
  );
  return (
    <span className={cn("flex flex-wrap gap-x-2 text-sm text-muted-foreground", className)}>
      {one(counts.new, COUNT_TONE.new, t("study.count.new"))}
      <span aria-hidden="true">·</span>
      {one(counts.learning, COUNT_TONE.learning, t("study.count.learning"))}
      <span aria-hidden="true">·</span>
      {one(counts.review, COUNT_TONE.review, t("study.count.review"))}
    </span>
  );
}

/** How a deck's audio and examples stand, in a line; opened, what makes them. */
function DeckExtras({ offer, scope }: { offer?: Offer; scope: string }) {
  const { t } = useTranslation();
  const slots = useStudySlots();
  const titleOf = useOfferTitle();
  const [open, setOpen] = useState(false);
  const edition = offer?.edition;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <DeckAudio scope={scope} status />
        {edition && slots.deck?.({ scope, edition, status: true })}
        {offer && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline pointer-coarse:min-h-11"
          >
            {t("decks.extras")}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && offer && (
        <div className="space-y-3 rounded-lg bg-muted/50 p-3">
          <DeckAudio scope={scope} title={titleOf(offer)} />
          {edition && slots.deck?.({ scope, edition, title: titleOf(offer) })}
        </div>
      )}
    </div>
  );
}

/** How many of a deck's words are cards, and the rest added. */
function Taken({ offer }: { offer: Offer }) {
  const { t } = useTranslation();
  const actions = useDeckActions();
  const taking = actions.take.isPending && sameDeck(actions.take.variables, offer);
  if (offer.mine >= offer.words) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <div
        className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round((offer.mine / Math.max(1, offer.words)) * 100)}%` }}
        />
      </div>
      <span>{t("decks.progress", { mine: offer.mine, words: offer.words })}</span>
      <Button variant="outline" size="sm" loading={taking} onClick={() => take(actions, offer)}>
        {offer.mine ? t("decks.takeRest", { count: offer.words - offer.mine }) : t("decks.take")}
      </Button>
    </div>
  );
}

const takeOf = (offer: Offer) =>
  offer.deck
    ? { deck: offer.deck }
    : {
        series: (offer as Offers["courses"][number]).series,
        course: (offer as Offers["courses"][number]).course,
        edition: offer.edition,
      };
const take = (actions: ReturnType<typeof useDeckActions>, offer: Offer) =>
  actions.take.mutate(takeOf(offer));
/** The deck being taken now is this one. */
const sameDeck = (taking: unknown, offer: Offer) =>
  !!taking && JSON.stringify(taking) === JSON.stringify(takeOf(offer));

/** What is asked before a deck goes: leaving it (its cards), or deleting an imported one. */
type Asking =
  | { leave: { scope: string; lang: string; title: string } }
  | { remove: { id: string; title: string; studiedBy: string[] } };

export function DecksTab({
  open,
  download,
}: {
  open(scope: string): void;
  /** Tests give their own: a deck's file downloaded. */
  download?: (url: string, fileName: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const decks = useDecks();
  const offers = useDeckOffers();
  const actions = useDeckActions();
  const remove = useDeleteDeck();
  const exported = useExportDeck(download);
  const bytes = useBytes();
  const name = useDeckName();
  const titleOf = useOfferTitle();
  const pairName = usePairName();
  const [asking, setAsking] = useState<Asking>();
  // A card's way to its deck (the address's hash) in sight once the decks are there.
  const hash = useLocation({ select: (l) => l.hash });
  const loaded = !!offers.data && !!decks.data;
  useEffect(() => {
    if (hash && loaded) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, loaded]);
  if (decks.isPending || offers.isPending) return <Loading />;
  if (decks.isError) return <ErrorState error={decks.error} onRetry={() => decks.refetch()} />;
  const all: Offer[] = [...(offers.data?.courses ?? []), ...(offers.data?.imported ?? [])];
  const taken = new Set(decks.data.decks.flatMap((l) => l.decks.map((d) => d.scope)));
  const offerOf = (scope: string) => all.find((o) => o.scope === scope);
  const toTake = all.filter((o) => !taken.has(o.scope));
  // A course in two pairs: its first is where a card's way to its deck lands.
  const anchor = (scope: string, i: number, list: { scope: string }[]) =>
    list.findIndex((o) => o.scope === scope) === i ? deckAnchor(scope) : undefined;
  const list = new Intl.ListFormat(i18n.language, { type: "conjunction" });
  const menu = (items: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("study.more")}>
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{items}</DropdownMenuContent>
    </DropdownMenu>
  );
  const more = (scope: string) => (
    <DropdownMenuItem onSelect={() => actions.more.mutate({ scope, count: MORE })}>
      {t("decks.more", { count: MORE })}
    </DropdownMenuItem>
  );
  // A deck as a file: an imported one always, a course's once something was made for its words (not
  // in the phone app: it keeps no files to give).
  const exportItem = (o: Offer) =>
    !inPhoneApp &&
    (o.deck || ("made" in o && o.made)) && (
      <DropdownMenuItem onSelect={() => exported.mutate(o.scope)}>
        {t("decks.export")}
      </DropdownMenuItem>
    );
  const removeItem = (o: Offer) =>
    o.deck && (
      <DropdownMenuItem
        onSelect={() =>
          setAsking({
            remove: {
              id: o.deck as string,
              title: titleOf(o),
              studiedBy: "studiedBy" in o ? (o.studiedBy as string[]) : [],
            },
          })
        }
      >
        {t("decks.remove")}…
      </DropdownMenuItem>
    );

  return (
    <div className="max-w-3xl space-y-8">
      {!inPhoneApp && (
        <div className="flex justify-end">
          <DeckImport />
        </div>
      )}
      {!decks.data.decks.length && <EmptyState>{t("study.noCards")}</EmptyState>}
      {decks.data.decks.map((lang: Lang) => (
        <section key={lang.scope} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-xl font-bold">
              <button
                type="button"
                onClick={() => open(lang.scope)}
                className="hover:underline pointer-coarse:py-2"
              >
                {name(lang.scope)}
              </button>
            </h2>
            <CountLine counts={lang.counts} className="me-auto" />
            <span className="flex shrink-0 items-center gap-1">
              <Button onClick={() => open(lang.scope)}>
                <Play /> {t("decks.study")}
              </Button>
              {menu(more(lang.scope))}
            </span>
          </div>
          <ul className={cn(panelClass, "divide-y")}>
            {lang.decks.map((deck, i) => {
              const offer = offerOf(deck.scope);
              const title = name(deck.scope);
              return (
                <li
                  key={deck.scope}
                  id={anchor(deck.scope, i, lang.decks)}
                  className="scroll-mt-20 space-y-2 p-4"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-[1_1_12rem]">
                      <button
                        type="button"
                        onClick={() => open(deck.scope)}
                        className="block max-w-full truncate text-start font-semibold hover:underline pointer-coarse:py-2"
                      >
                        {title}
                      </button>
                      {deck.editions.map((edition) => (
                        <span
                          key={edition}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <PairFlags edition={edition} />
                          <span className="max-sm:sr-only">{pairName(edition)}</span>
                        </span>
                      ))}
                    </span>
                    <CountLine counts={deck.counts} />
                    {/* Study and its menu together: on a phone they wrap as one. */}
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => open(deck.scope)}>
                        <Play className="size-3.5" /> {t("decks.study")}
                      </Button>
                      {menu(
                        <>
                          {more(deck.scope)}
                          <DropdownMenuItem
                            onSelect={() =>
                              setAsking({
                                leave: {
                                  scope: deck.scope,
                                  lang: lang.language,
                                  title: `${title}${deck.editions.length ? ` (${deck.editions.map(pairName).join(", ")})` : ""}`,
                                },
                              })
                            }
                          >
                            {t("decks.leave")}
                          </DropdownMenuItem>
                          {offer && exportItem(offer)}
                          {offer && removeItem(offer)}
                        </>,
                      )}
                    </span>
                  </div>
                  {offer && <Taken offer={offer} />}
                  <DeckExtras offer={offer} scope={deck.scope} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {toTake.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">{t("decks.available")}</h2>
          <ul className={cn(panelClass, "divide-y")}>
            {toTake.map((o, i) => (
              <li
                key={`${o.scope}:${o.edition}`}
                id={anchor(o.scope, i, toTake)}
                className="scroll-mt-20 space-y-2 p-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span data-deck-name className="min-w-0 flex-[1_1_14rem]">
                    <span className="block font-semibold">{titleOf(o)}</span>
                    <span className="text-sm text-muted-foreground">
                      {pairName(o.edition)} · {t("decks.words", { words: o.words, mine: o.mine })}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    loading={actions.take.isPending && sameDeck(actions.take.variables, o)}
                    onClick={() => take(actions, o)}
                  >
                    {o.mine ? t("decks.takeRest", { count: o.words - o.mine }) : t("decks.take")}
                  </Button>
                  {(exportItem(o) || o.deck) &&
                    menu(
                      <>
                        {exportItem(o)}
                        {removeItem(o)}
                      </>,
                    )}
                </div>
                <DeckExtras offer={o} scope={o.scope} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {actions.take.isError && (
        <p className="text-sm text-wrong">{errorText(t, actions.take.error)}</p>
      )}
      {exported.isError && <p className="text-sm text-wrong">{errorText(t, exported.error)}</p>}
      {exported.data && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("bundle.export.started", {
            file: exported.data.fileName,
            size: bytes(exported.data.bytes),
          })}
        </p>
      )}

      <ConfirmDialog
        open={!!asking && "leave" in asking}
        onOpenChange={(o) => !o && setAsking(undefined)}
        title={t("decks.leaveTitle", {
          deck: asking && "leave" in asking ? asking.leave.title : "",
        })}
        description={t("decks.leaveBody")}
        confirm={t("decks.leaveConfirm")}
        cancel={t("common.cancel")}
        busy={actions.leave.isPending}
        onConfirm={() =>
          asking &&
          "leave" in asking &&
          actions.leave.mutate(
            { scope: asking.leave.scope, lang: asking.leave.lang },
            { onSuccess: () => setAsking(undefined) },
          )
        }
      />
      <ConfirmDialog
        open={!!asking && "remove" in asking}
        onOpenChange={(o) => {
          if (!o) {
            setAsking(undefined);
            remove.reset();
          }
        }}
        title={t("decks.removeTitle", {
          deck: asking && "remove" in asking ? asking.remove.title : "",
        })}
        description={
          remove.isError
            ? errorText(t, remove.error)
            : asking && "remove" in asking && asking.remove.studiedBy.length
              ? t("decks.removeStudied", {
                  count: asking.remove.studiedBy.length,
                  profiles: list.format(asking.remove.studiedBy),
                })
              : t("decks.removeBody")
        }
        confirm={t("decks.remove")}
        cancel={
          asking && "remove" in asking && asking.remove.studiedBy.length
            ? t("common.close")
            : t("common.cancel")
        }
        busy={remove.isPending}
        hideConfirm={!!(asking && "remove" in asking && asking.remove.studiedBy.length)}
        onConfirm={() =>
          asking &&
          "remove" in asking &&
          remove.mutate(asking.remove.id, { onSuccess: () => setAsking(undefined) })
        }
      />
    </div>
  );
}
