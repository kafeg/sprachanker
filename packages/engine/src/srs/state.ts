// A face's FSRS state as kept in `FaceState.state` (ts-fsrs `State`): new, learning, review, relearning.
import type { FaceState } from "@sprachanker/schema";
import { State } from "ts-fsrs";

/** Never answered: no state, or FSRS's own "new" (an imported deck may carry one). */
export const isNew = (s: FaceState | null | undefined) => !s || s.state === State.New;

/** Going through its steps: learning (a new face) or relearning (a forgotten one). */
export const isLearning = (s: FaceState) =>
  s.state === State.Learning || s.state === State.Relearning;

/** Learning, not relearning: the learning steps apply, not the relearning ones. */
export const isFirstLearning = (s: FaceState) => s.state === State.Learning;

/** In review: past its steps. */
export const inReview = (
  s: FaceState | null | undefined,
): s is FaceState & { state: State.Review } => s?.state === State.Review;
