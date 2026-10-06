// Violation: lesson/ gets the assistant through slots, never by import.
import { tutor } from "../llm/tutor.ts";

export const used = tutor;
