// The learner's progress as a whole, over every module's runs: resetting it for a
// course, one of its lessons or one of its exams, and the recordings the answers of every run hold.
// Neutral: it knows runs, cards and recordings, not what a lesson or an exam is.
import type { CourseKey, ExamKey, LessonKey } from "@sprachanker/schema";
import type { CardStore } from "./card-store.ts";
import type { Recordings } from "./recordings.ts";
import type { RunStore } from "./run-store.ts";

export function createProgress(deps: {
  store: RunStore;
  /** The cards a lesson made go with it. */
  cards: CardStore;
  /** And the recordings the answers hold. */
  recordings: Pick<Recordings, "remove">;
}) {
  const { store, cards } = deps;
  return {
    /** The learner's recordings the answers of every run hold (a take none holds may go). */
    recordingsInUse: () => new Set(store.recordingIds()),

    /**
     * Resets the learner's progress in a course, or in one of its lessons or exams: every run of it —
     * lesson runs, tutor chats, writing checks, scenes, mock exams and practice — and their events are
     * deleted, and so are the cards it made (the words first met there, by the lesson each card names —
     * also when the run that made it is long gone) with their answers, and the recordings its answers
     * hold. A card another lesson made stays. The only deletion of events besides removing a profile;
     * the screen asks for confirmation.
     */
    reset(course: CourseKey, only?: { lesson: LessonKey } | { exam: ExamKey }) {
      const { removed, recordingIds } = store.atomic(() => {
        const scope = only ?? { course };
        const runIds = store.idsOf(scope);
        // An exam's runs make no cards.
        const cardIds = "exam" in scope ? [] : cards.idsMetIn(scope);
        const recordingIds = store.recordingIds(runIds);
        const removed = store.remove(runIds, cardIds);
        cards.remove(cardIds);
        return { removed: { ...removed, cards: cardIds.length }, recordingIds };
      });
      // Files go once the rows are gone: a failed reset keeps both.
      if (recordingIds.length) deps.recordings.remove(recordingIds);
      return removed;
    },
  };
}
export type Progress = ReturnType<typeof createProgress>;
