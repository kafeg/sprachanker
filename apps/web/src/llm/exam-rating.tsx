// The AI assistant on an exam run's page (09, Exams; 07, `rate_exam_answer`; owner's choice K,
// 2026-10-10): "Propose a rating" above an open answer's criteria — the model chooses a level of each
// with its reason, kept in the run, and the page shows it chosen for the learner to take or change.
// Shown while a model is set up and its place is on; the router provides it (exams/slots.ts).
import { LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExamSlots } from "@/exams/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { useAiIn, useLlm, useProposeRating } from "./api.ts";
import { ErrorLine } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

function ProposeRating({
  runId,
  itemKey,
  proposed,
  onStored,
}: Parameters<NonNullable<ExamSlots["propose"]>>[0]) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const on = useAiIn("exam");
  const propose = useProposeRating();
  const request = { runId, itemKey, language: i18n.language };
  if (!on) return null;
  const ask = () => propose.mutate(request, { onSuccess: ({ event }) => event && onStored(event) });
  if (proposed && !propose.isPending) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {propose.isPending ? (
        <span className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">
          <Sparkles className="size-4" /> {t("exams.rating.proposing")}
          <LoaderCircle className="size-4 animate-spin" />
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={ask}>
          <Sparkles className="size-4" /> {t("exams.rating.propose")}
        </Button>
      )}
      {propose.isError && (
        <ErrorLine error={propose.error} provider={llm.data?.provider ?? undefined} />
      )}
      <span className="ml-auto">
        <PromptButton request={{ exam: request }} />
      </span>
    </div>
  );
}

export const examAssistant: ExamSlots = {
  propose: (context) => <ProposeRating {...context} />,
};
