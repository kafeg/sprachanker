// What optional features add to the lesson player (09). The player works without any of them; the
// router passes the AI assistant's slots (llm/lesson-assistant.tsx), so llm/ can be removed with its
// mount points.
import type { PracticeKind } from "@sprachanker/engine";
import type { LessonKey, TypedEvent } from "@sprachanker/schema";
import type { ReactNode } from "react";

export interface LessonSlotContext {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}

export interface LessonSlots {
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
  /** Under an answer said aloud without a phrase to say: a check of what was heard, kept in the run. */
  spoken?(
    context: LessonSlotContext & {
      exerciseKey: string;
      index: number;
      transcript: string;
      runId: string;
      /** The check kept in the run: the run's mistakes read it at once. */
      onStored(event: TypedEvent): void;
    },
  ): ReactNode;
  /** AI practice as steps of the plan (writing, scene, going over mistakes), while an assistant is set
   *  up. The player shows the run's own status above the mistakes step's page. */
  practice?: {
    /** The kinds offered now; a hook, called on every render of the player. */
    useKinds(): readonly PracticeKind[];
    /** A practice step's page; `done` when the run has it done; `onDone` once the learner has done it
     *  (a check, a scene, the tutor's first reply on the mistakes). */
    step(
      kind: PracticeKind,
      context: LessonSlotContext & { hasMistakes: boolean; done: boolean; onDone(): void },
    ): ReactNode;
  };
}
