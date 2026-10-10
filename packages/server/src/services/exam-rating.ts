// An exam's open answer rated by the assistant (07, `rate_exam_answer`; 09, Exams; owner's choice K,
// 2026-10-10): the configured model proposes a level of each of the exam's criteria with its reason;
// the learner takes the proposal or changes it, and only that rating scores (`exam_rated`). A proposal
// is an `llm_verdict` (`task: exam`) on the question in the exam run, for the answer it rated: asked
// once per answer, shown again without asking. A mock exam is rated only once handed in.
import { type ExamAnswerInput, rateExamAnswerTask, structuredRequest } from "@sprachanker/llm";
import { examLang, type TypedEvent } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { Exams } from "./exams.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunStore, Verdict } from "./run-store.ts";

export interface ExamRatingRequest {
  runId: string;
  itemKey: string;
  /** The language of the reasons. */
  language: string;
}

export function createExamRating(deps: { llm: Llm; store: RunStore; exams: Exams }) {
  const { llm, store } = deps;
  /** Answers being rated, by run, question and answer. */
  const rating = createInFlight<true>("exam_rating_busy");

  /** The answer to rate and what the task gets: the exam, the task as set, the criteria named. */
  async function input(request: ExamRatingRequest) {
    const found = await deps.exams.openAnswer(request.runId, request.itemKey);
    const { run, exam, locale, item, text } = found;
    // A mock exam still running is the learner's alone: no help before it is handed in.
    if (run.plan.mode === "test" && found.row.status !== "finished")
      throw new ServiceError("exam_test_running", 409);
    const sectionKey = run.plan.sections[item.key];
    const section = exam.sections.find((s) => s.key === sectionKey);
    const sectionLocale = sectionKey ? locale?.sections[sectionKey] : undefined;
    const itemLocale = locale?.items[item.key];
    const target = examLang(run.edition);
    const task: ExamAnswerInput = {
      language: request.language,
      target,
      rules: llm.rulesFor("exam", request.language, target),
      exam: locale?.title ?? exam.key,
      task: [
        sectionLocale?.instructions ?? "",
        section?.text ?? "",
        item.text ?? "",
        itemLocale?.prompt ?? item.prompt ?? "",
      ],
      criteria: item.criteria.map((c) => {
        const named = itemLocale?.criteria?.[c.id];
        return {
          id: c.id,
          title: named?.title ?? c.id,
          levels: c.levels.map((points, i) => ({ points, text: named?.levels?.[i] })),
          voids: c.voids,
        };
      }),
      samples: item.type === "respond" ? item.reference : [],
      answer: text,
    };
    return { task, text };
  }

  /** Proposals kept in a run (`input`: the answer rated), newest first. */
  const kept = (runId: string, itemKey: string) =>
    store.verdicts("exam", { runIds: [runId], itemKey });

  return {
    /** The model's proposal for an answer, kept on its question in the run; one kept for the same
     *  answer is returned without asking again. */
    async propose(
      request: ExamRatingRequest,
    ): Promise<
      Verdict<"exam"> & { /** The event kept, for the run's page. */ event?: TypedEvent }
    > {
      const { task, text } = await input(request);
      const same = kept(request.runId, request.itemKey).find((r) => r.input === text);
      if (same) return same;
      return rating.run(`${request.runId}|${request.itemKey}|${text}`, true, async () => {
        const { result, model, latencyMs } = await llm.structured(rateExamAnswerTask(task));
        const { event, verdict } = store.keepVerdict(
          request.runId,
          { task: "exam", input: text, result, model, latencyMs },
          { itemKey: request.itemKey },
        );
        return { ...verdict, event };
      });
    },

    /** The request it would send, without sending it. */
    async prompt(request: ExamRatingRequest): Promise<PromptPreview> {
      return llm.preview(structuredRequest(rateExamAnswerTask((await input(request)).task)));
    },
  };
}
export type ExamRating = ReturnType<typeof createExamRating>;
