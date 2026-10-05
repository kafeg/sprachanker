// The tutor's tools (07, "Tools"): data the model may ask for while answering, instead of getting all
// of it in the context. The server runs them; lessons are named "unit.lesson" as the app shows them.
import type { ToolDef } from "../client.ts";

const LESSON = {
  type: "string",
  description: 'A lesson as "unit.lesson" (e.g. "2.3") or a part of its title',
};

export const TUTOR_TOOLS: ToolDef[] = [
  {
    name: "get_progress",
    description:
      "The learner's progress in the course: lessons done with their best score, the lesson in progress, totals.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_mistakes",
    description:
      "The learner's recent mistakes (item, correct answer, learner's answer), in all lessons or in one lesson.",
    parameters: {
      type: "object",
      properties: { lesson: { ...LESSON, description: `${LESSON.description}; omit for all` } },
      additionalProperties: false,
    },
  },
  {
    name: "find_word",
    description:
      "Where a word or phrase is taught in the course: lesson, headword with forms, translation.",
    parameters: {
      type: "object",
      properties: { word: { type: "string", description: "The word or phrase, any form" } },
      required: ["word"],
      additionalProperties: false,
    },
  },
  {
    name: "get_lesson",
    description:
      "What a lesson covers: title, goals, words with translations, grammar notes (shortened).",
    parameters: {
      type: "object",
      properties: { lesson: LESSON },
      required: ["lesson"],
      additionalProperties: false,
    },
  },
];

export const TUTOR_TOOLS_RULE =
  "- Tools: you can look up the learner's progress, mistakes in any lesson, where a word is taught, and what any lesson covers. Use them when a question needs that data; never guess it.";

/** Repeated at the end of the prompt: answer only after the data is in, never promise to look later. */
export const TUTOR_TOOLS_REMINDER =
  "Questions about the learner's progress, mistakes in other lessons, where a word is taught or what another lesson covers: call the tool first, then answer from its result. Never reply that you will check later.";
