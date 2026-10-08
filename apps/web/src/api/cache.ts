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

/** A chat with turns added at its end (the pair the server just stored). */
export function withTurns<T>(data: { turns: T[] } | undefined, turns: T[]): { turns: T[] } {
  return { turns: [...(data?.turns ?? []), ...turns] };
}

/** A word's example on top of the kept ones. */
export function withExample<T extends { ts: number }>(
  data: { examples: T[] } | undefined,
  example: T,
): { examples: T[] } {
  return { examples: prepend(data?.examples, example, (a, b) => a.ts === b.ts) };
}

/** A spoken answer's check after the run's earlier ones (oldest first, as the run keeps them). */
export function withCheck<T>(
  data: { checks: T[] } | undefined,
  check: T,
): { checks: T[] } | undefined {
  return data && { checks: [...data.checks, check] };
}
