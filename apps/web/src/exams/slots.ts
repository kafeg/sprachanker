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
}

const Slots = createContext<ExamSlots>({});
export const ExamSlotsProvider = Slots.Provider;
export const useExamSlots = () => useContext(Slots);
