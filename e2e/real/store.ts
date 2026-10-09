// What a run-through checks in the profile's database after a lesson (10, "Run-throughs"; 05): the
// rows (read by read-store.ts) checked by a pure function, so a store broken on purpose shows that
// the checks catch it (store.test.ts).
import { checkItem, itemScored } from "@sprachanker/engine";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";

export interface RunRow {
  id: string;
  kind: string;
  context_key: string | null;
  status: string;
  end_reason: string | null;
}
export interface EventRow {
  run_id: string;
  type: string;
  item_key: string | null;
  card_id: string | null;
  payload_json: string;
}
export interface CardRow {
  id: string;
  lexeme_key: string | null;
}
export interface Stored {
  runs: RunRow[];
  events: EventRow[];
  cards: CardRow[];
}

/** What the run-through did in the lesson, to compare the store with. */
export interface Walked {
  /** Cards rated in the words step. */
  rated: number;
  /** Cards rated in Review after the lesson. */
  reviewed?: number;
  /** The lesson was finished: every step worked, the summary reached. */
  finished: boolean;
}

/**
 * Problems with how a lesson walked through is stored: its one run (finished and completed when the
 * walk finished it), each exercise page shown, every item answered or skipped, each answer's outcome the
 * engine's own for it, the reading steps and the words recorded, the words' cards made and the ratings
 * given to them. Empty when all is as it should be.
 */
export function lessonProblems(
  stored: Stored,
  lesson: Lesson,
  locale: LocaleLesson,
  lang: string,
  walked: Walked,
): string[] {
  const problems: string[] = [];
  const runs = stored.runs.filter((r) => r.kind === "lesson" && r.context_key === lesson.key);
  if (runs.length !== 1) return [`${runs.length} lesson runs for ${lesson.key}, not 1`];
  const run = runs[0] as RunRow;
  if (walked.finished && (run.status !== "finished" || run.end_reason !== "completed"))
    problems.push(`the run is ${run.status}/${run.end_reason}, not finished/completed`);
  const events = stored.events.filter((e) => e.run_id === run.id);
  const payload = (e: EventRow) => JSON.parse(e.payload_json) as Record<string, unknown>;

  lesson.pages.forEach(({ exercise }, page) => {
    if (!events.some((e) => e.type === "page_shown" && payload(e).pageIndex === page))
      problems.push(`page ${page} (${exercise.key}) never shown`);
    exercise.items.forEach((item, i) => {
      const own = events.filter((e) => e.item_key === item.key);
      const answers = own.filter((e) => e.type === "answered");
      if (!answers.length && !own.some((e) => e.type === "item_skipped")) {
        problems.push(`${item.key}: neither answered nor skipped`);
        return;
      }
      for (const a of answers) {
        const { answer, outcome } = payload(a) as { answer: unknown; outcome?: { result: string } };
        if (!outcome) problems.push(`${item.key}: an answer stored without its outcome`);
        else if (itemScored(exercise, i)) {
          const own = checkItem(exercise, i, answer, lang).result;
          if (own !== outcome.result)
            problems.push(`${item.key}: stored ${outcome.result}, the engine says ${own}`);
        }
      }
    });
  });

  const steps = new Set(
    events.filter((e) => e.type === "step_done").map((e) => String(payload(e).step)),
  );
  const reading = [
    ...(lesson.vocab.length ? ["words"] : []),
    ...(locale.tabs.grammar ?? []).map((_, i) => `grammar:${i}`),
    ...(locale.tabs.culture ?? []).map((_, i) => `culture:${i}`),
  ];
  for (const step of reading)
    if (!steps.has(step)) problems.push(`step ${step} not recorded as done or skipped`);

  // The words' cards, one per word (a lexeme), and every rating given to one of them.
  if (walked.rated > 0) {
    const lexemes = new Set(lesson.vocab.map((v) => v.lexeme as string));
    const cards = stored.cards.filter((c) => c.lexeme_key && lexemes.has(c.lexeme_key));
    if (cards.length !== lexemes.size)
      problems.push(`${cards.length} cards for the lesson's ${lexemes.size} words`);
    const ids = new Set(stored.cards.map((c) => c.id));
    const reviews = stored.events.filter((e) => e.type === "card_review");
    const given = walked.rated + (walked.reviewed ?? 0);
    if (reviews.length < given)
      problems.push(`${reviews.length} card reviews stored for ${given} given`);
    if (walked.reviewed && !stored.runs.some((r) => r.kind === "review"))
      problems.push("cards reviewed without a review run");
    for (const r of reviews)
      if (!r.card_id || !ids.has(r.card_id))
        problems.push(`a card review of an unknown card ${r.card_id}`);
  }
  return problems;
}
