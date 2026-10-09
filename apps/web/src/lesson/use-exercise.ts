// An exercise being answered (09, 04): the answers given, the outcomes of the items checked (locally, with
// the engine the server checks with too), the recordings that must be played first, the item the number
// keys choose in, and what checking, answering an item again, retrying, skipping and leaving record.
// The screen (exercise-step.tsx) draws it; this hook holds the rules, tested on their own.
import { answerComplete, checkItem } from "@sprachanker/engine";
import type { Exercise, Outcome } from "@sprachanker/schema";
import { useRef, useState } from "react";
import { isCheckedHere, toHear } from "@/exercises/index.tsx";
import type { ExerciseResult } from "./use-run.ts";

export type Answered = (
  answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
  skipped: string[],
  ms: number,
) => void;

/** What Check waits for: every item answered, the exercise's recording, or an item's. */
export type Waiting =
  | { for: "answers"; done: number; total: number }
  | { for: "exercise recording" }
  | { for: "item recording"; n: number };

export function useExercise({
  exercise,
  stored,
  readOnly,
  lang,
  onAnswered,
}: {
  exercise: Exercise;
  /** What the run already has for this exercise: shown again when it is reopened. */
  stored?: ExerciseResult;
  readOnly: boolean;
  /** The language answers are checked in (case rules differ, 04). */
  lang: string;
  onAnswered: Answered;
}) {
  const scored = isCheckedHere(exercise.type);
  // Reopened: the latest answers of the run and, for checked exercises, their outcomes.
  const [answers, setAnswers] = useState<Record<number, unknown>>(() =>
    Object.fromEntries(
      exercise.items.flatMap((item, i) =>
        stored?.last[item.key] ? [[i, stored.last[item.key]?.answer]] : [],
      ),
    ),
  );
  const [outcomes, setOutcomes] = useState<Record<number, Outcome> | undefined>(() => {
    const restored = exercise.items.flatMap((item, i) => {
      const outcome = stored?.last[item.key]?.outcome;
      return outcome ? [[i, outcome] as const] : [];
    });
    return scored && restored.length ? Object.fromEntries(restored) : undefined;
  });
  const shownAt = useRef(Date.now());
  /** How often the exercise, and each item, was begun again: a card begun again is made anew — its
   *  renderer's own state (a chip picked, a take), its players back at the start. */
  const [rounds, setRounds] = useState<{ all: number; item: Record<number, number> }>({
    all: 0,
    item: {},
  });
  const [explaining, setExplaining] = useState<Set<number>>(new Set());

  // Recordings that must be played before checking: the exercise's own and each item's. Reopening an
  // exercise answered before, or a finished run, asks for nothing.
  const recordings = [...new Set(exercise.items.flatMap((_, i) => toHear(exercise, i)))];
  const [heard, setHeard] = useState<Set<string>>(() =>
    readOnly || Object.keys(stored?.last ?? {}).length ? new Set(recordings) : new Set(),
  );
  const [touched, setTouched] = useState<number>();

  // Checking applies to the items not checked yet (all of them, or one answered again).
  const open = exercise.items.flatMap((_, i) => (outcomes?.[i] ? [] : [i]));
  const checking = scored && !readOnly && open.length > 0;
  const complete = (i: number) => answerComplete(exercise, i, answers[i]);
  const missing = open.filter((i) => !complete(i)).length;
  const unheard = recordings.find(
    (key) =>
      !heard.has(key) && (key === "exercise" || open.includes(Number(key.slice("item-".length)))),
  );
  const waiting: Waiting | undefined = !checking
    ? undefined
    : missing
      ? {
          for: "answers",
          done: exercise.items.filter((_, i) => complete(i)).length,
          total: exercise.items.length,
        }
      : unheard === "exercise"
        ? { for: "exercise recording" }
        : unheard
          ? { for: "item recording", n: Number(unheard.slice("item-".length)) + 1 }
          : undefined;
  const ms = () => Date.now() - shownAt.current;

  const check = () => {
    // Not waiting: every open item has a complete answer (an item left out is skipped, not checked).
    if (!checking || waiting) return;
    const results = open.map((i) => ({
      i,
      itemKey: exercise.items[i]?.key as string,
      answer: answers[i],
      outcome: checkItem(exercise, i, answers[i], lang),
    }));
    setOutcomes((prev) => ({
      ...prev,
      ...Object.fromEntries(results.map((r) => [r.i, r.outcome])),
    }));
    onAnswered(results, [], ms());
  };

  return {
    scored,
    answers,
    outcomes,
    checking,
    waiting,
    /** Check can be pressed: every item still open is answered and its recordings were played. */
    canCheck: checking && !waiting,
    explaining,
    /** The item the number keys choose in: the one last touched, else the first still to answer. */
    activeItem:
      touched !== undefined && open.includes(touched)
        ? touched
        : (open.find((i) => !complete(i)) ?? open[0]),
    /** An item's recordings (its own and the exercise's) have been played. */
    itemHeard: (i: number) =>
      [`item-${i}`, "exercise"].every((key) => !recordings.includes(key) || heard.has(key)),
    hear: (key: string) => setHeard((prev) => (prev.has(key) ? prev : new Set(prev).add(key))),
    touch: (i: number) => setTouched(i),
    answer(i: number, value: unknown) {
      setAnswers((prev) => ({ ...prev, [i]: value }));
      // One choice answers the item: the number keys go on to the next one.
      setTouched(exercise.type === "single_choice" ? undefined : i);
    },
    check,
    /** Answers one checked item again: its answer, mark and explanation are cleared. */
    answerAgain(i: number) {
      setAnswers(({ [i]: _, ...rest }) => rest);
      setOutcomes((prev) => {
        const { [i]: _, ...rest } = prev ?? {};
        return Object.keys(rest).length ? rest : undefined;
      });
      setExplaining((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });
      setRounds((r) => ({ ...r, item: { ...r.item, [i]: (r.item[i] ?? 0) + 1 } }));
      shownAt.current = Date.now();
    },
    /** The whole exercise again: every card, and the exercise's own media, made anew. */
    retry() {
      setAnswers({});
      setOutcomes(undefined);
      setExplaining(new Set());
      setRounds((r) => ({ all: r.all + 1, item: {} }));
      shownAt.current = Date.now();
    },
    /** What a card is made anew by (React's key): the item, and how often it was begun again. */
    cardKey: (i: number) => `${exercise.items[i]?.key}:${rounds.all}:${rounds.item[i] ?? 0}`,
    /** What the exercise's own media are made anew by. */
    round: rounds.all,
    toggleExplain(i: number) {
      setExplaining((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    },
    /** Leaving: an unscored exercise records the ratings given and the rest as skipped (once). */
    leave() {
      if (scored || readOnly) return;
      const rated: Array<{ itemKey: string; answer: unknown; outcome: Outcome }> = [];
      const skipped: string[] = [];
      exercise.items.forEach((item, i) => {
        if (answers[i] === undefined) {
          if (!stored?.skipped.includes(item.key)) skipped.push(item.key);
        } else if (answers[i] !== stored?.last[item.key]?.answer) {
          rated.push({
            itemKey: item.key,
            answer: answers[i],
            outcome: checkItem(exercise, i, answers[i], lang),
          });
        }
      });
      if (rated.length || skipped.length) onAnswered(rated, skipped, ms());
    },
    /** Moving on without answering: every item is recorded as skipped. */
    skip() {
      onAnswered(
        [],
        exercise.items.map((item) => item.key),
        ms(),
      );
    },
  };
}
