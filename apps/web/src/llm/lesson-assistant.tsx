// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, the check of an answer said aloud under it, and the practice steps of the plan —
// Understanding, writing, the Dialogue and going over the pass's mistakes — each where its place is on
// (Settings → AI assistant). The router passes these slots to the player; nothing in lesson/ imports llm/.
import { PRACTICE, type PracticeKind } from "@sprachanker/engine";
import type { AiPlace } from "@sprachanker/schema";
import { useSetting } from "@/api/settings.ts";
import type { LessonSlots } from "@/lesson/slots.ts";
import { DialogueStep } from "./dialogue.tsx";
import { ExplainMistake } from "./explain.tsx";
import { GoingOverStep } from "./going-over.tsx";
import { useAiIn, useLlm } from "./setup-api.ts";
import { SpokenAnswerCheck } from "./spoken-check.tsx";
import { LessonTutor } from "./tutor.tsx";
import { UnderstandingStep } from "./understanding.tsx";
import { WritingTask } from "./writing.tsx";

/** What the assistant shows in a place, while it works there (07). */
function In({ place, children }: { place: AiPlace; children: React.ReactNode }) {
  return useAiIn(place) ? children : null;
}

/** The practice steps and the place each belongs to ("Going over mistakes" goes with the tutor's). */
const PLACE_OF: Record<PracticeKind, AiPlace> = {
  understanding: "understanding",
  writing: "writing",
  scene: "scene",
  mistakes: "tutor",
};

export const lessonAssistant: LessonSlots = {
  header: (context) => (
    <In place="tutor">
      <LessonTutor {...context} />
    </In>
  ),
  explain: {
    // Its button only while it can answer: a model set up and its place on.
    useOn: () => !!useAiIn("explain"),
    view: (context) => <ExplainMistake autoStart {...context} />,
  },
  spoken: (context) => (
    <In place="speaking">
      <SpokenAnswerCheck {...context} />
    </In>
  ),
  practice: {
    // Offered while a model is set up and their place is on; undefined while that is read (a run
    // resumes onto a practice step only once it is known).
    useKinds: () => {
      const llm = useLlm();
      const off = useSetting("llm.offIn");
      if (llm.isPending) return undefined;
      return llm.data?.model ? PRACTICE.filter((kind) => !off.includes(PLACE_OF[kind])) : [];
    },
    step: (kind, { runId, onDone, onNothing, onStored, ...context }) =>
      kind === "understanding" ? (
        <UnderstandingStep {...context} onDone={onDone} onStored={onStored} />
      ) : kind === "writing" ? (
        <WritingTask {...context} onDone={onDone} />
      ) : kind === "scene" ? (
        <DialogueStep {...context} onDone={onDone} />
      ) : (
        <GoingOverStep {...context} runId={runId} onDone={onDone} onNothing={onNothing} />
      ),
  },
};
