// An exam's questions as the item cards show them, the answers given to them, and how they group
// into Teile.
import type { Exam, ExamItem, Exercise, Outcome, TypedEvent } from "@sprachanker/schema";

const withoutMedia = ({ media: _, ...rest }: ExamItem) => rest;

/** A question as an exercise of its one item (how an item card shows it); without its recording
 *  when the exam plays that itself (`ExamRecording`). */
export const examExercise = (item: ExamItem, withAudio = true): Exercise => {
  const { audio: _, ...rest } = item.media ?? {};
  const media = withAudio || !item.media ? item.media : Object.keys(rest).length ? rest : undefined;
  return {
    key: item.key,
    type: item.type,
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items: [media ? { ...item, media } : withoutMedia(item)],
  } as unknown as Exercise;
};

/** The example's answer as given (the right one), to show it answered. */
export function exampleAnswer(item: ExamItem): unknown {
  if (item.type === "single_choice") return { optionId: item.answer.optionIds[0] };
  if (item.type === "gap_text")
    return Object.fromEntries(Object.entries(item.answer).map(([g, a]) => [g, a.accepted[0]]));
  return undefined;
}

/** Each question's latest answer in a run, with its outcome where the run tells it. */
export function latestAnswers(events: TypedEvent[]) {
  const out = new Map<string, { answer: unknown; outcome?: Outcome }>();
  for (const e of events)
    if (e.type === "answered" && e.itemKey)
      out.set(e.itemKey, {
        answer: e.payload.answer,
        ...(e.payload.outcome && { outcome: e.payload.outcome }),
      });
  return out;
}

export type ExamSection = Exam["sections"][number];

/** The questions in their order, each with the section it belongs to and whether it opens one
 *  (where its Teil's material is shown). */
export function inTeile(exam: Exam, items: ExamItem[], sectionOf: Record<string, string>) {
  const sections = new Map(exam.sections.map((s) => [s.key as string, s]));
  let last: string | undefined;
  return items.map((item) => {
    const key = sectionOf[item.key] ?? exam.sections.find((s) => s.pool.includes(item.key))?.key;
    const section = key ? sections.get(key) : undefined;
    const opens = !!section && key !== last;
    last = key;
    return { item, section, opens };
  });
}
