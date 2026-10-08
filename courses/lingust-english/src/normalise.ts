// Normalisation (offline, deterministic): parsed pages + media.json → canonical/ and locale/ files.
// Stages of the index are units; each lesson keeps its explanation as grammar pages, its examples
// with recordings as listen-and-repeat exercises, its vocabulary and its exercises (exercise.ts).
import {
  draftExercise,
  draftOrUnknown,
  escapeHtml,
  type Headword,
  type LibraryFile,
  type LooseDraft,
  type MediaIndex,
  mediaPath,
  shapeHeadword,
  skippedWords,
  Unmapped,
  unknownExercise,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  CourseIndex,
  courseKey,
  type Exercise,
  exerciseKey,
  Lesson,
  type LessonKey,
  LocaleCourse,
  type LocaleExercise,
  LocaleLesson,
  lessonKey,
  type PartOfSpeech,
  parseLessonKey,
  unitKey,
  type VocabEntry,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, COURSE, EDITION, SERIES, SOURCE, TITLE } from "./catalog.ts";
import { type El, parseHtml } from "./dom.ts";
import { Homework, mapExercise, speechExercise } from "./exercise.ts";
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
export function headword(head: string, marks: string[], forms: string[]): Headword {
  const shape = shapeHeadword("en", head);
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
function vocabulary(key: LessonKey, raw: string, rows: Array<VocabRow & { lemma?: string }>) {
  const words = vocabEntries(
    key,
    "en",
    rows
      .filter((row) => row.translation)
      .map((row) => {
        const lemma = row.lemma ?? withoutIpa(row.head);
        return {
          head: {
            ...headword(lemma, row.marks, row.forms),
            ...(row.forms.length ? { forms: row.forms.join(", ") } : {}),
            ...(row.ipa ? { note: row.ipa } : {}),
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
  /** A drafted exercise pushed; one that does not fit stands as `unknown`, its reason noted. */
  const pushDraft = (draft: LooseDraft, loc: LocaleExercise) => {
    const { exercise, unmapped: reason } = draftOrUnknown(draft, raw);
    if (reason) {
      unknown++;
      unmapped.push({ path: raw, reason: `${draft.key}: ${reason}` });
    }
    push(exercise, loc);
  };
  // Keys follow the source, never what the mapping made of it (02): a numbered task is ex-<its
  // number>, a section's examples ex-1<section>, the closing lines ex-300 — so a normaliser fix that
  // maps one more task never moves the others' keys (and the learner's answers with them).
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
    ({ vocab, translations, unmapped: skipped } = vocabulary(key, raw, page.vocab));
    unmapped.push(...skipped);
    for (const [s, section] of page.sections.entries()) {
      const bodyHtml = renderSection(section.elements);
      if (bodyHtml) grammar.push({ title: section.title, bodyHtml });
      const k = exerciseKey(key, EXAMPLES + s + 1);
      const speech = speechExercise(k, section.snippets, media);
      if (!speech) continue;
      const allAudio = speech.items.every((i) => "media" in i);
      pushDraft(
        { key: k, type: "speech_selfrate", items: speech.items },
        {
          sourceId: `${src.info.slug}#examples-${s + 1}`,
          // A section without a heading gives no title (the player numbers it).
          ...(section.title && { title: section.title }),
          instructionHtml: allAudio ? LISTEN : READ,
          items: speech.locale,
        },
      );
    }
    for (const [i, ex] of page.exercises.entries()) {
      const number = Number(/\d+/.exec(ex.label)?.[0]);
      const k = exerciseKey(key, number > 0 && number < EXAMPLES ? number : UNNUMBERED + i);
      const loc: LocaleExercise = {
        sourceId: `${src.info.slug}#${ex.label}`,
        ...(ex.label && { title: ex.label }),
        items: {},
      };
      const instructionHtml = renderSection([paragraph(ex.instructionHtml)]);
      if (instructionHtml) loc.instructionHtml = instructionHtml;
      try {
        const mapped = mapExercise(k, ex, media);
        push(draftExercise({ key: k, ...mapped.draft }), { ...loc, items: mapped.items });
        for (const s of mapped.skipped)
          unmapped.push({ path: raw, reason: `${k} (${ex.label}) ${s}` });
      } catch (error) {
        if (error instanceof Homework) {
          // Nothing to check: the task stays readable as the lesson's homework.
          const bodyHtml = renderSection(
            [ex.instructionHtml, ...ex.paragraphs].map((html) => paragraph(html)),
          );
          homework.push({ sourceId: loc.sourceId, title: ex.label, bodyHtml });
          continue;
        }
        if (!(error instanceof Unmapped)) throw error;
        unknown++;
        push(unknownExercise({ key: k }, raw, error.message), loc);
        unmapped.push({ path: raw, reason: `${k} (${ex.label}): ${error.message}` });
      }
    }
    const epilogue = page.exercises.flatMap((e) => e.epilogue);
    const k = exerciseKey(key, CLOSING);
    const speech = speechExercise(k, epilogue, media);
    if (speech)
      pushDraft(
        { key: k, type: "speech_selfrate", items: speech.items },
        {
          sourceId: `${src.info.slug}#closing`,
          instructionHtml: LISTEN,
          items: speech.locale,
        },
      );
  }

  return {
    lesson: {
      format: 1,
      key,
      unit,
      media: audio ? { audio } : {},
      goals: [],
      pages,
      vocab,
      unmapped,
    },
    locale: {
      format: 1,
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

export function normaliseLingust(units: UnitSource[], index: MediaIndex): Normalised {
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
      const key = lessonKey(course, u + 1, l + 1);
      lessons.push(key);
      const built = buildLesson(src, key, unit, index);
      order++;
      unknown += built.unknown;
      const { name } = parseLessonKey(key);
      files.push({
        path: `canonical/${COURSE}/lessons/${name}.json`,
        schema: Lesson,
        value: built.lesson,
      });
      files.push({
        path: `locale/${EDITION}/${COURSE}/lessons/${name}.json`,
        schema: LocaleLesson,
        value: built.locale,
      });
    }
    courseUnits.push({ key: unit, lessons });
  }
  files.push({
    path: `canonical/${COURSE}/course.json`,
    schema: CourseIndex,
    value: {
      format: 1,
      key: course,
      source: SOURCE,
      units: courseUnits,
      exams: [],
      goals: [],
    } satisfies CourseIndex,
  });
  files.push({
    path: `locale/${EDITION}/${COURSE}/course.json`,
    schema: LocaleCourse,
    value: {
      format: 1,
      edition: EDITION,
      course,
      sourceId: COURSE,
      title: TITLE,
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    } satisfies LocaleCourse,
  });
  return { files, lessons: order, unknown };
}
