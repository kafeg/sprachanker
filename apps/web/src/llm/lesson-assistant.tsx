// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, the check of an answer said aloud under it, and the practice steps of the plan — writing,
// scene, and the tutor going through the run's mistakes. The router passes these slots to the player;
// nothing in lesson/ imports llm/.
import { PRACTICE } from "@sprachanker/engine";
import type { LessonSlots } from "@/lesson/slots.ts";
import { useLlm } from "./api.ts";
import { ExplainMistake } from "./explain.tsx";
import { SceneStep } from "./scene.tsx";
import { SpokenAnswerCheck } from "./spoken-check.tsx";
import { LessonTutor, MistakesTutor } from "./tutor.tsx";
import { WritingTask } from "./writing.tsx";

export const lessonAssistant: LessonSlots = {
  header: (context) => <LessonTutor {...context} />,
  explain: (context) => <ExplainMistake autoStart {...context} />,
  spoken: (context) => <SpokenAnswerCheck {...context} />,
  practice: {
    // Offered while a model is set up; a lesson never waits for an assistant.
    useKinds: () => {
      const llm = useLlm();
      return llm.isPending ? undefined : llm.data?.model ? PRACTICE : [];
    },
    step: (kind, { hasMistakes, done, onDone, ...context }) =>
      kind === "writing" ? (
        <WritingTask {...context} onDone={onDone} />
      ) : kind === "scene" ? (
        <SceneStep {...context} onDone={onDone} />
      ) : hasMistakes ? (
        <MistakesTutor {...context} done={done} onDone={onDone} />
      ) : null,
  },
};
