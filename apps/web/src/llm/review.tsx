// "Session review" on the lesson summary: the model's review of the latest run — strengths, topics to
// work on (with examples), next steps. Stored; offered again when there are newer answers.
import type { LessonKey } from "@sprachanker/schema";
import { CircleCheck, ClipboardList, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { useCreateReview, useLlm, useReview } from "./api.ts";
import { useAssistantLabel } from "./assistant-label.tsx";
import { ErrorLine, PracticeCard } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

export function SessionReview({
  series,
  lessonKey,
  edition,
}: {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const label = useAssistantLabel();
  const state = useReview(lessonKey);
  const create = useCreateReview();
  if (!llm.data?.model || !state.data?.possible) return null;
  const review = create.data ?? state.data.review;
  const request = { series, lessonKey, edition, language: i18n.language };
  const ask = () => create.mutate(request);

  return (
    <PracticeCard
      icon={ClipboardList}
      title={t("review.title")}
      label={label}
      action={<PromptButton request={{ review: request }} />}
    >
      {!review || (state.data.stale && !create.data) ? (
        <div className="space-y-2">
          {state.data.stale && <p className="text-sm text-muted-foreground">{t("review.stale")}</p>}
          <Button size="lg" onClick={ask} disabled={create.isPending}>
            {create.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : review ? (
              <RefreshCw className="size-4" />
            ) : null}
            {create.isPending
              ? t("review.making")
              : review
                ? t("review.refresh")
                : t("review.make")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p>{review.result.summary}</p>
          {review.result.strengths.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">{t("review.strengths")}</h3>
              <ul className="space-y-1">
                {review.result.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-correct" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.result.topics.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">{t("review.topics")}</h3>
              {review.result.topics.map((topic) => (
                <div key={topic.topic} className="rounded-xl bg-muted px-4 py-3">
                  <p className="font-medium">{topic.topic}</p>
                  <p className="text-sm">{topic.explanation}</p>
                  {topic.examples.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-sm" lang={lang}>
                      {topic.examples.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          {review.result.next.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">{t("review.next")}</h3>
              <ol className="list-decimal space-y-0.5 pl-5">
                {review.result.next.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ol>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={ask} disabled={create.isPending}>
            {create.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t("review.refresh")}
          </Button>
        </div>
      )}
      <ErrorLine error={create.error} />
    </PracticeCard>
  );
}
