// Normalisation (offline, deterministic): parsed lesson articles + media.json → canonical/ and locale/
// files. Units of ten lessons by number (52а, 104а join the unit of 52, 104); per lesson the episode
// recording, the goal («Цель»), the synopsis («Содержание»), the dialogue as the script page, the word
// list as vocabulary (English canonical, Russian in the locale), homework and notes as pages (homework
// in its own tab). The source has no checkable exercises: its homework has no answers anywhere.
import {
  escapeHtml,
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
  type Lesson,
  type LessonKey,
  LOCALE_FORMAT,
  type LocaleCourse,
  lessonGoalKey,
  lessonKey,
  type MediaIndex,
  type PartOfSpeech,
  unitKey,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, COURSE, EDITION, SERIES, SOURCE, UNIT_SIZE } from "./catalog.ts";
import type { DialogueLine, ParsedLesson, WordRow } from "./parse.ts";

export interface SourceLesson {
  /** Lesson number as the source writes it ("12", "52а"). */
  label: string;
  /** Article id (the lesson's source id). */
  id: string;
  /** Raw page inside the series folder, for unmapped entries. */
  raw: string;
  /** Undefined when the article has no body. */
  parsed: ParsedLesson | undefined;
  audioUrl?: string;
  /** Why the article's text is not used (a known defect of the source). */
  textDefect?: string;
}

const PHRASE_HEADING = /phrase|greeting|idiom|question|expression|introduction/i;

/** Part of speech the word-list heading states ("Nouns (food)", "Verbs (used as nouns)"). */
function headingPos(category: string): PartOfSpeech | undefined {
  const used = /used as (?:an? )?(noun|adjective)/i.exec(category)?.[1]?.toLowerCase();
  if (used) return used === "noun" ? "noun" : "adj";
  if (/^nouns?\b/i.test(category)) return "noun";
  if (/^verbs?\b/i.test(category)) return "verb";
  if (/^adjectives?\b/i.test(category)) return "adj";
  return undefined;
}

/** "horse/horses", "child/children", "photographer/s": a plural, not a second word ("waiter/waitress"). */
function pluralOf(lemma: string, other: string): string | undefined {
  if (/^e?s$/.test(other)) return lemma + other;
  if (other === lemma) return other;
  return !other.includes(" ") && other.startsWith(lemma.slice(0, 3)) && /(?:[^s]s|en)$/.test(other)
    ? other
    : undefined;
}

/**
 * Lemma and part of speech of an English headword as the lesson lists it. The heading gives the part
 * of speech (Nouns, Verbs, Adjectives); otherwise by shape: "to …" is a verb, a sentence or several
 * words a phrase. Alternatives after "/" are forms ("to buy/bought", "sad/sadder/saddest") or the
 * plural ("horse/horses"). Parentheses are mostly glosses ("hot (spicy)", "to run (manage)") and stay
 * only in the headword.
 */
export function headword(en: string, category: string): Headword {
  const stated = headingPos(category);
  const bare = en.replace(/\s*\([^)]*\)\s*/g, " ").trim() || en.replace(/[()]/g, "").trim();
  if (!stated && (PHRASE_HEADING.test(category) || /[.!?]$/.test(bare))) {
    return { lemma: bare, pos: "phrase" };
  }
  // Alternatives: "dad, daddy", "box, bag, can" — the first is the lemma.
  const [first = bare, ...others] = bare.split(/\s*\/\s*/);
  let lemma = first.split(/\s*[,;]\s*/)[0]?.trim() || first;
  const shape = shapeHeadword("en", lemma);
  const pos: PartOfSpeech = stated ?? shape.pos;
  if (pos === "verb") lemma = lemma.replace(/^to\s+/i, "");
  const forms = pos === "noun" ? "" : others.map((o) => o.replace(/^to\s+/i, "")).join(", ");
  const plural =
    pos === "noun" && others.length === 1 ? pluralOf(lemma, others[0] ?? "") : undefined;
  return { lemma, pos, ...(plural ? { plural } : {}), ...(forms ? { forms } : {}) };
}

/** The dialogue as course HTML: one paragraph per line, the speaker in bold. */
export function scriptHtml(lines: DialogueLine[]): string {
  return lines
    .map((l) =>
      l.heading
        ? `<p><b>${escapeHtml(l.text)}</b></p>`
        : `<p>${l.speaker ? `<b>${escapeHtml(l.speaker)}:</b> ` : ""}${escapeHtml(l.text)}</p>`,
    )
    .join("");
}

/** Lesson number without the review suffix: "52а" → 52. */
const lessonNumber = (label: string) => Number.parseInt(label, 10);

function vocabulary(key: LessonKey, words: WordRow[]) {
  const { vocab, translations, skipped } = vocabEntries(
    key,
    "en",
    words.map((row) => ({
      head: headword(row.en, row.category),
      target: row.en,
      examples: row.examples.map((e) => e.en),
      translation: row.ru,
      // Same order as the canonical examples; an example without a Russian side stays empty.
      ...(row.examples.some((e) => e.ru)
        ? { exampleTranslations: row.examples.map((e) => e.ru ?? "") }
        : {}),
    })),
  );
  return { vocab, translations, skipped };
}

export interface Normalised {
  files: LibraryFile[];
  lessons: number;
  unmapped: number;
}

export function normaliseEnglishUsa(lessons: SourceLesson[], index: MediaIndex): Normalised {
  const course = courseKey(SERIES, COURSE);
  const files: LibraryFile[] = [];
  const byUnit = Map.groupBy(lessons, (l) => Math.ceil(lessonNumber(l.label) / UNIT_SIZE));
  const units: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  const goals: CourseIndex["goals"] = [];
  const goalTexts: LocaleCourse["goals"] = {};
  let unmapped = 0;
  for (const [u, members] of [...byUnit].sort(([a], [b]) => a - b)) {
    const unit = unitKey(course, u);
    const keys: LessonKey[] = [];
    unitTitles[unit] = { title: `Уроки ${members[0]?.label}–${members.at(-1)?.label}` };
    for (const [i, source] of members.entries()) {
      const key = lessonKey(course, u, i + 1);
      keys.push(key);
      const parsed = source.textDefect ? undefined : source.parsed;
      const lessonUnmapped: Lesson["unmapped"] = [];
      if (!parsed) {
        lessonUnmapped.push({
          path: source.raw,
          reason: source.textDefect ?? "the article has no lesson body",
        });
      }
      for (const line of parsed?.stray ?? []) {
        lessonUnmapped.push({
          path: source.raw,
          reason: `text outside the lesson's parts: ${line}`,
        });
      }
      const { vocab, translations, skipped } = vocabulary(key, parsed?.words ?? []);
      lessonUnmapped.push(...skippedWords(source.raw, skipped));
      unmapped += lessonUnmapped.length;
      const goal = parsed?.goal ? lessonGoalKey(key, 1) : undefined;
      if (goal && parsed) {
        goals.push({ key: goal, lessons: [key] });
        goalTexts[goal] = { text: parsed.goal };
      }
      const audio = mediaPath(index, source.audioUrl);
      files.push(
        libraryFile.lesson({
          format: CANONICAL_FORMAT,
          key,
          unit,
          media: audio ? { audio } : {},
          goals: goal ? [goal] : [],
          pages: [],
          vocab,
          unmapped: lessonUnmapped,
        }),
      );
      const tab = (kinds: string[]) =>
        (parsed?.pages ?? [])
          .filter((p) => kinds.includes(p.kind))
          .map((p) => ({ title: p.title, bodyHtml: p.html }));
      const homework = tab(["homework"]);
      files.push(
        libraryFile.localeLesson({
          format: LOCALE_FORMAT,
          edition: EDITION,
          lesson: key,
          sourceId: source.id,
          title: parsed?.title || `Урок английского языка №${source.label}`,
          ...(parsed?.synopsis ? { synopsisHtml: `<p>${escapeHtml(parsed.synopsis)}</p>` } : {}),
          exercises: {},
          vocab: translations,
          tabs: {
            grammar: tab(["grammar"]),
            culture: tab(["culture"]),
            // Tasks for the notebook and a partner: the source gives no answers to check.
            ...(homework.length ? { homework } : {}),
            ...(parsed?.dialogue.length
              ? { script: { bodyHtml: scriptHtml(parsed.dialogue) } }
              : {}),
          },
          downloads: [],
        }),
      );
    }
    units.push({ key: unit, lessons: keys });
  }
  files.push(
    libraryFile.course({
      format: CANONICAL_FORMAT,
      key: course,
      source: SOURCE,
      units,
      exams: [],
      goals,
    }),
  );
  files.push(
    libraryFile.localeCourse({
      format: LOCALE_FORMAT,
      edition: EDITION,
      course,
      sourceId: COURSE,
      title: "Так говорят в Америке (English USA)",
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: goalTexts,
    }),
  );
  return {
    files,
    lessons: files.filter((f) => /^canonical\/[^/]+\/lessons\//.test(f.path)).length,
    unmapped,
  };
}
