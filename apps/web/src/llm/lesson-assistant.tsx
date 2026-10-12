// The AI assistant in the lesson player (09, 07): the tutor in the header, "Why is this wrong?" under a
// wrong item, the check of an answer said aloud under it, the practice steps of the plan — Reading,
// Listening, Writing, Speaking — and going over the pass's mistakes in the summary, each where its place is on
// (Settings → AI assistant). The router passes these slots to the player; nothing in lesson/ imports llm/.
import { PRACTICE, type PracticeKind } from "@sprachanker/engine";
import type { AiPlace } from "@sprachanker/schema";
import { useSetting } from "@/api/settings.ts";
import type { LessonSlots } from "@/lesson/slots.ts";
import { ExplainMistake } from "./explain.tsx";
import { GoingOverSection } from "./going-over.tsx";
import { useAiIn, useLlm } from "./setup-api.ts";
import { SpokenAnswerCheck } from "./spoken-check.tsx";
import { TalkStep } from "./talk.tsx";
import { LessonTutor } from "./tutor.tsx";
import { UnderstandingStep } from "./understanding.tsx";
import { WritingTask } from "./writing.tsx";

/** What the assistant shows in a place, while it works there (07). */
function In({ place, children }: { place: AiPlace; children: React.ReactNode }) {
  return useAiIn(place) ? children : null;
}

/** The practice steps and the place each belongs to. */
const PLACE_OF: Record<PracticeKind, AiPlace> = {
  reading: "understanding",
  listening: "understanding",
  writing: "writing",
  speaking: "scene",
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
    step: (kind, { onDone, onStored, setPrimary, ...context }) =>
      kind === "reading" || kind === "listening" ? (
        <UnderstandingStep
          key={kind}
          {...context}
          step={kind}
          onDone={onDone}
          onStored={onStored}
          setPrimary={setPrimary}
        />
      ) : kind === "writing" ? (
        <WritingTask {...context} onDone={onDone} setPrimary={setPrimary} />
      ) : (
        <TalkStep {...context} onDone={onDone} setPrimary={setPrimary} />
      ),
  },
  // Going over mistakes goes with the tutor's place; its heading only where it is there.
  mistakes: (context) => (
    <In place="tutor">
      <GoingOverSection {...context} />
    </In>
  ),
};
