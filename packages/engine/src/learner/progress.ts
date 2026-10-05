// Lesson progress derived from runs and events (04, "Learner model"; 05, "Derived state").
import type { LessonResult, Outcome, Run, StoredEvent } from "@sprachanker/schema";

export interface LessonProgress {
  status: "new" | "in_progress" | "done";
  /** Best score of finished runs, 0..1. */
  bestScore?: number;
  activeRunId?: string;
  finishedRuns: number;
}

interface Answered {
  outcome?: Outcome;
  attempt: number;
}

/** Score of a lesson run: mean first-attempt score of its scored items (05, "Lifecycle"). */
export function lessonResult(events: StoredEvent[]): LessonResult {
  const first = new Map<string, Outcome>();
  for (const e of events) {
    if (e.type !== "answered" || !e.itemKey) continue;
    const { outcome } = e.payload as Answered;
    if (outcome && !first.has(e.itemKey)) first.set(e.itemKey, outcome);
  }
  const scored = [...first.values()].filter((o) => o.result !== "unscored");
  const score = scored.length ? scored.reduce((sum, o) => sum + o.score, 0) / scored.length : 0;
  return { score, scored: scored.length, answered: first.size };
}

/** Page to continue a run on: the last page shown. */
export function resumePage(events: StoredEvent[]): number {
  let page = 0;
  for (const e of events)
    if (e.type === "page_shown") page = (e.payload as { pageIndex: number }).pageIndex;
  return page;
}

/** Progress per lesson key over all lesson runs. */
export function lessonProgress(runs: Run[]): Map<string, LessonProgress> {
  const out = new Map<string, LessonProgress>();
  for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    if (run.kind !== "lesson" || !run.contextKey) continue;
    const p = out.get(run.contextKey) ?? { status: "new", finishedRuns: 0 };
    if (run.status === "finished") {
      p.finishedRuns++;
      p.status = "done";
      const score = run.result?.score;
      if (score !== undefined) p.bestScore = Math.max(p.bestScore ?? 0, score);
    } else if (run.status === "active") {
      p.activeRunId = run.id;
      if (p.status === "new") p.status = "in_progress";
    }
    out.set(run.contextKey, p);
  }
  return out;
}
