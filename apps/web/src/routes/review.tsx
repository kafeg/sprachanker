// Review: tabs — Study (the cards of the deck chosen last, study/session.tsx), Decks (decks.tsx) and
// My words (words.tsx). "How it works" opens the guide beside.
import { settingOf } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import { useSetSetting, useSettings } from "@/api/settings.ts";
import { useDeckName } from "@/study/decks.ts";
import { GuideButton } from "@/study/guide.tsx";
import { StudySession } from "@/study/session.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";
import { DecksTab } from "./decks.tsx";
import { MyWords } from "./words.tsx";

export type ReviewTab = "study" | "decks" | "words";
const PATH: Record<ReviewTab, string> = {
  study: "/review",
  decks: "/review/decks",
  words: "/review/words",
};
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
        <DecksTab
          open={(scope) => {
            open.choose(scope);
            go("study");
          }}
        />
      )}
      {tab === "words" && <MyWords />}
    </Page>
  );
}
