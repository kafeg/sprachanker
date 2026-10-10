// What optional features add to an exam run's page (09). It works without any; the router provides the
// AI assistant's (llm/exam-rating.tsx), so llm/ can be removed with its mount points.
import type { TypedEvent } from "@sprachanker/schema";
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
  }): ReactNode;
  /** A speaking part held as a conversation — the assistant the examiner and the partner — while it
   *  works there (`useOn`, a hook called on every render); otherwise the part is answered aloud as
   *  any open answer. */
  conversation?: {
    useOn(): boolean;
    view(context: ConversationContext): ReactNode;
  };
}

export interface ConversationContext {
  runId: string;
  itemKey: string;
  /** The run's events: the part's lines are its `llm_turn`s on the question. */
  events: TypedEvent[];
  /** Lines kept by the server: the page shows them at once. */
  onStored(events: TypedEvent[]): void;
  /** The conversation as the answer: as it stands (`final` false) or the part over. */
  onAnswer(text: string, final: boolean): void;
}

const Slots = createContext<ExamSlots>({});
export const ExamSlotsProvider = Slots.Provider;
export const useExamSlots = () => useContext(Slots);
