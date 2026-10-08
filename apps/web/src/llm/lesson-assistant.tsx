// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, the check of an answer said aloud under it, and the practice steps of the plan — writing,
// scene, and the tutor going through the run's mistakes — each where its place is on (Settings → Prompts). The router passes these slots to the player;
// nothing in lesson/ imports llm/.
import { PRACTICE, type PracticeKind } from "@sprachanker/engine";
import type { AiPlace } from "@sprachanker/schema";
import { useSetting } from "@/api/hooks.ts";
import type { LessonSlots } from "@/lesson/slots.ts";
import { useAiIn, useLlm } from "./api.ts";
import { ExplainMistake } from "./explain.tsx";
import { SceneStep } from "./scene.tsx";
import { SpokenAnswerCheck } from "./spoken-check.tsx";
import { LessonTutor, MistakesTutor } from "./tutor.tsx";
import { WritingTask } from "./writing.tsx";

/** What the assistant shows in a place, while it works there (07). */
function In({ place, children }: { place: AiPlace; children: React.ReactNode }) {
  return useAiIn(place) ? children : null;
}

/** The practice steps and the place each belongs to ("Going over mistakes" is the tutor's). */
const PLACE_OF: Record<PracticeKind, AiPlace> = {
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
  explain: (context) => (
    <In place="explain">
      <ExplainMistake autoStart {...context} />
    </In>
  ),
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
