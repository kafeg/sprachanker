// What optional features add to the lesson player (09). The player works without any of them; the
// router passes the AI assistant's slots (llm/lesson-assistant.tsx), so llm/ can be removed with its
// mount points.
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
  /** Under a wrong item: help with that mistake. */
  explain?(
    context: LessonSlotContext & { exerciseKey: string; index: number; answer: unknown },
  ): ReactNode;
  /** On the summary, under the score. */
  summary?(context: LessonSlotContext & { hasMistakes: boolean }): ReactNode;
}
