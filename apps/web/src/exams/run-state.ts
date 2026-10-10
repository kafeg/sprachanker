// A running exam's state on this device (09, Exam run): each question's state and the tally, the
// question on screen (kept per run across a reload; ← and → move), and the time left.
import type { ExamItem } from "@sprachanker/schema";
import { useEffect, useRef, useState } from "react";
import type { QuestionState } from "./navigator.tsx";
import type { latestAnswers } from "./questions.ts";

type Answers = ReturnType<typeof latestAnswers>;
type Given = Answers extends Map<string, infer A> ? A : never;

/** A question as the plan marks it: practice tells right or wrong, a mock exam only answered. */
export function questionState(given: Given | undefined, mode: "test" | "practice"): QuestionState {
  if (!given) return "open";
  if (mode === "practice" && given.outcome && given.outcome.result !== "unscored")
    return given.outcome.result === "correct" ? "right" : "wrong";
  return "answered";
}

/** How many questions are answered, and of them right and wrong (an unscored answer is neither). */
export function runTally(items: ExamItem[], answers: Answers) {
  let answered = 0;
  let right = 0;
  let wrong = 0;
  for (const i of items) {
    const given = answers.get(i.key);
    if (!given) continue;
    answered++;
    const result = given.outcome?.result;
    if (result === "correct") right++;
    else if (result && result !== "unscored") wrong++;
  }
  return { answered, right, wrong };
}

/** Where a run was left on this device (a reload comes back to its question). */
const placeKey = (run: string) => `sprachanker.exam-place:${run}`;
const readPlace = (run: string) => {
  try {
    return Number(sessionStorage.getItem(placeKey(run)) ?? Number.NaN);
  } catch {
    return Number.NaN;
  }
};
const writePlace = (run: string, index: number) => {
  try {
    sessionStorage.setItem(placeKey(run), String(index));
  } catch {
    // Storage blocked: a reload starts at the first open question.
  }
};

/** The question on screen: where this device left the run, else the first one not answered; `go`
 *  moves to another (← and → too, not while typing), `shownAt` when the one on screen came. */
export function useQuestionPlace(runId: string, items: ExamItem[], answers: Answers) {
  const [current, setCurrent] = useState(() => {
    const kept = readPlace(runId);
    if (kept >= 0 && kept < items.length) return kept;
    const open = items.findIndex((i) => !answers.has(i.key));
    return open < 0 ? 0 : open;
  });
  const shownAt = useRef(Date.now());
  const go = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setCurrent(next);
    writePlace(runId, next);
    shownAt.current = Date.now();
    window.scrollTo({ top: 0 });
  };
  const moveBy = useRef((_: number) => {});
  moveBy.current = (step: number) => go(current + step);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, [contenteditable]") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "ArrowRight") moveBy.current(1);
      if (e.key === "ArrowLeft") moveBy.current(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { current, go, shownAt };
}

/** The time left (ms; none without a deadline), each second by the server's clock (`skew`: it ahead
 *  of this device's); `onEnd` is called once it runs out. */
export function useTimeLeft(deadline: number | null, skew: number, onEnd: () => void) {
  const [now, setNow] = useState(Date.now());
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const left = deadline === null ? undefined : deadline - (now + skew);
  useEffect(() => {
    if (left !== undefined && left <= 0) end.current();
  }, [left]);
  return left;
}
