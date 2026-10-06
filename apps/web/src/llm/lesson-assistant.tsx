// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, and the practice steps of the plan — writing, scene, and the session review with
// "discuss my mistakes" (which opens a new tutor chat). The router passes these slots to the player; nothing in lesson/ imports llm/.
import { PRACTICE, type PracticeKind } from "@sprachanker/engine";
import { createContext, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LessonSlotContext, LessonSlots } from "@/lesson/slots.ts";
import { useLlm } from "./api.ts";
import { ExplainMistake } from "./explain.tsx";
import { SessionReview } from "./review.tsx";
import { SceneCard } from "./scene.tsx";
import { LessonTutor, ReviewMistakesButton, type TutorAsk } from "./tutor.tsx";
import { WritingTask } from "./writing.tsx";

/** A question for the tutor, asked from the summary and answered in the header's chat. */
const Ask = createContext<{ ask?: TutorAsk; setAsk(ask: TutorAsk): void }>({ setAsk() {} });

function AskScope({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<TutorAsk>();
  return <Ask.Provider value={{ ask, setAsk }}>{children}</Ask.Provider>;
}

function Tutor(context: LessonSlotContext & { exerciseKey?: string }) {
  return <LessonTutor ask={useContext(Ask).ask} {...context} />;
}

/** A practice step of the plan: writing, a scene, or the session review with "discuss my mistakes". */
function Practice({
  kind,
  hasMistakes,
  onDone,
  ...context
}: LessonSlotContext & { kind: PracticeKind; hasMistakes: boolean; onDone(): void }) {
  const { t } = useTranslation();
  const { setAsk } = useContext(Ask);
  if (kind === "writing") return <WritingTask {...context} onDone={onDone} />;
  if (kind === "scene") return <SceneCard {...context} onDone={onDone} />;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{t("review.intro")}</p>
      <SessionReview {...context} onDone={onDone} />
      {hasMistakes && <ReviewMistakesButton onAsk={setAsk} />}
    </div>
  );
}

export const lessonAssistant: LessonSlots = {
  frame: (children) => <AskScope>{children}</AskScope>,
  header: (context) => <Tutor {...context} />,
  explain: (context) => <ExplainMistake autoStart {...context} />,
  practice: {
    // Offered while a model is set up; a lesson never waits for an assistant.
    useKinds: () => (useLlm().data?.model ? PRACTICE : []),
    step: (kind, context) => <Practice kind={kind} {...context} />,
  },
};
