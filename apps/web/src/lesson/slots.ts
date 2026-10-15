// What optional features add to the lesson player. The player works without any of them; the
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
  explain?: {
    /** Whether it can answer now (its button is shown only then); a hook, called on every render. */
    useOn(): boolean;
    view(
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
  };
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
  /** AI practice as steps of the plan (Reading, Listening, Writing, Speaking), where the course's
   *  practice has them. */
  practice?: {
    /** The kinds offered now in the lesson, undefined while that is not known yet (the player
     *  waits: the flow resumes on a step only once it knows every step; the edition, once chosen); a
     *  hook, called on every render. */
    useKinds(lesson: {
      series: string;
      lessonKey: string;
      edition?: string;
    }): readonly PracticeKind[] | undefined;
    /** A practice step's page in the run the lesson shows; `onDone` once the learner has done it (a
     *  text checked, a task said, every question answered); `onStored` once it kept an answer in the
     *  run — the run is read again, resolved once read (its mark follows it). */
    step(
      kind: PracticeKind,
      context: LessonSlotContext & {
        onDone(): void;
        onStored(): Promise<void>;
        /** The step bar's main button while the page needs it — its questions' Check, as an
         *  exercise's —, null to give it back to Next. */
        setPrimary(primary: PracticePrimary | null): void;
      },
    ): ReactNode;
  };
  /** In the summary, while the run has mistakes to go over: going over them by type (the run the
   *  lesson shows: `runId`). */
  mistakes?(context: LessonSlotContext & { runId?: string }): ReactNode;
}

/** The main button a practice step's page puts in the step bar (Check, as an exercise's): its label,
 *  whether it waits (and what for, said beside it) and what it does. */
export interface PracticePrimary {
  label: string;
  disabled?: boolean;
  note?: string;
  run(): void;
}
