// Normalisation (offline, deterministic): parsed chapters + media.json → canonical/ and locale/ files.
// Chapters become units; each vocabulary section a lesson with its words (German → English) and its
// recording. The site has no interactive exercises (they are in the textbook PDF, kept as a download).
import {
  germanGender,
  type Headword,
  type LibraryFile,
  libraryFile,
  mediaPath,
  shapeHeadword,
  skippedWords,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  CANONICAL_FORMAT,
  type CourseIndex,
  courseKey,
  type LessonKey,
  LOCALE_FORMAT,
  type LocaleCourse,
  lessonKey,
  type MediaIndex,
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
    if (parens && /plural only|only plural/i.test(parens))
      return { lemma, pos: "noun", gender: "pl" };
    if (parens && /no plural/i.test(parens)) {
      return { lemma, pos: "noun", gender: germanGender(noun[1]), note: "nur Singular" };
    }
    const plural = parens?.replace(/^die /, "");
    return {
      lemma,
      pos: "noun",
      gender: germanGender(noun[1]),
      ...(plural && !plural.includes(",") ? { plural: `die ${plural}` } : {}),
    };
  }
  // The source states nothing more: by shape, as every provider (02).
  return shapeHeadword("de", head.replace(/[()]/g, ""));
}

/** The source's English remarks on a word ("no plural", "fig."): its fields say them (gender, note), so
 *  they leave the German text the learner reads (02, "Text language"). */
const REMARK = /\s*\((?:typically, )?(?:no plural|plural only|only plural|fig\.)\)/giu;

/** A row's German as the word reads, without the source's English remarks. */
export const germanOf = (de: string) => de.replace(REMARK, "").trim();

export const chapterPdfUrl = (pdf: string) => new URL(pdf, SITE).href;

export function normaliseDib(
  chapters: Chapter[],
  index: MediaIndex,
): { files: LibraryFile[]; lessons: number } {
  const media = (url: string | undefined) => mediaPath(index, url);
  const course = courseKey(SERIES, COURSE);
  const files: LibraryFile[] = [];
  let lessonCount = 0;
  const units: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  for (const chapter of chapters) {
    const unit = unitKey(course, chapter.k);
    const lessons: LessonKey[] = [];
    unitTitles[unit] = { title: chapter.title };
    const pdf = chapter.pdf ? media(chapterPdfUrl(chapter.pdf)) : undefined;
    for (const [i, section] of chapter.sections.entries()) {
      const key = lessonKey(course, chapter.k, section.n);
      lessons.push(key);
      lessonCount++;
      const { vocab, translations, skipped } = vocabEntries(
        key,
        "de",
        section.rows.map((row) => ({
          head: {
            ...headword(row.de),
            ...(/\(fig\.\)/i.test(row.de) ? { note: "fig." } : {}),
          },
          target: germanOf(row.de),
          translation: row.en,
        })),
      );
      const audio = media(section.audio);
      files.push(
        libraryFile.lesson({
          format: CANONICAL_FORMAT,
          key,
          unit,
          media: audio ? { audio } : {},
          goals: [],
          pages: [],
          vocab,
          unmapped: skippedWords(`raw/${EDITION}/${COURSE}/voc-${chapter.k}.html`, skipped),
        }),
      );
      files.push(
        libraryFile.localeLesson({
          format: LOCALE_FORMAT,
          edition: EDITION,
          lesson: key,
          sourceId: `${chapter.k}.${section.n}`,
          title: section.titleEn ? `${section.titleDe} · ${section.titleEn}` : section.titleDe,
          exercises: {},
          vocab: translations,
          tabs: { grammar: [], culture: [] },
          // The chapter's textbook (with its exercises) goes with the chapter's first lesson.
          downloads: i === 0 && pdf ? [{ title: `${chapter.title} (PDF)`, path: pdf }] : [],
        }),
      );
    }
    units.push({ key: unit, lessons });
  }
  files.push(
    libraryFile.course({
      format: CANONICAL_FORMAT,
      key: course,
      source: SOURCE,
      units,
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
      title: "Deutsch im Blick",
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    }),
  );
  return { files, lessons: lessonCount };
}
