// "Why is this wrong?" (07): the item, the answers and the lesson's grammar go to the configured model,
// whose explanation is streamed back. A finished explanation is stored in the lesson run as an
// `llm_verdict` on the item, with the attempt it explains (05), so it is shown again without asking.
import { type ExplainMistakeInput, explainMistake, explainMistakeRequest } from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  LlmVerdictPayload,
  parseEditionId,
} from "@sprachanker/schema";
import { and, asc, eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { events } from "../db/profile/schema.ts";
import type { Content } from "./content.ts";
import { type Llm, LlmSetupError, type PromptPreview } from "./llm.ts";
import type { LlmRuns } from "./llm-runs.ts";

export interface ExplainRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  exerciseKey: string;
  index: number;
  answer?: unknown;
  language: string;
  /** Where the explanation is kept: the lesson run and the attempt it explains. */
  runId?: string;
  attempt?: number;
}

/** A stored explanation; the newest one of an attempt is the one shown. */
export interface StoredExplanation {
  itemKey: string;
  attempt: number;
  text: string;
  model: string;
  ts: number;
}

export function createExplain(deps: {
  llm: Llm;
  content: Content;
  /** One of the lesson's runs (the runs service). */
  lessonRun: (lessonKey: string, runId: string) => { id: string } | undefined;
  runs: LlmRuns;
  db: ProfileDb;
  now: () => number;
}) {
  const { llm, content, lessonRun, runs, db, now } = deps;

  /** What explain_mistake gets for one item: the item, the answers and the lesson's grammar. */
  async function input(request: ExplainRequest) {
    const [lesson, locale] = await Promise.all([
      content.lesson(request.series, request.lessonKey),
      content.localeLesson(request.series, request.lessonKey, request.edition),
    ]);
    const exercise = findExercise(lesson, request.exerciseKey);
    const item = exercise?.items[request.index];
    if (!exercise || !item) throw new LlmSetupError("no_such_item");
    const target = parseEditionId(request.edition).target;
    return {
      itemKey: item.key,
      input: {
        exercise,
        locale: locale?.exercises[exercise.key],
        index: request.index,
        answer: request.answer,
        grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
        language: request.language,
        target,
        rules: llm.rulesFor("explain", request.language, target),
      } satisfies ExplainMistakeInput,
    };
  }

  return {
    /** Explanation of a wrong answer, streamed; kept in the lesson run once the model has finished. */
    async stream(request: ExplainRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const run = request.runId ? lessonRun(request.lessonKey, request.runId) : undefined;
      if (request.runId && !run) throw new LlmSetupError("no_such_run");
      const { itemKey, input: task } = await input(request);
      const { client, model } = await llm.model();
      const started = now();
      const reply = explainMistake(client, model, task, signal);
      const attempt = request.attempt;
      return (async function* () {
        let text = "";
        for await (const chunk of reply) {
          text += chunk;
          yield chunk;
        }
        // Reached only when the model finished: an explanation cut short is not kept.
        if (run && attempt && text.trim()) {
          runs.add(
            run.id,
            "llm_verdict",
            [
              {
                task: "explain",
                input: "",
                result: text.trim(),
                model,
                latencyMs: Math.max(0, now() - started),
                attempt,
              } satisfies LlmVerdictPayload,
            ],
            itemKey,
          );
        }
      })();
    },

    /** Explanations kept in a lesson run, oldest first. */
    list(lessonKey: LessonKey, runId: string): StoredExplanation[] {
      if (!lessonRun(lessonKey, runId)) return [];
      return db
        .select()
        .from(events)
        .where(and(eq(events.runId, runId), eq(events.type, "llm_verdict")))
        .orderBy(asc(events.ts), asc(events.id))
        .all()
        .flatMap((e) => {
          // A row that does not read as a verdict is skipped, not the whole list.
          const parsed = LlmVerdictPayload.safeParse(JSON.parse(e.payloadJson));
          const v = parsed.data;
          return v?.task === "explain" && e.itemKey && v.attempt
            ? [
                {
                  itemKey: e.itemKey,
                  attempt: v.attempt,
                  text: String(v.result),
                  model: v.model,
                  ts: e.ts,
                },
              ]
            : [];
        });
    },

    /** The request it would send, without sending it. */
    async prompt(request: ExplainRequest): Promise<PromptPreview> {
      return llm.preview(explainMistakeRequest((await input(request)).input));
    },
  };
}
export type Explain = ReturnType<typeof createExplain>;
