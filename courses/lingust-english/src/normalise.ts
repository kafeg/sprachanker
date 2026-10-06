// Normalisation (offline, deterministic): parsed pages + media.json → canonical/ and locale/ files.
// Stages of the index are units; each lesson keeps its explanation as grammar pages, its examples
// with recordings as listen-and-repeat exercises, its vocabulary and its exercises (exercise.ts).
import {
  escapeHtml,
  type LibraryFile,
  type MediaIndex,
  mediaPath,
  vocabEntries,
  withFingerprint,
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
import { Homework, mapExercise, speechExercise, Unmapped } from "./exercise.ts";
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

/** Part of speech from the source's marks or forms, else by shape ("to …", several words). */
export function partOfSpeech(head: string, marks: string[], forms: string[]): PartOfSpeech {
  if (forms.length) return "verb";
  const kinds = new Set(marks.map((m) => MARKS[m] ?? "word"));
  if (kinds.size === 1) return [...kinds][0] as PartOfSpeech;
  if (/^to\s/i.test(head)) return "verb";
  return /\s/.test(head.trim()) ? "phrase" : "word";
}

const LISTEN = "<p>Прослушайте и повторите вслух.</p>";
const READ = "<p>Повторите вслух (прослушайте запись, где она есть).</p>";

/** Words with a translation; the IPA transcription is the entry's note. */
function vocabulary(key: LessonKey, rows: Array<VocabRow & { lemma?: string }>) {
  return vocabEntries(
    key,
    "en",
    rows
      .filter((row) => row.translation)
      .map((row) => {
        const lemma = row.lemma ?? withoutIpa(row.head);
        return {
          head: {
            lemma,
            pos: partOfSpeech(lemma, row.marks, row.forms),
            ...(row.forms.length ? { forms: row.forms.join(", ") } : {}),
            ...(row.ipa ? { note: row.ipa } : {}),
          },
          target: row.head,
          translation: row.translation,
        };
      }),
  );
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
  order: number,
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
  const push = (draft: Record<string, unknown>, loc: LocaleExercise) => {
    const exercise = withFingerprint({
      newWords: [],
      ruleIds: [],
      ...draft,
    } as never) as Exercise;
    pages.push({ exercise });
    exercises[exercise.key] = loc;
  };
  const nextKey = () => exerciseKey(key, pages.length + 1);

  let grammar: LocaleLesson["tabs"]["grammar"] = [];
  const homework: LocaleLesson["tabs"]["grammar"] = [];
  let vocab: VocabEntry[] = [];
  let translations: LocaleLesson["vocab"] = {};
  let audio: string | undefined;

  if (src.kind === "verbs") {
    ({ vocab, translations } = vocabulary(
      key,
      src.rows.map((r) => ({
        head: withoutIpa(r.forms[0]),
        lemma: withoutIpa(r.forms[0]),
        translation: r.translation,
        ...(ipaOf(` ${r.forms[0]}`) ? { ipa: ipaOf(` ${r.forms[0]}`) } : {}),
        marks: ["v"],
        forms: [withoutIpa(r.forms[1]), withoutIpa(r.forms[2])],
      })),
    ));
    const body = renderSection(src.elements);
    grammar = body ? [{ title: src.title, bodyHtml: body }] : [];
  } else {
    const { page } = src;
    audio = media(page.audio);
    ({ vocab, translations } = vocabulary(key, page.vocab));
    for (const section of page.sections) {
      const bodyHtml = renderSection(section.elements);
      if (bodyHtml) grammar.push({ title: section.title, bodyHtml });
      const k = nextKey();
      const speech = speechExercise(k, section.snippets, media);
      if (!speech) continue;
      const allAudio = speech.items.every((i) => "media" in i);
      push(
        { key: k, type: "speech_selfrate", items: speech.items },
        {
          sourceId: `${src.info.slug}#examples-${pages.length + 1}`,
          title: section.title,
          instructionHtml: allAudio ? LISTEN : READ,
          items: speech.locale,
        },
      );
    }
    for (const ex of page.exercises) {
      const k = nextKey();
      const loc: LocaleExercise = {
        sourceId: `${src.info.slug}#${ex.label}`,
        title: ex.label,
        items: {},
      };
      const instructionHtml = renderSection([paragraph(ex.instructionHtml)]);
      if (instructionHtml) loc.instructionHtml = instructionHtml;
      try {
        const mapped = mapExercise(k, ex, media);
        push({ key: k, ...mapped.draft }, { ...loc, items: mapped.items });
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
        push(
          { key: k, type: "unknown", items: [{ key: `${k}#1`, raw, reason: error.message }] },
          loc,
        );
        unmapped.push({ path: raw, reason: `${k} (${ex.label}): ${error.message}` });
      }
    }
    const epilogue = page.exercises.flatMap((e) => e.epilogue);
    const k = nextKey();
    const speech = speechExercise(k, epilogue, media);
    if (speech)
      push(
        { key: k, type: "speech_selfrate", items: speech.items },
        { sourceId: `${src.info.slug}#closing`, instructionHtml: LISTEN, items: speech.locale },
      );
  }

  return {
    lesson: {
      format: 1,
      key,
      unit,
      order,
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
      const built = buildLesson(src, key, unit, order++, index);
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
    courseUnits.push({ key: unit, order: u + 1, lessons });
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
