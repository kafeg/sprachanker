// Normalisation (offline, deterministic): parsed chapters + media.json → canonical/ and locale/ files.
// Chapters become units; each vocabulary section a lesson with its words (German → English) and its
// recording. The site has no interactive exercises (they are in the textbook PDF, kept as a download).
import {
  type Headword,
  type LibraryFile,
  type MediaIndex,
  mediaPath,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  CourseIndex,
  courseKey,
  type Gender,
  Lesson,
  type LessonKey,
  LocaleCourse,
  LocaleLesson,
  lessonKey,
  parseLessonKey,
  unitKey,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, COURSE, EDITION, SERIES, SITE, SOURCE } from "./catalog.ts";
import type { VocabSection } from "./parse.ts";

export interface Chapter {
  /** 1-based chapter number. */
  k: number;
  title: string;
  /** Textbook PDF, relative to the site. */
  pdf?: string;
  sections: VocabSection[];
}

const ARTICLES: Record<string, Gender> = { der: "m", die: "f", das: "n" };

/**
 * Part of speech, gender and plural from a headword as the book writes it: "der Apfel (Äpfel)",
 * "die Butter (no plural)", "die Nudeln (plural only)", "sich anziehen", "Notizen machen". Only the
 * first of alternatives ("die Schminke / das Make-up") gives the lemma.
 */
export function headword(de: string): Headword {
  const first = de.split(" / ")[0]?.trim() ?? de;
  const parens = /\(([^)]*)\)\s*$/.exec(first)?.[1]?.trim();
  const head =
    first
      .replace(/\s*\([^)]*\)\s*$/, "")
      .split(",")[0]
      ?.trim() ?? first;
  const noun = /^(der|die|das) (\S+)$/.exec(head);
  if (noun) {
    const lemma = noun[2] ?? "";
    if (parens && /plural only/i.test(parens)) return { lemma, pos: "noun", gender: "pl" };
    if (parens && /no plural/i.test(parens)) {
      return { lemma, pos: "noun", gender: ARTICLES[noun[1] ?? ""], note: "nur Singular" };
    }
    const plural = parens?.replace(/^die /, "");
    return {
      lemma,
      pos: "noun",
      gender: ARTICLES[noun[1] ?? ""],
      ...(plural && !plural.includes(",") ? { plural: `die ${plural}` } : {}),
    };
  }
  const plain = head.replace(/[()]/g, "");
  if (/[.!?]$/.test(plain) || plain.split(" ").length > 2) return { lemma: plain, pos: "phrase" };
  if (/^(sich )?[a-zäöüß]{2,}(?:e|er|el)n$/.test(plain)) return { lemma: plain, pos: "verb" };
  return { lemma: plain, pos: plain.includes(" ") ? "phrase" : "word" };
}

export const chapterPdfUrl = (pdf: string) => new URL(pdf, SITE).href;

export function normaliseDib(chapters: Chapter[], index: MediaIndex): LibraryFile[] {
  const media = (url: string | undefined) => mediaPath(index, url);
  const course = courseKey(SERIES, COURSE);
  const files: LibraryFile[] = [];
  const units: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  let order = 0;
  for (const chapter of chapters) {
    const unit = unitKey(course, chapter.k);
    const lessons: LessonKey[] = [];
    unitTitles[unit] = { title: chapter.title };
    const pdf = chapter.pdf ? media(chapterPdfUrl(chapter.pdf)) : undefined;
    for (const [i, section] of chapter.sections.entries()) {
      const key = lessonKey(course, chapter.k, section.n);
      lessons.push(key);
      const { vocab, translations } = vocabEntries(
        key,
        "de",
        section.rows.map((row) => ({
          head: headword(row.de),
          target: row.de,
          translation: row.en,
        })),
      );
      const audio = media(section.audio);
      const { name } = parseLessonKey(key);
      files.push({
        path: `canonical/${COURSE}/lessons/${name}.json`,
        schema: Lesson,
        value: {
          format: 1,
          key,
          unit,
          order: order++,
          media: audio ? { audio } : {},
          goals: [],
          pages: [],
          vocab,
          unmapped: [],
        } satisfies Lesson,
      });
      files.push({
        path: `locale/${EDITION}/${COURSE}/lessons/${name}.json`,
        schema: LocaleLesson,
        value: {
          format: 1,
          edition: EDITION,
          lesson: key,
          sourceId: `${chapter.k}.${section.n}`,
          title: section.titleEn ? `${section.titleDe} · ${section.titleEn}` : section.titleDe,
          exercises: {},
          vocab: translations,
          tabs: { grammar: [], culture: [] },
          // The chapter's textbook (with its exercises) goes with the chapter's first lesson.
          downloads:
            i === 0 && pdf ? [{ title: `Kapitel ${chapter.k} — textbook (PDF)`, path: pdf }] : [],
        } satisfies LocaleLesson,
      });
    }
    units.push({ key: unit, order: chapter.k, lessons });
  }
  files.push({
    path: `canonical/${COURSE}/course.json`,
    schema: CourseIndex,
    value: {
      format: 1,
      key: course,
      source: SOURCE,
      units,
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
      title: "Deutsch im Blick",
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    } satisfies LocaleCourse,
  });
  return files;
}
