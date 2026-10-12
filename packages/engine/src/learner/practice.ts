// How each AI practice step of a run went (owner, 2026-10-12: marked as
// exercises are, right or with mistakes, not only done): its first work in the run, as an exercise's
// first attempt — Reading's and Listening's first text answered through (its questions right, some,
// none), Writing's first text checked and Speaking's first task checked (by the check's verdict; a
// role-play by its lines that fit).
import type { PracticeKind, TypedEvent, VerdictOf, WritingCheck } from "@sprachanker/schema";
import { stepOf } from "../check/understanding.ts";

/** A practice step's mark (an exercise's: right, partly right, wrong) and, where it counts them, how
 *  many of how many were right. */
export interface PracticeResult {
  mark: "correct" | "partial" | "wrong";
  right?: number;
  of?: number;
}

/** A share right as a mark: all, some, none. */
const byShare = (right: number, of: number): PracticeResult => ({
  mark: right === of ? "correct" : right > 0 ? "partial" : "wrong",
  right,
  of,
});

/** A writing check's verdict as a mark: no errors right, small ones partly, else wrong. */
const byVerdict = (check: WritingCheck): PracticeResult => ({
  mark:
    check.verdict === "good" ? "correct" : check.verdict === "minor_errors" ? "partial" : "wrong",
});

/** What was said on a Speaking task, marked: a monologue by its check's verdict; a role-play by its
 *  lines that do what their hints ask — all of them and no correction right, some partly (no count:
 *  a line fitting with a correction is neither). */
function talkResult(attempt: VerdictOf<"talk">["result"]): PracticeResult {
  const { check } = attempt;
  if ("verdict" in check) return byVerdict(check);
  const fit = check.turns.some((t) => t.fits);
  const clean = check.turns.every((t) => t.fits && !t.corrections.length);
  return { mark: clean ? "correct" : fit ? "partial" : "wrong" };
}

/** The run's practice steps that have a first work done, with its mark. */
export function practiceMarks(events: TypedEvent[]): Map<PracticeKind, PracticeResult> {
  const out = new Map<PracticeKind, PracticeResult>();
  // Each question's first answer, by the text it was set on.
  const answers = new Map<string, Map<number, boolean>>();
  for (const e of events) {
    if (e.type !== "practice_answered") continue;
    const text = answers.get(e.payload.verdict) ?? new Map<number, boolean>();
    if (!text.has(e.payload.question))
      text.set(e.payload.question, e.payload.outcome.result === "correct");
    answers.set(e.payload.verdict, text);
  }
  for (const e of events) {
    if (e.type !== "llm_verdict") continue;
    const v = e.payload;
    if (v.task === "understanding") {
      const step = stepOf(v.result);
      const given = answers.get(e.id);
      const of = v.result.questions.length;
      if (out.has(step) || !given || given.size < of) continue;
      out.set(step, byShare([...given.values()].filter(Boolean).length, of));
    } else if (v.task === "writing" && !out.has("writing")) out.set("writing", byVerdict(v.result));
    else if (v.task === "talk" && !out.has("speaking")) out.set("speaking", talkResult(v.result));
  }
  return out;
}
