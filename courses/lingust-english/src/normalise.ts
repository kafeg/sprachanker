// Normalisation (offline, deterministic): parsed pages + media.json → canonical/ and locale/ files.
// Stages of the index are units; each lesson keeps its explanation as grammar pages, its examples
// with recordings as listen-and-repeat exercises, its vocabulary and its exercises (exercise.ts).
import {
  draftOrUnknown,
  type El,
  escapeHtml,
  type Headword,
  type KeyMap,
  type LibraryFile,
  libraryFile,
  type MappedDraft,
  mediaPath,
  occurrences,
  parseHtml,
  shapeHeadword,
  skippedWords,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  CANONICAL_FORMAT,
  type CourseIndex,
  courseKey,
  type Exercise,
  type ExerciseKey,
  exerciseKey,
  type Lesson,
  type LessonKey,
  LOCALE_FORMAT,
  type LocaleCourse,
  type LocaleExercise,
  type LocaleLesson,
  lessonKey,
  type MediaIndex,
  type PartOfSpeech,
  unitKey,
  type VocabEntry,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, COURSE, EDITION, SERIES, SOURCE, TITLE } from "./catalog.ts";
import { Homework, type Mapped, mapExercise, speechExercise } from "./exercise.ts";
import type { IndexLesson } from "./parse/course-index.ts";
import type { LessonPage } from "./parse/lesson.ts";
import type { VerbRow } from "./parse/verbs.ts";
import type { VocabRow } from "./parse/vocab.ts";
import { renderSection } from "./render.ts";
import { ipaOf, withoutIpa } from "./text.ts";

export type LessonSource =
  | { kind: "lesson"; info: IndexLesson; page: LessonPage }
  | { kind: "verbs"; info: IndexLesson; title: string; elements: El[]; rows: VerbRow[] };

export interface UnitSource {
  title: string;
  lessons: LessonSource[];
}

export interface Normalised {
  files: LibraryFile[];
  lessons: number;
  unknown: number;
}

const MARKS: Record<string, PartOfSpeech> = { v: "verb", adj: "adj", n: "noun", adv: "word" };

/** Lemma and part of speech from the source's marks or forms, else by shape (`shapeHeadword`). */
export function headword(
  head: string,
  marks: string[],
  forms: string[],
  bases: ReadonlyMap<string, string> = new Map(),
): Headword {
  const shape = shapeHeadword("en", head);
  // A past form or participle of the source's table of irregular verbs ("came") is a form of its verb.
  const base = bases.get(head.toLowerCase());
  if (base && base !== head.toLowerCase()) return { lemma: base, pos: "verb" };
  if (forms.length) return { lemma: shape.pos === "verb" ? shape.lemma : head, pos: "verb" };
  const kinds = new Set(marks.map((m) => MARKS[m] ?? "word"));
  if (kinds.size === 1) {
    const pos = [...kinds][0] as PartOfSpeech;
    return { lemma: pos === "verb" && shape.pos === "verb" ? shape.lemma : head, pos };
  }
  return shape;
}

const LISTEN = "<p>Прослушайте и повторите вслух.</p>";
const READ = "<p>Повторите вслух (прослушайте запись, где она есть).</p>";

/** Words with a translation; the IPA transcription is the entry's note. Rows left out are reported. */
/** The source's table of irregular verbs as each form's verb ("came" → "come"): lemmas of its words. */
export function verbBases(units: UnitSource[]): Map<string, string> {
  const bases = new Map<string, string>();
  for (const src of units.flatMap((u) => u.lessons))
    if (src.kind === "verbs")
      for (const row of src.rows) {
        const base = withoutIpa(row.forms[0]).toLowerCase();
        for (const form of row.forms.slice(1).flatMap((f) => withoutIpa(f).split(/\s*[/,]\s*/)))
          if (form && !bases.has(form.toLowerCase())) bases.set(form.toLowerCase(), base);
      }
  return bases;
}

function vocabulary(
  key: LessonKey,
  raw: string,
  rows: Array<VocabRow & { lemma?: string }>,
  bases: ReadonlyMap<string, string> = new Map(),
) {
  const words = vocabEntries(
    key,
    "en",
    rows
      .filter((row) => row.translation)
      .map((row) => {
        const lemma = row.lemma ?? withoutIpa(row.head);
        const head = headword(lemma, row.marks, row.forms, bases);
        // A word's forms are its others: the verb a past form belongs to is its lemma, not a form.
        const forms = row.forms.filter((f) => f.toLowerCase() !== head.lemma.toLowerCase());
        return {
          head: {
            ...head,
            ...(forms.length ? { forms: forms.join(", ") } : {}),
            ...(row.ipa ? { ipa: row.ipa } : {}),
          },
          target: row.head,
          translation: row.translation,
        };
      }),
  );
  return {
    ...words,
    unmapped: [
      ...skippedWords(raw, words.skipped),
      ...skippedWords(
        raw,
        rows.filter((row) => !row.translation).map((row) => ({ target: row.head })),
        "word without a translation",
      ),
    ],
  };
}

interface Built {
  lesson: Lesson;
  locale: LocaleLesson;
  unknown: number;
}

function buildLesson(
  src: LessonSource,
  key: LessonKey,
  unit: Lesson["unit"],
  index: MediaIndex,
  keys: KeyMap,
  bases: ReadonlyMap<string, string>,
): Built {
  const media = (url: string | undefined) => mediaPath(index, url);
  const raw = `raw/${EDITION}/${COURSE}/${src.info.slug}.html`;
  const num = /^lesson(\d+)$/.exec(src.info.slug)?.[1];
  const title = num ? `Урок ${num}. ${src.info.title}` : src.info.title;
  const synopsisHtml =
    (src.info.desc ? `<p>${escapeHtml(src.info.desc)}</p>` : "") +
    (/^[ABC]\d/.test(src.info.level) ? `<p>Уровень: ${escapeHtml(src.info.level)}</p>` : "");

  const pages: Lesson["pages"] = [];
  const exercises: LocaleLesson["exercises"] = {};
  const unmapped: Lesson["unmapped"] = [];
  let unknown = 0;
  const push = (exercise: Exercise, loc: LocaleExercise) => {
    pages.push({ exercise });
    exercises[exercise.key] = loc;
  };
  /** An exercise mapped; one that cannot be stands as `unknown`, its reason noted as
   *  `<what>: <reason>`. */
  const mapped = (k: ExerciseKey, what: string, map: () => MappedDraft) => {
    const result = draftOrUnknown({ key: k }, raw, map);
    if (result.unmapped) {
      unknown++;
      unmapped.push({ path: raw, reason: `${what}: ${result.unmapped}` });
    }
    return result;
  };
  // Keys follow the source, never what the mapping made of it (02): a numbered task is ex-<its
  // number>, a section's examples ex-1<section>, the closing lines ex-300 — so a normaliser fix that
  // maps one more task never moves the others' keys (and the learner's answers with them). A section
  // and a task without a number keep theirs by their title through the series' key map (by place the
  // first time), so one the source inserts or a fix splits out moves no other.
  const EXAMPLES = 100;
  const CLOSING = 300;
  const UNNUMBERED = 400;

  let grammar: LocaleLesson["tabs"]["grammar"] = [];
  const homework: LocaleLesson["tabs"]["grammar"] = [];
  let vocab: VocabEntry[] = [];
  let translations: LocaleLesson["vocab"] = {};
  let skipped: Lesson["unmapped"] = [];
  let audio: string | undefined;

  if (src.kind === "verbs") {
    ({
      vocab,
      translations,
      unmapped: skipped,
    } = vocabulary(
      key,
      raw,
      src.rows.map((r) => ({
        head: withoutIpa(r.forms[0]),
        lemma: withoutIpa(r.forms[0]),
        translation: r.translation,
        ...(ipaOf(` ${r.forms[0]}`) ? { ipa: ipaOf(` ${r.forms[0]}`) } : {}),
        marks: ["v"],
        forms: [withoutIpa(r.forms[1]), withoutIpa(r.forms[2])],
      })),
    ));
    unmapped.push(...skipped);
    const body = renderSection(src.elements);
    grammar = body ? [{ title: src.title, bodyHtml: body }] : [];
  } else {
    const { page } = src;
    audio = media(page.audio);
    ({ vocab, translations, unmapped: skipped } = vocabulary(key, raw, page.vocab, bases));
    unmapped.push(...skipped);
    const sectionIds = occurrences();
    for (const [s, section] of page.sections.entries()) {
      const bodyHtml = renderSection(section.elements);
      if (bodyHtml) grammar.push({ title: section.title, bodyHtml });
      const id = sectionIds(section.title || `#${s + 1}`);
      const k = exerciseKey(key, EXAMPLES + keys.number(`${key}#examples`, id, s + 1));
      const speech = speechExercise(k, section.snippets, media);
      if (!speech) continue;
      const allAudio = speech.items.every((i) => "media" in i);
      push(mapped(k, k, () => ({ type: "speech_selfrate", items: speech.items })).exercise, {
        sourceId: `${src.info.slug}#examples-${s + 1}`,
        // A section without a heading gives no title (the player numbers it).
        ...(section.title && { title: section.title }),
        instructionHtml: allAudio ? LISTEN : READ,
        items: speech.locale,
      });
    }
    const labels = occurrences();
    for (const [i, ex] of page.exercises.entries()) {
      const number = Number(/\d+/.exec(ex.label)?.[0]);
      const k = exerciseKey(
        key,
        number > 0 && number < EXAMPLES
          ? number
          : UNNUMBERED - 1 + keys.number(`${key}#unnumbered`, labels(ex.label), i + 1),
      );
      const loc: LocaleExercise = {
        sourceId: `${src.info.slug}#${ex.label}`,
        ...(ex.label && { title: ex.label }),
        items: {},
      };
      const instructionHtml = renderSection([paragraph(ex.instructionHtml)]);
      if (instructionHtml) loc.instructionHtml = instructionHtml;
      try {
        let source = undefined as Mapped | undefined;
        const { exercise, unmapped: reason } = mapped(k, `${k} (${ex.label})`, () => {
          source = mapExercise(k, ex, media);
          return source.draft;
        });
        if (reason || !source) push(exercise, loc);
        else {
          push(exercise, { ...loc, items: source.items });
          for (const s of source.skipped)
            unmapped.push({ path: raw, reason: `${k} (${ex.label}) ${s}` });
        }
      } catch (error) {
        if (!(error instanceof Homework)) throw error;
        // Nothing to check: the task stays readable as the lesson's homework.
        const bodyHtml = renderSection(
          [ex.instructionHtml, ...ex.paragraphs].map((html) => paragraph(html)),
        );
        homework.push({ sourceId: loc.sourceId, title: ex.label, bodyHtml });
      }
    }
    const epilogue = page.exercises.flatMap((e) => e.epilogue);
    const k = exerciseKey(key, CLOSING);
    const speech = speechExercise(k, epilogue, media);
    if (speech)
      push(mapped(k, k, () => ({ type: "speech_selfrate", items: speech.items })).exercise, {
        sourceId: `${src.info.slug}#closing`,
        instructionHtml: LISTEN,
        items: speech.locale,
      });
  }

  return {
    lesson: {
      format: CANONICAL_FORMAT,
      key,
      unit,
      media: audio ? { audio } : {},
      goals: [],
      pages,
      vocab,
      unmapped,
    },
    locale: {
      format: LOCALE_FORMAT,
      edition: EDITION,
      lesson: key,
      sourceId: src.info.slug,
      title,
      ...(synopsisHtml ? { synopsisHtml } : {}),
      exercises,
      vocab: translations,
      tabs: { grammar, culture: [], ...(homework.length ? { homework } : {}) },
      downloads: [],
    },
    unknown,
  };
}

/** An HTML fragment as one paragraph (instructions; answer fields inside are dropped when rendered). */
const paragraph = (html: string): El => ({ ...parseHtml(html), tag: "p" });

/** The course's files; lessons, example sections and tasks without a number keep their numbers by
 *  source id in `keys`, the series' key map (02, "Keys"). */
export function normaliseLingust(units: UnitSource[], index: MediaIndex, keys: KeyMap): Normalised {
  const bases = verbBases(units);
  const course = courseKey(SERIES, COURSE);
  const files: LibraryFile[] = [];
  const courseUnits: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  let order = 0;
  let unknown = 0;
  for (const [u, unitSrc] of units.entries()) {
    const unit = unitKey(course, u + 1);
    unitTitles[unit] = { title: unitSrc.title };
    const lessons: LessonKey[] = [];
    for (const [l, src] of unitSrc.lessons.entries()) {
      const key = lessonKey(course, u + 1, keys.number(unit, src.info.slug, l + 1));
      lessons.push(key);
      const built = buildLesson(src, key, unit, index, keys, bases);
      order++;
      unknown += built.unknown;
      files.push(libraryFile.lesson(built.lesson));
      files.push(libraryFile.localeLesson(built.locale));
    }
    courseUnits.push({ key: unit, lessons });
  }
  files.push(
    libraryFile.course({
      format: CANONICAL_FORMAT,
      key: course,
      source: SOURCE,
      units: courseUnits,
      exams: [],
      goals: [],
    }),
  );
  files.push(
    libraryFile.localeCourse({
      format: LOCALE_FORMAT,
      edition: EDITION,
      course,
      sourceId: COURSE,
      title: TITLE,
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    }),
  );
  return { files, lessons: order, unknown };
}
