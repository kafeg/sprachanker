// The Notebook's first page: the study days (the engine's activity, every event counted by its
// run's module, the time spent read from one timeline of every event) and each module's standing,
// gathered the same way from every module (schema `stats.ts`) — the Notebook knows no module's
// internals. A lesson's journal is the lessons module's (lesson-journal), an exam's page the exams
// module's (`journal`). Reads only (the exams' standing hands in a mock exam left past its time).
import {
  ACTIVITY_EVENTS,
  activityByDay,
  dayStarts,
  SPANS,
  type Span,
  spanBars,
  studyDay,
} from "@sprachanker/engine";
import { MODULE_OF_KIND, type ModuleStanding } from "@sprachanker/schema";
import type { RunStore } from "./run-store.ts";

export function createNotebook(deps: {
  store: RunStore;
  /** Every module's standing, in the order the Notebook shows them. */
  modules: Array<() => ModuleStanding | Promise<ModuleStanding>>;
  now: () => number;
}) {
  const { store } = deps;

  return {
    /** Every study day with something done (oldest first, what each held by module), today's
     *  start, each span's bars (engine `spanBars`: the study days' starts, here where the days are
     *  told apart; a week from `firstDay`, 0 Sunday … 6 Saturday), and each module's standing. */
    async overview(firstDay = 1) {
      const kinds = store.kinds();
      const days = activityByDay(
        store.eventsWhere({ types: [...ACTIVITY_EVENTS] }),
        dayStarts(),
        (id) => {
          const kind = kinds.get(id);
          return kind && MODULE_OF_KIND[kind];
        },
        store.moments(),
      );
      const modules = await Promise.all(deps.modules.map((standing) => standing()));
      const today = studyDay(deps.now()).start;
      const spans = Object.fromEntries(
        SPANS.map((span) => [span, spanBars(span, today, days[0]?.start, firstDay)]),
      ) as Record<Span, ReturnType<typeof spanBars>>;
      return { days, today, spans, modules };
    },
  };
}
export type Notebook = ReturnType<typeof createNotebook>;
