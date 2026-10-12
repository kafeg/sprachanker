// How every module reports its statistics: the learner's work is
// counted per module — lessons, exams, review, and the AI practice — and each learning module gives
// its standing in one shape the Notebook shows without knowing the module.
import { z } from "zod";
import { Lang } from "./lang.ts";
import { RunHeader, type RunKind } from "./learner.ts";

/** What a study day counts the learner's work by. Lessons, exams and review are the learning
 *  modules: each has its runs and its standing. The AI practice is counted only — the learner's
 *  messages and the model's checks, in whichever run — and gives no standing: its services work in
 *  the other modules' runs, besides its own chats and scenes (docs/architecture.md). */
export const MODULES = ["lesson", "exam", "review", "ai"] as const;
export const ModuleId = z.enum(MODULES);
export type ModuleId = z.infer<typeof ModuleId>;

/** The module a run belongs to, by its kind: a tutor chat and a scene are the AI practice. */
export const MODULE_OF_KIND: Record<RunKind, ModuleId> = {
  lesson: "lesson",
  exam: "exam",
  review: "review",
  chat: "ai",
  scene: "ai",
};

const Count = z.number().int().nonnegative();

/** What a study day held: each module's work counted — lesson work (answers,
 *  skips, steps), exam answers, card answers not taken back, the learner's messages and the checks
 *  asked of the model —, of the cards, the new ones learnt and those in review remembered, and the
 *  time each module took. */
export const DayActivity = z.object({
  /** When the study day starts. */
  start: z.number().int(),
  ...({ lesson: Count, exam: Count, review: Count, ai: Count } satisfies Record<
    ModuleId,
    typeof Count
  >),
  /** Faces answered for the first time. */
  newCards: Count,
  /** Answers to faces already in review, and of them those not "Again". */
  recalled: Count,
  remembered: Count,
  /** Time spent (ms) by module where it is known: the cards' measured answers, elsewhere the pauses
   *  between events, every run's on one timeline (engine `activityByDay`). */
  time: z.object({ lesson: Count, exam: Count, review: Count, ai: Count } satisfies Record<
    ModuleId,
    typeof Count
  >),
});
export type DayActivity = z.infer<typeof DayActivity>;

/** A figure of a module's standing, named by its id (the interface says what it is): a count, or a
 *  share 0..1 (`share`); null while there is nothing to tell. `count`: what its note counts (the
 *  answers a share is of). */
export const Figure = z.object({
  id: z.string(),
  value: z.number().nullable(),
  share: z.boolean().optional(),
  count: Count.optional(),
  /** When each thing it counts came to count (a lesson first done), oldest first: the figure over
   *  time. */
  at: z.array(z.number().int()).optional(),
});
export type Figure = z.infer<typeof Figure>;

/** A run as a standing lists it: when, how it ended, the points it scored (an exam's), passed or not
 *  where a pass mark judges it; `mode` and `part`: what kind of run it was in its module (a mock exam
 *  or practice) and the part taken (a module of an exam). */
export const RunSummary = RunHeader.extend({
  points: z.number().optional(),
  max: z.number().optional(),
  passed: z.boolean().optional(),
  mode: z.string().optional(),
  part: z.string().optional(),
  /** What it holds where that is its measure (a review day's card answers). */
  count: Count.optional(),
  /** The study day it is of, where it is one (a review day's start: not when it ended, which is
   *  when the next day's first answer replaced it). */
  day: z.number().int().optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** How many of an entry's latest runs a standing lists. */
export const STANDING_RUNS = 3;

/** One thing a module keeps a standing of — a lesson, an exam, a language's deck: its title, where it
 *  is listed (`group`: a lesson's course; none: on its own), when it was last worked on, whether a run
 *  of it is in progress, how many runs it had, its figures and its latest runs (newest first). */
export const StandingEntry = z.object({
  key: z.string(),
  title: z.string().nullable(),
  group: z.object({ key: z.string(), title: z.string().nullable() }).optional(),
  lastAt: z.number().int(),
  open: z.boolean(),
  runCount: Count,
  figures: z.array(Figure),
  runs: z.array(RunSummary),
});
export type StandingEntry = z.infer<typeof StandingEntry>;

/** A module's standing as every module reports it: its headline figures (words known, lessons done)
 *  and its entries in the order they are shown. */
export const ModuleStanding = z.object({
  module: ModuleId,
  figures: z.array(Figure),
  entries: z.array(StandingEntry),
});
export type ModuleStanding = z.infer<typeof ModuleStanding>;

/** One thing an entry asks of the learner (an exam's question) and how it stands: answered right
 *  last time, wrongly, or not seen; `line`: what it asks, in a list; `group`: where it is asked,
 *  named — an exam of several Teile: its Teil with its module ("Hören · Teil 1"). */
const ItemStanding = z.object({
  key: z.string(),
  state: z.enum(["right", "wrong", "unseen"]),
  line: z.string(),
  group: z.string().optional(),
});

/** An entry in full (its page in the Notebook): every run, and its items as they stand, in the
 *  language they are in; `modules`: an exam of modules, its questions numbered without their module
 *  (as its catalogue numbers them). */
export const EntryDetail = z.object({
  entry: StandingEntry,
  items: z.array(ItemStanding),
  lang: Lang,
  modules: z.boolean().optional(),
});
export type EntryDetail = z.infer<typeof EntryDetail>;
