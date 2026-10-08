// An item across passes (09): in every pass that answered it, newest first, each answer as it was given
// and marked, with the explanations kept for it.
import type { Exercise, LocaleExercise } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useItemHistory } from "@/api/hooks.ts";
import { ItemCard } from "@/exercises/item-card.tsx";
import { ShuffleSeed } from "@/exercises/shared.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { SpokenCheckNote, spokenCheckOf } from "./spoken.tsx";

export function ItemHistory({
  itemKey,
  exercise,
  url,
  onClose,
}: {
  itemKey: string | undefined;
  /** The exercise as this pass showed it: the answers of every pass are shown in it. */
  exercise: { exercise: Exercise; locale: LocaleExercise | null } | undefined;
  url(path: string): string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  return (
    <SideSheet
      open={!!itemKey}
      onOpenChange={(open) => !open && onClose()}
      title={t("notebook.itemHistory")}
      className="overflow-y-auto sm:max-w-xl"
    >
      {itemKey && exercise && <Passes itemKey={itemKey} shown={exercise} url={url} />}
    </SideSheet>
  );
}

function Passes({
  itemKey,
  shown,
  url,
}: {
  itemKey: string;
  shown: { exercise: Exercise; locale: LocaleExercise | null };
  url(path: string): string;
}) {
  const { t } = useTranslation();
  const history = useItemHistory(itemKey);
  const when = useDateFormat("dayTime");
  const index = shown.exercise.items.findIndex((i) => i.key === itemKey);
  if (history.isPending) return <Loading />;
  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  return (
    <ol className="space-y-6 px-4 pb-6">
      {history.data.passes.map((p) => (
        <ShuffleSeed.Provider key={p.runId} value={p.runId}>
          <li className="space-y-3">
            <h3 className="font-semibold">
              {t("notebook.passOf", { date: when.format(p.startedAt) })}
            </h3>
            {p.answers.map((a) => (
              <div key={a.ts} className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {t("notebook.attemptN", { n: a.attempt })} · {when.format(a.ts)}
                </p>
                <ItemCard
                  exercise={shown.exercise}
                  locale={shown.locale}
                  index={index}
                  answer={a.answer}
                  outcome={a.outcome}
                  url={url}
                />
                <SpokenCheckNote check={spokenCheckOf(p.spoken, itemKey, a.answer)} />
                {p.explanations
                  .filter((e) => e.attempt === a.attempt)
                  .map((e) => (
                    <div key={e.text} className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
                      <RichText text={e.text} />
                    </div>
                  ))}
              </div>
            ))}
          </li>
        </ShuffleSeed.Provider>
      ))}
    </ol>
  );
}
