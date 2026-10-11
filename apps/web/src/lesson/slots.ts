// What optional features add to the lesson player (09). The player works without any of them; the
// router passes the AI assistant's slots (llm/lesson-assistant.tsx), so llm/ can be removed with its
// mount points.
import type { PracticeKind } from "@sprachanker/engine";
import type { ExerciseKey, LessonKey, TypedEvent } from "@sprachanker/schema";
import type { ReactNode } from "react";

export interface LessonSlotContext {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}

export interface LessonSlots {
  /** In the header, next to the reference: the exercise on screen, if any. */
  header?(context: LessonSlotContext & { exerciseKey?: ExerciseKey }): ReactNode;
  /** Under a wrong item: help with that mistake — the run and the attempt it is about, if recorded. */
  explain?(
    context: LessonSlotContext & {
      exerciseKey: ExerciseKey;
      index: number;
      answer: unknown;
      runId?: string;
      attempt?: number;
      /** Resolves once the run's answers are stored (the attempt explained is looked up there). */
      stored?: () => Promise<void>;
    },
  ): ReactNode;
  /** Under an answer said aloud without a phrase to say: a check of what was heard, kept in the run. */
  spoken?(
    context: LessonSlotContext & {
      exerciseKey: ExerciseKey;
      index: number;
      transcript: string;
      runId: string;
      /** The check kept in the run: the run's mistakes read it at once. */
      onStored(event: TypedEvent): void;
    },
  ): ReactNode;
  /** AI practice as steps of the plan (Understanding, writing, the Dialogue, going over mistakes), while
   *  an assistant is set up. The player shows the run's own status above the mistakes step's page. */
  practice?: {
    /** The kinds offered now, undefined while that is not known yet (the player waits: the flow
     *  resumes on a step only once it knows every step); a hook, called on every render. */
    useKinds(): readonly PracticeKind[] | undefined;
    /** A practice step's page in the run the lesson shows (`runId`); `onDone` once the learner has
     *  done it (a text checked, a Dialogue held, every question or new item answered); `onNothing`
     *  when it has nothing to do in the run (no mistakes to go over: skipped); `onStored` once it kept
     *  an answer in the run — the run is read again, resolved once read: a wrong one puts going over
     *  mistakes in the plan. */
    step(
      kind: PracticeKind,
      context: LessonSlotContext & {
        runId?: string;
        onDone(): void;
        onNothing(): void;
        onStored(): Promise<void>;
      },
    ): ReactNode;
  };
}
