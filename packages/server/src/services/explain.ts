// "Why is this wrong?" (07): the item, the answers and the lesson's grammar go to the configured model,
// whose explanation is streamed back.
import { type ExplainMistakeInput, explainMistake, explainMistakeRequest } from "@sprachanker/llm";
import { findExercise, type LessonKey, parseEditionId } from "@sprachanker/schema";
import type { Content } from "./content.ts";
import { type Llm, LlmSetupError, type PromptPreview } from "./llm.ts";

export interface ExplainRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  exerciseKey: string;
  index: number;
  answer?: unknown;
  language: string;
}

export function createExplain(deps: { llm: Llm; content: Content }) {
  const { llm, content } = deps;

  /** What explain_mistake gets for one item: the item, the answers and the lesson's grammar. */
  async function input(request: ExplainRequest): Promise<ExplainMistakeInput> {
    const [lesson, locale] = await Promise.all([
      content.lesson(request.series, request.lessonKey),
      content.localeLesson(request.series, request.lessonKey, request.edition),
    ]);
    const exercise = findExercise(lesson, request.exerciseKey);
    if (!exercise?.items[request.index]) throw new LlmSetupError("no_such_item");
    return {
      exercise,
      locale: locale?.exercises[exercise.key],
      index: request.index,
      answer: request.answer,
      grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
      language: request.language,
      target: parseEditionId(request.edition).target,
      rules: llm.rulesFor("explain", request.language, parseEditionId(request.edition).target),
    };
  }

  return {
    /** Explanation of a wrong answer, streamed. */
    async stream(request: ExplainRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { client, model } = await llm.model();
      return explainMistake(client, model, await input(request), signal);
    },
    /** The request it would send, without sending it. */
    async prompt(request: ExplainRequest): Promise<PromptPreview> {
      return llm.preview(explainMistakeRequest(await input(request)));
    },
  };
}
export type Explain = ReturnType<typeof createExplain>;
