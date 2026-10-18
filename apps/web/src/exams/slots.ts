// What optional features add to an exam run's page. It works without any; the router provides the
// AI assistant's (llm/exam-rating.tsx), so llm/ can be removed with its mount points.
import type { RespondAnswer, TypedEvent } from "@sprachanker/schema";
import { createContext, type ReactNode, useContext } from "react";

export interface ExamSlots {
  /** Above an open answer's rating: ask for a proposal (the AI assistant's), kept in the run. */
  propose?(context: {
    runId: string;
    itemKey: string;
    /** A proposal for this answer is kept already. */
    proposed: boolean;
    /** The proposal kept: the run's page reads it at once. */
    onStored(event: TypedEvent): void;
    /** Asked at once, without a button (practice: the answer was just checked). */
    auto?: boolean;
  }): ReactNode;
  /** A speaking part said through from its script — the examiner and the partner read aloud, the
   *  learner saying their places — while the assistant works there (`useOn`, a hook called on every
   *  render); otherwise the part is answered aloud as any open answer. */
  conversation?: {
    useOn(): boolean;
    view(context: ConversationContext): ReactNode;
  };
}

export interface ConversationContext {
  runId: string;
  itemKey: string;
  /** The run's events: the part's script is its `llm_verdict` (`exam_part`) on the question. */
  events: TypedEvent[];
  /** The script kept by the server: the page shows it at once. */
  onStored(events: TypedEvent[]): void;
  /** The part said through (its lines, each with its take), or begun again (none): practice sends it
   *  with Check, a mock exam as it is. */
  onSaid(answer: RespondAnswer | undefined): void;
  /** The hints of what to say shown (practice); a mock exam gives only the cards, as the real one. */
  hints: boolean;
  /** What was said already: the answer given, or practice's draft not checked yet. */
  said?: RespondAnswer;
  /** Checked (practice): each line said shown with the script's good line, nothing more to say. */
  checked: boolean;
  /** The Teil's time (seconds): shown as it runs at the learner's turns. */
  seconds?: number;
  /** The examiner ends the part when its time is over (a mock exam); practice only says so. */
  timed?: boolean;
}

const Slots = createContext<ExamSlots>({});
export const ExamSlotsProvider = Slots.Provider;
export const useExamSlots = () => useContext(Slots);
