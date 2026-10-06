// What optional features add to the lesson player (09). The player works without any of them; the
// router passes the AI assistant's slots (llm/lesson-assistant.tsx), so llm/ can be removed with its
// mount points.
import type { PracticeKind } from "@sprachanker/engine";
import type { LessonKey } from "@sprachanker/schema";
import type { ReactNode } from "react";

export interface LessonSlotContext {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}

export interface LessonSlots {
  /** Wraps the player: state the other slots share (e.g. a question for the tutor). */
  frame?(children: ReactNode): ReactNode;
  /** In the header, next to the reference: the exercise on screen, if any. */
  header?(context: LessonSlotContext & { exerciseKey?: string }): ReactNode;
  /** Under a wrong item: help with that mistake — the run and the attempt it is about, if recorded. */
  explain?(
    context: LessonSlotContext & {
      exerciseKey: string;
      index: number;
      answer: unknown;
      runId?: string;
      attempt?: number;
    },
  ): ReactNode;
  /** AI practice as steps of the plan (writing, scene, review), while an assistant is set up. */
  practice?: {
    /** The kinds offered now; a hook, called on every render of the player. */
    useKinds(): PracticeKind[];
    /** A practice step's page; `onDone` once the learner has done it (a check, a scene, a review). */
    step(
      kind: PracticeKind,
      context: LessonSlotContext & { hasMistakes: boolean; onDone(): void },
    ): ReactNode;
  };
}
