// How a screen shows what it just stored at once, before the next read: pure updates of cached lists,
// kept here so each is written once and tested (test/cache.test.ts). Used by every feature folder.

/** A list newest first with `item` at the top, replacing an older copy of it (`same`). */
export function prepend<T>(list: T[] | undefined, item: T, same: (a: T, b: T) => boolean): T[] {
  return [item, ...(list ?? []).filter((x) => !same(x, item))];
}

/** A writing check on top of the lesson's earlier ones. */
export function withAttempt<S extends { attempts: A[] }, A extends { ts: number }>(
  state: S | undefined,
  attempt: A,
): S | undefined {
  return state && { ...state, attempts: prepend(state.attempts, attempt, (a, b) => a.ts === b.ts) };
}

/** A scene on top of the lesson's scenes; a scene just started ends the one that was open. */
export function withScene<T extends { id: string; done: boolean }>(
  data: { scenes: T[] } | undefined,
  scene: T,
  started: boolean,
): { scenes: T[] } {
  const rest = (data?.scenes ?? []).filter((s) => s.id !== scene.id);
  return { scenes: [scene, ...(started ? rest.map((s) => ({ ...s, done: true })) : rest)] };
}

/** A list newest first with `item` in its place when the list has it (an answer added to it), else on
 *  top (one just made). */
export function inPlace<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [item, ...list];
}

/** An Understanding text in its place in the lesson's list, or on top (`inPlace`). */
export function withText<T extends { id: string }, S extends { texts: T[] }>(
  state: S | undefined,
  text: T,
): S | undefined {
  return state && { ...state, texts: inPlace(state.texts, text) };
}

/** A mistakes review in its place in the lesson's list, or on top (`inPlace`). */
export function withReview<T extends { id: string }, S extends { reviews: T[] }>(
  state: S | undefined,
  review: T,
): S | undefined {
  return state && { ...state, reviews: inPlace(state.reviews, review) };
}

/** A chat with turns added at its end (the pair the server just stored); the rest of it kept. */
export function withTurns<D extends { turns: unknown[] }>(
  data: D | undefined,
  turns: D["turns"],
): D | { turns: D["turns"] } {
  return { ...data, turns: [...(data?.turns ?? []), ...turns] };
}

/** A spoken answer's check after the run's earlier ones (oldest first, as the run keeps them). */
export function withCheck<T>(
  data: { checks: T[] } | undefined,
  check: T,
): { checks: T[] } | undefined {
  return data && { checks: [...data.checks, check] };
}
