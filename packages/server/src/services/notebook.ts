// The Notebook's first page (09): the study days (the engine's activity, every event counted by its
// run's module, the time spent read from every event's time) and each module's standing, gathered the same way from every module (schema
// `stats.ts`) — the Notebook knows no module's internals. A lesson's journal is the lessons module's
// (lesson-journal), an exam's page the exams module's (`journal`). Reads only (the exams' standing
// hands in a mock exam left past its time).
import { ACTIVITY_EVENTS, activityByDay, studyDay } from "@sprachanker/engine";
import { MODULE_OF_KIND, type ModuleStanding } from "@sprachanker/schema";
import type { RunStore } from "./run-store.ts";

export function createNotebook(deps: {
  store: RunStore;
  /** Every module's standing, in the order the Notebook shows them. */
  modules: Array<() => ModuleStanding | Promise<ModuleStanding>>;
  now: () => number;
}) {
  const { store } = deps;
  const dayOf = (t: number) => studyDay(t).start;

  return {
    /** Every study day with something done (oldest first, what each held by module), today's
     *  start, and each module's standing. */
    async overview() {
      const kinds = store.kinds();
      const days = activityByDay(
        store.eventsWhere({ types: [...ACTIVITY_EVENTS] }),
        dayOf,
        (id) => {
          const kind = kinds.get(id);
          return kind && MODULE_OF_KIND[kind];
        },
        store.moments(),
      );
      const modules = await Promise.all(deps.modules.map((standing) => standing()));
      return { days, today: dayOf(deps.now()), modules };
    },
  };
}
export type Notebook = ReturnType<typeof createNotebook>;
