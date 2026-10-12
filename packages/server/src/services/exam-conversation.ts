// An exam's speaking part as the real part runs (owner, 2026-10-12: no live partner, no wait for the
// model between lines): its script is written once from the Teil's cards (`exam_part`) — the
// examiner's lines, the partner's from their card, the learner's places with a hint and a good line —
// and kept as an `llm_verdict` (`task: exam_part`) on the question in the exam run, the examiner and
// the partner given server voices of their gender. The learner says the part through; their lines are
// the answer, rated afterwards with the script around them (exam-rating.ts). A mock exam's part is
// scripted while it runs too: the learner gets the script's lines, never its hints (the page's part).
import { castVoices } from "@sprachanker/engine";
import { type ExamPartInput, examPartTask, scriptOf, structuredRequest } from "@sprachanker/llm";
import { type ExamPart, examLang } from "@sprachanker/schema";
import type { Exams } from "./exams.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

export interface ExamPartRequest {
  runId: string;
  itemKey: string;
  /** The language of the hints. */
  language: string;
}

/** The server's voices for a language now: the profile's engine and those it reads it with. */
type VoicesFor = (lang: string) => { engine: "piper" | "qwen"; voices: string[] } | undefined;

export function createExamConversation(deps: {
  llm: Llm;
  store: RunStore;
  exams: Exams;
  voices?: VoicesFor;
  random?: () => number;
}) {
  const { llm, store } = deps;
  const random = deps.random ?? Math.random;
  const busy = createInFlight<true>("exam_conversation_busy");

  async function input(request: ExamPartRequest) {
    const { run, exam, locale, item, section } = await deps.exams.speakingPart(
      request.runId,
      request.itemKey,
    );
    const sectionLocale = section ? locale?.sections[section.key] : undefined;
    const target = examLang(run.edition);
    const task: ExamPartInput = {
      language: request.language,
      target,
      rules: llm.rulesFor("conversation", request.language, target),
      exam: locale?.title ?? exam.key,
      part: sectionLocale?.title ?? section?.key ?? item.key,
      task: [
        sectionLocale?.instructions ?? "",
        item.prompt ?? "",
        section?.text ?? "",
        ...(section?.letters ?? []).map((l) => `Karte ${l.letter}: ${l.text ?? ""}`),
      ],
      ...(item.partner && { partner: item.partner }),
      // What the part is rated by: its rounds and turns.
      rated: (item.criteria ?? []).map((c) => {
        const title = locale?.items[item.key]?.criteria?.[c.id]?.title;
        return title && title !== c.id ? `${c.id} (${title})` : c.id;
      }),
      // The module's earlier parts: a part following one up is about it.
      earlier: earlierParts(),
    };
    return { task, target };

    function earlierParts() {
      const at = exam.sections.findIndex((s) => s.key === section?.key);
      return exam.sections
        .slice(0, Math.max(0, at))
        .filter((s) => s.module === section?.module)
        .map((s) => {
          const l = locale?.sections[s.key];
          return [
            l?.title ?? s.key,
            l?.instructions ?? "",
            ...(s.letters ?? []).map((c) => c.text ?? ""),
          ]
            .filter(Boolean)
            .join("\n");
        });
    }
  }

  /** The examiner and the partner given server voices of their gender, where the server reads the
   *  language. */
  function voiced(part: ExamPart, target: string): ExamPart {
    const here = deps.voices?.(target);
    if (!here) return part;
    const people = [
      { name: "examiner", gender: part.examiner.gender, age: "adult" as const },
      ...(part.partner
        ? [{ name: "partner", gender: part.partner.gender, age: "adult" as const }]
        : []),
    ];
    const cast = castVoices(here.engine, people, here.voices, random);
    return {
      ...part,
      voices: {
        engine: here.engine,
        ...(cast.examiner && { examiner: cast.examiner }),
        ...(cast.partner && { partner: cast.partner }),
      },
    };
  }

  return {
    /** The part's script: the one kept for it in the run, else written and kept; the event kept,
     *  for the run's page. */
    script(request: ExamPartRequest): Promise<Verdict<"exam_part"> & { event?: unknown }> {
      return busy.run(`${request.runId}|${request.itemKey}`, true, async () => {
        const kept = verdicts(store, "exam_part", {
          runIds: [request.runId],
          itemKey: request.itemKey,
        })[0];
        if (kept) return kept;
        const { task, target } = await input(request);
        const { result, model, latencyMs } = await llm.structured(examPartTask(task), {
          timeoutAgain: true,
        });
        const { event, verdict } = keepVerdict(
          store,
          request.runId,
          {
            task: "exam_part",
            input: "",
            result: voiced(scriptOf(result), target),
            model,
            latencyMs,
          },
          { itemKey: request.itemKey },
        );
        return { ...verdict, event };
      });
    },

    /** The request it would send, without sending it. */
    async prompt(request: ExamPartRequest): Promise<PromptPreview> {
      return llm.preview(structuredRequest(examPartTask((await input(request)).task)));
    },
  };
}
export type ExamConversation = ReturnType<typeof createExamConversation>;
