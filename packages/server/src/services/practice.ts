// A course's practice (owner, 2026-10-14) as the lessons meet it: each step's variants made for the
// course, read from the library (`practice/`) and added there by the steps' services as they make
// work — so they gather in the course, serve every profile and travel in its bundles —, and the next
// variant a learner has not had taken into the run their lesson shows as the step's work (`variant`:
// its id). The files are the runtime's (PracticeFiles: written under the series' lock).
import type { LibraryView } from "@sprachanker/course-kit/view";
import {
  type Lang,
  type LessonKey,
  type PracticeLesson,
  type PracticeSpeaking,
  type PracticeText,
  type PracticeWriting,
  parseEditionId,
  parseLessonKey,
  type Run,
  type TalkTask,
  type UnderstandingText,
  type WritingTask,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

/** The steps a course's practice holds, in a lesson's order. */
export const PRACTICE_STEPS = ["reading", "listening", "writing", "speaking"] as const;
export type PracticeStepName = (typeof PRACTICE_STEPS)[number];

/** A variant to add, its id and time still to be given. */
export type PracticeAdd =
  | { step: "reading" | "listening"; variant: Omit<PracticeText, "id"> }
  | { step: "writing"; variant: Omit<PracticeWriting, "id"> }
  | { step: "speaking"; variant: Omit<PracticeSpeaking, "id"> };

/** A course's practice on disk (runtime adapter). */
export interface PracticeFiles {
  /** A variant added to a lesson's practice in an edition (made when it has none), its recordings
   *  written first, under the series' lock: the practice now. */
  add(
    series: string,
    practice: {
      lesson: LessonKey;
      edition: string;
      language: Lang;
      add: PracticeAdd & { variant: { id: string } };
      recordings?: Array<{ path: string; wav: Uint8Array }>;
    },
  ): Promise<PracticeLesson>;
}

/** The engine a course's practice is recorded with (owner, 2026-10-14: Qwen3-TTS alone) reading a
 *  language: its speakers, and a text read by one of them (a WAV). */
export interface PracticeReader {
  engine: "qwen";
  voices: string[];
  read(text: string, voice: string): Promise<Uint8Array>;
}

export interface PracticeRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}

/** The verdicts a step's work is kept as, and their result. */
type Taken = {
  reading: Verdict<"understanding">;
  listening: Verdict<"understanding">;
  writing: Verdict<"writing_task">;
  speaking: Verdict<"talk_task">;
};

const ID = "abcdefghijklmnopqrstuvwxyz0123456789";

export function createPractice(deps: {
  store: RunStore;
  library: LibraryView;
  files?: PracticeFiles;
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  random: () => number;
  now?: () => number;
}) {
  const { store, library } = deps;
  const now = deps.now ?? Date.now;
  const where = (lessonKey: LessonKey) => ({ kind: "lesson" as const, about: lessonKey });

  /** The ids of a step's variants the learner had in the lesson (any run). */
  function had(lessonKey: LessonKey, step: PracticeStepName): Set<string> {
    const ids =
      step === "writing"
        ? verdicts(store, "writing_task", where(lessonKey)).map((v) => v.result.variant)
        : step === "speaking"
          ? verdicts(store, "talk_task", where(lessonKey)).map((v) => v.result.variant)
          : verdicts(store, "understanding", where(lessonKey))
              .filter((v) => v.result.step === step)
              .map((v) => v.result.variant);
    return new Set(ids.filter((id): id is string => !!id));
  }

  /** The lesson's practice in the edition, if any was made. */
  const lesson = (r: PracticeRequest) => library.practice(r.series, r.lessonKey, r.edition);
  /** A step's variants of the lesson the learner has not had yet, oldest first. */
  async function left(r: PracticeRequest, step: PracticeStepName) {
    const practice = await lesson(r);
    const taken = had(r.lessonKey, step);
    return (practice?.[step] ?? []).filter((v: { id: string }) => !taken.has(v.id));
  }
  /** A new variant's id: drawn, a number after it where the lesson's practice has it already. */
  async function newId(r: PracticeRequest) {
    const drawn = Array.from({ length: 12 }, () => ID[Math.floor(deps.random() * ID.length)]).join(
      "",
    );
    const practice = await lesson(r);
    const ids = new Set(
      [practice?.reading, practice?.listening, practice?.writing, practice?.speaking].flatMap(
        (vs) => (vs ?? []).map((v: { id: string }) => v.id),
      ),
    );
    let id = drawn;
    for (let n = 2; ids.has(id); n++) id = `${drawn}${n}`;
    return id;
  }
  const language = (edition: string): Lang => parseEditionId(edition).source;

  const self = {
    lesson,

    /** The lessons of a course an edition's practice was made for. */
    lessons: (series: string, course: string, edition: string) =>
      library.practiceLessons(series, course, edition),

    /** The learner language a course's practice is made in: the edition's. */
    language,
    left,
    newId,

    /** Adds a variant (its id made unless given) to the lesson's practice: its id. */
    async add(
      r: PracticeRequest,
      add: PracticeAdd,
      recordings?: Array<{ path: string; wav: Uint8Array }>,
      given?: string,
    ) {
      const id = given ?? (await newId(r));
      if (!deps.files) throw new Error("no practice files on this server");
      const series = parseLessonKey(r.lessonKey).course.split("/")[0];
      if (series !== r.series) throw new ServiceError("no_such_item", 404);
      await deps.files.add(r.series, {
        lesson: r.lessonKey,
        edition: r.edition,
        language: language(r.edition),
        add: { ...add, variant: { ...add.variant, id } } as PracticeAdd & {
          variant: { id: string };
        },
        ...(recordings && { recordings }),
      });
      return id;
    },

    /** Takes the step's next variant the learner has not had into the run the lesson shows, as the
     *  step's work: its verdict, or undefined when none is left. */
    async take<S extends PracticeStepName>(
      r: PracticeRequest,
      step: S,
    ): Promise<Taken[S] | undefined> {
      const [next] = await left(r, step);
      if (!next) return undefined;
      const session = await deps.session(r.lessonKey);
      if (!session) throw new ServiceError("no_lesson_run", 409);
      const base = { input: "", model: next.model, latencyMs: 0 };
      const runId = session.run.id;
      if (step === "writing") {
        const task: WritingTask = { ...(next as PracticeWriting).task, variant: next.id };
        return keepVerdict(store, runId, { ...base, task: "writing_task", result: task })
          .verdict as Taken[S];
      }
      if (step === "speaking") {
        const task: TalkTask = { ...(next as PracticeSpeaking).task, variant: next.id };
        return keepVerdict(store, runId, { ...base, task: "talk_task", result: task })
          .verdict as Taken[S];
      }
      const text: UnderstandingText = { ...(next as PracticeText).text, variant: next.id };
      return keepVerdict(store, runId, { ...base, task: "understanding", result: text })
        .verdict as Taken[S];
    },

    /** The run the lesson shows, or no_lesson_run: asked before work is made for it. */
    async run(lessonKey: LessonKey) {
      const session = await deps.session(lessonKey);
      if (!session) throw new ServiceError("no_lesson_run", 409);
      return session.run;
    },

    /** When a variant was made: now. */
    now,
  };
  return self;
}
export type Practice = ReturnType<typeof createPractice>;
