// The AI assistant in an exam run: a rating proposed for an open answer, and a speaking
// part said through from its script — while a model is set up and its place ("exam") is on. The router
// passes these slots to the exam run (exams/slots.ts); nothing in exams/ imports llm/.
import type { ExamSlots } from "@/exams/slots.ts";
import { ExamPartView } from "./exam-part.tsx";
import { ProposeRating } from "./exam-rating.tsx";
import { useAiIn } from "./setup-api.ts";

export const examAssistant: ExamSlots = {
  propose: (context) => <ProposeRating {...context} />,
  conversation: {
    useOn: () => !!useAiIn("exam"),
    view: (context) => <ExamPartView {...context} />,
  },
};
