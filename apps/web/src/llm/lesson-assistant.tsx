// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, and on the summary the mistakes review (which opens the tutor), session review, writing
// task and scene. The router passes these slots to the player; nothing in lesson/ imports llm/.
import { createContext, useContext, useState } from "react";
import type { LessonSlotContext, LessonSlots } from "@/lesson/slots.ts";
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

function SummaryParts({ hasMistakes, ...context }: LessonSlotContext & { hasMistakes: boolean }) {
  const { setAsk } = useContext(Ask);
  return (
    <>
      {hasMistakes && <ReviewMistakesButton onAsk={setAsk} />}
      <SessionReview {...context} />
      <WritingTask {...context} />
      <SceneCard {...context} />
    </>
  );
}

export const lessonAssistant: LessonSlots = {
  frame: (children) => <AskScope>{children}</AskScope>,
  header: (context) => <Tutor {...context} />,
  explain: (context) => <ExplainMistake {...context} />,
  summary: (context) => <SummaryParts {...context} />,
};
