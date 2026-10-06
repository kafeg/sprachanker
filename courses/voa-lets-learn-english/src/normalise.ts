// Normalisation (offline, deterministic): parsed pages + media.json → canonical/ and locale/ files.
// A landing page is a course; the source's lesson groups (Level 1: "Lessons 1 - 10"; Level 2: five lessons
// and their review) are units. An article becomes a lesson: main video, conversation audio and transcript,
// practice videos and the listening quiz as exercises, new words (bold in the transcript) as vocabulary,
// lesson plans and certificates as downloads.
import {
  type ExerciseDraft,
  type LibraryFile,
  type MediaIndex,
  type MediaRef,
  mediaPath,
  plainText,
  sanitizeCourseHtml,
  withFingerprint,
} from "@sprachanker/course-kit";
import {
  CourseIndex,
  courseKey,
  type Exercise,
  type ExerciseKey,
  exerciseKey,
  itemKey,
  Lesson,
  type LessonKey,
  LocaleCourse,
  type LocaleExercise,
  LocaleLesson,
  lemmaSlug,
  lessonKey,
  lexemeKey,
  type PartOfSpeech,
  parseLessonKey,
  unitKey,
  type VocabEntry,
  vocabKey,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, type CourseDef, EDITION, SERIES } from "./catalog.ts";
import type {
  Landing,
  LandingLesson,
  LessonPage,
  Player,
  QuizEmbed,
  QuizQuestion,
} from "./parse.ts";

/** A lesson as fetched: its landing entry, raw page path, parsed page, document PDFs and quiz pages. */
export interface FetchedLesson {
  source: LandingLesson;
  /** Raw page, relative to the series folder. */
  raw: string;
  page: LessonPage;
  /** PDF of each embedded document article, by its id (undefined: page without a PDF). */
  docPdfs: Record<string, string | undefined>;
  /** Questions of each quiz, by quiz id, in order (empty: quiz pages not available). */
  quizzes: Record<string, QuizQuestion[]>;
}

export interface FetchedCourse {
  def: CourseDef;
  /** Source id of the landing page. */
  sourceId: string;
  landing: Landing;
  lessons: FetchedLesson[];
}

// --- media choice ------------------------------------------------------------------------------

const videos = (p: Player | undefined) =>
  (p?.renditions ?? []).filter((r) => r.height !== undefined) as { url: string; height: number }[];

/** The small rendition: 360p, else the smallest of at least 270p, else the largest there is. */
export function sdUrl(player: Player | undefined): string | undefined {
  const all = videos(player).sort((a, b) => a.height - b.height);
  return (all.find((r) => r.height === 360) ?? all.find((r) => r.height >= 270) ?? all.at(-1))?.url;
}

/** The 720p rendition, if offered. */
export const hdUrl = (player: Player | undefined) =>
  videos(player).find((r) => r.height === 720)?.url;

/** 64 kbps MP3, else the lowest bit rate offered. */
export function audioUrl(player: Player | undefined): string | undefined {
  const all = (player?.renditions ?? [])
    .filter((r) => r.kbps !== undefined)
    .sort((a, b) => (a.kbps ?? 0) - (b.kbps ?? 0));
  return (all.find((r) => r.kbps === 64) ?? all[0])?.url;
}

// --- vocabulary ----------------------------------------------------------------------------------

export interface Headword {
  lemma: string;
  pos: PartOfSpeech;
}

/** Part of speech by shape (the site gives none): "to …" a verb, several words a phrase. */
export function headword(text: string): Headword {
  if (/^to \p{L}/u.test(text)) return { lemma: text, pos: "verb" };
  return { lemma: text, pos: /\s/.test(text) ? "phrase" : "word" };
}

const EDGE = /^[\s"“”'‘’([—–-]+|[\s"“”'‘’)\].,!?;:—–-]+$/g;

/**
 * New words of a transcript: its bold words in order, punctuation trimmed, each once. Speaker labels
 * ("Anna:") and lines that are bold as a whole (sub-headings) are not words.
 */
export function boldWords(html: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  const joined = html.replace(/<\/(strong|b)><(strong|b)>/gi, "");
  for (const block of joined.split(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/td>/i)) {
    const line = plainText(block);
    for (const m of block.matchAll(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const raw = plainText(m[2]);
      const word = raw.replace(EDGE, "");
      if (!word || word.length < 2 || raw.endsWith(":") || raw === line) continue;
      const slug = lemmaSlug(word);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      words.push(word);
    }
  }
  return words.filter((w) => !inflectionOf(w, words));
}

/**
 * Whether `word` is a regular inflection of another bold word of the lesson ("parks" with "park",
 * "watching" with "watch", "danced" with "dance"): the base form stays, the duplicate goes.
 */
export function inflectionOf(word: string, words: string[]): boolean {
  const w = word.toLowerCase();
  return words.some((other) => {
    const b = other.toLowerCase();
    if (b === w || /\s/.test(b)) return false;
    const stem = b.endsWith("e") ? b.slice(0, -1) : b;
    const doubled = b + b.at(-1);
    return [
      `${b}s`,
      `${b}es`,
      `${b}d`,
      `${b}ed`,
      `${b}ing`,
      `${stem}ing`,
      `${doubled}ed`,
      `${doubled}ing`,
      ...(b.endsWith("y") ? [`${b.slice(0, -1)}ies`, `${b.slice(0, -1)}ied`] : []),
    ].includes(w);
  });
}

// --- lesson plan (what each section becomes) ------------------------------------------------------

interface SpeechPlan {
  kind: "speech";
  sourceId: string;
  title: string;
  instructionHtml: string;
  video?: string;
}

interface QuizPlan {
  kind: "quiz";
  embed: QuizEmbed;
  title: string;
  instructionHtml: string;
  questions: QuizQuestion[];
}

export interface LessonPlan {
  video: { sd?: string; hd?: string };
  audio?: string;
  exercises: (SpeechPlan | QuizPlan)[];
  script?: { title: string; bodyHtml: string };
  grammar: { title: string; bodyHtml: string }[];
  culture: { title: string; bodyHtml: string }[];
  downloads: { title: string; url: string }[];
  words: string[];
  unmapped: string[];
}

/** Course HTML of a section's text: "write to us" paragraphs dropped, lines kept, no links or images. */
export function courseHtml(html: string): string {
  const cleaned = html
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?mailto:(?:(?!<\/p>)[\s\S])*<\/p>/gi, "")
    .replace(/<p\b[^>]*>[\s_ ]*<\/p>/gi, "")
    .replace(/<h[3-6]\b[^>]*>/gi, "<p><strong>")
    .replace(/<\/h[3-6]>/gi, "</strong></p>")
    .replace(/<div\b[^>]*>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>");
  const out = sanitizeCourseHtml(cleaned, { image: () => undefined });
  return plainText(out) ? out.replace(/\n\s*\n+/g, "\n") : "";
}

const isWordBook = (text: string) => /word book/i.test(text);

/** What every section of the article becomes (source order); pure, so the import and tests share it. */
export function planLesson(lesson: FetchedLesson): LessonPlan {
  const { page } = lesson;
  const plan: LessonPlan = {
    video: { sd: sdUrl(page.video), hd: hdUrl(page.video) },
    exercises: [],
    grammar: [],
    culture: [],
    downloads: [],
    words: [],
    unmapped: [],
  };
  const download = (title: string, url: string | undefined) => {
    if (url && !plan.downloads.some((d) => d.url.toLowerCase() === url.toLowerCase())) {
      plan.downloads.push({ title, url });
    }
  };
  for (const section of page.sections) {
    const h = section.heading.toLowerCase();
    const text = courseHtml(section.html);
    for (const doc of section.docs) {
      const pdf = lesson.docPdfs[doc.id];
      if (pdf) download(doc.caption || section.heading || page.title, pdf);
      else plan.unmapped.push(`document ${doc.url}: no PDF on its page`);
    }
    for (const link of section.pdfs) {
      if (isWordBook(link.text)) continue; // the site-wide dictionary, not lesson material
      download(
        /lesson plan/i.test(link.text) ? "Lesson plan" : section.heading || link.text,
        link.url,
      );
    }
    if (section.external) {
      plan.unmapped.push(
        `section "${section.heading}": embedded media of another site not imported`,
      );
    }
    // Players: practice videos (under their heading, or titled so anywhere), the conversation audio.
    const practice = /^(speaking|pronunciation)/.test(h);
    const conversation = /^conversation/.test(h);
    for (const player of section.players) {
      if (player.kind === "video" && (practice || /speaking|pronunciation/i.test(player.title))) {
        plan.exercises.push({
          kind: "speech",
          sourceId: player.id ?? player.title,
          title: practice ? section.heading : player.title,
          instructionHtml: practice ? text : "",
          video: sdUrl(player),
        });
      } else if (player.kind === "audio" && conversation && !plan.audio && audioUrl(player)) {
        plan.audio = audioUrl(player);
      } else {
        plan.unmapped.push(
          `section "${section.heading}": ${player.kind} "${player.title}" not imported (lessons have one video)`,
        );
      }
    }
    // The quiz may share a section with the conversation (Level 1 has no heading of its own for it).
    for (const embed of section.quizzes) {
      plan.exercises.push({
        kind: "quiz",
        embed,
        title: embed.title || section.heading,
        instructionHtml: conversation ? "" : text,
        questions: lesson.quizzes[embed.id] ?? [],
      });
    }
    if (conversation) {
      if (text) plan.script = { title: section.heading, bodyHtml: text };
      plan.words = boldWords(section.html);
    } else if (/^review of lessons/.test(h)) {
      if (text) plan.grammar.push({ title: section.heading, bodyHtml: text });
    } else if (
      text &&
      !practice &&
      !section.quizzes.length &&
      // Boilerplate around the documents and PDFs taken above.
      !/^(comments|free materials|for teachers|download lesson|certificate)/.test(h)
    ) {
      plan.culture.push({ title: section.heading || page.title, bodyHtml: text });
    }
  }
  return plan;
}

const fileName = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "media");

/** Every media file a course needs: lesson videos and audio, practice videos, quiz clips, PDFs. */
export function mediaRefs(course: FetchedCourse): MediaRef[] {
  const refs: MediaRef[] = [];
  const add = (url: string | undefined, kind: MediaRef["kind"]) => {
    if (url && !refs.some((r) => r.url === url)) refs.push({ url, kind, name: fileName(url) });
  };
  for (const lesson of course.lessons) {
    const plan = planLesson(lesson);
    add(plan.video.sd, "video");
    add(plan.video.hd, "video");
    add(plan.audio, "audio");
    for (const ex of plan.exercises) {
      if (ex.kind === "speech") add(ex.video, "video");
      else for (const q of ex.questions) add(sdUrl(q.video), "video");
    }
    for (const d of plan.downloads) add(d.url, "pdf");
  }
  return refs;
}

// --- units ----------------------------------------------------------------------------------------

const lessonNumber = (title: string) => Number(/^Lesson (\d+)\b/.exec(title)?.[1] ?? Number.NaN);
const reviewRange = (title: string) => /^Review of\b.*?(\d+)\s*-+\s*(\d+)/.exec(title);

/**
 * Lessons grouped as the source groups them: by the landing's ranges ("Lessons 1 - 10") when it lists
 * them, else each review closes a group. A lesson outside every range joins the group before it.
 */
export function groupUnits<L extends { source: LandingLesson }>(
  lessons: L[],
  ranges: [number, number][],
): { title: string; lessons: L[] }[] {
  const groups: L[][] = [];
  if (ranges.length) {
    for (const lesson of lessons) {
      const n = lessonNumber(lesson.source.title);
      const i = ranges.findIndex(([a, b]) => n >= a && n <= b);
      const at = i >= 0 ? i : Math.max(groups.length - 1, 0);
      const group = groups[at] ?? [];
      groups[at] = group;
      group.push(lesson);
    }
  } else {
    let current: L[] = [];
    for (const lesson of lessons) {
      current.push(lesson);
      if (reviewRange(lesson.source.title)) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
  }
  return groups.filter(Boolean).map((group) => {
    const numbers = group.map((l) => lessonNumber(l.source.title)).filter((n) => !Number.isNaN(n));
    const title = numbers.length
      ? `Lessons ${Math.min(...numbers)}–${Math.max(...numbers)}`
      : (group[0]?.source.title ?? "");
    return { title, lessons: group };
  });
}

// --- files ----------------------------------------------------------------------------------------

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const optionId = (i: number) => String.fromCharCode(97 + i);

interface Normalised {
  exercise: Exercise;
  locale: LocaleExercise;
  unknown: boolean;
}

function unknownExercise(
  key: ExerciseKey,
  raw: string,
  reason: string,
  locale: LocaleExercise,
): Normalised {
  const items = [{ key: itemKey(key, 1), raw, reason }];
  return {
    exercise: withFingerprint({ key, type: "unknown", newWords: [], ruleIds: [], items }),
    locale,
    unknown: true,
  };
}

function normaliseExercise(
  ex: SpeechPlan | QuizPlan,
  key: ExerciseKey,
  raw: string,
  index: MediaIndex,
): Normalised {
  const locale: LocaleExercise = {
    sourceId: ex.kind === "quiz" ? ex.embed.id : ex.sourceId,
    title: ex.title,
    ...(ex.instructionHtml ? { instructionHtml: ex.instructionHtml } : {}),
    items: {},
  };
  if (ex.kind === "speech") {
    const video = mediaPath(index, ex.video);
    if (!video) return unknownExercise(key, raw, "practice video not downloaded", locale);
    return {
      exercise: withFingerprint({
        key,
        type: "speech_selfrate",
        newWords: [],
        ruleIds: [],
        // The video is the item's stimulus: an item with media and no text is "listen and repeat".
        items: [{ key: itemKey(key, 1), media: { video } }],
      }),
      locale,
      unknown: false,
    };
  }
  if (!ex.questions.length) return unknownExercise(key, raw, "quiz pages not available", locale);
  const total = ex.questions[0]?.total ?? 0;
  if (ex.questions.length !== total) {
    return unknownExercise(
      key,
      raw,
      `quiz incomplete: ${ex.questions.length} of ${total} questions`,
      locale,
    );
  }
  const unanswered = ex.questions.find((q) => !q.options.some((o) => o.correct));
  if (unanswered) {
    return unknownExercise(key, raw, `quiz question ${unanswered.index}: no answer marked`, locale);
  }
  const multiple = ex.questions.some(
    (q) => q.multiple || q.options.filter((o) => o.correct).length > 1,
  );
  const items = ex.questions.map((q, i) => {
    const video = mediaPath(index, sdUrl(q.video));
    return {
      key: itemKey(key, i + 1),
      prompt: q.question,
      ...(video ? { media: { video } } : {}),
      options: q.options.map((o, j) => ({ id: optionId(j), text: o.text })),
      answer: {
        optionIds: q.options.flatMap((o, j) => (o.correct ? [optionId(j)] : [])),
      },
    };
  });
  const draft = {
    key,
    type: multiple ? "multi_choice" : "single_choice",
    newWords: [],
    ruleIds: [],
    items,
  } as ExerciseDraft;
  return { exercise: withFingerprint(draft), locale, unknown: false };
}

export interface CourseResult {
  files: LibraryFile[];
  lessons: number;
  unknown: number;
  /** Source content not imported, for the report. */
  unmapped: string[];
}

export function normaliseCourse(course: FetchedCourse, index: MediaIndex): CourseResult {
  const media = (url: string | undefined) => mediaPath(index, url);
  const key = courseKey(SERIES, course.def.id);
  const files: LibraryFile[] = [];
  const units: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  const unmappedAll: string[] = [];
  let order = 0;
  let unknown = 0;
  const groups = groupUnits(course.lessons, course.landing.ranges);
  for (const [u, group] of groups.entries()) {
    const unit = unitKey(key, u + 1);
    unitTitles[unit] = { title: group.title };
    const lessons: LessonKey[] = [];
    for (const [l, lesson] of group.lessons.entries()) {
      const lk = lessonKey(key, u + 1, l + 1);
      lessons.push(lk);
      const plan = planLesson(lesson);
      const pages: Lesson["pages"] = [];
      const exercises: LocaleLesson["exercises"] = {};
      for (const [i, ex] of plan.exercises.entries()) {
        const n = normaliseExercise(ex, exerciseKey(lk, i + 1), lesson.raw, index);
        pages.push({ exercise: n.exercise });
        exercises[n.exercise.key] = n.locale;
        if (n.unknown) unknown++;
      }
      const vocab: VocabEntry[] = plan.words.flatMap((word) => {
        const h = headword(word);
        return lemmaSlug(h.lemma)
          ? [{ key: vocabKey(lk, h.lemma), lexeme: lexemeKey("en", h.lemma, h.pos), target: word }]
          : [];
      });
      const sd = media(plan.video.sd);
      const hd = media(plan.video.hd);
      const audio = media(plan.audio);
      const unmapped = plan.unmapped.map((reason) => ({ path: lesson.raw, reason }));
      unmappedAll.push(...plan.unmapped.map((r) => `${lk}: ${r}`));
      const { name } = parseLessonKey(lk);
      files.push({
        path: `canonical/${course.def.id}/lessons/${name}.json`,
        schema: Lesson,
        value: {
          format: 1,
          key: lk,
          unit,
          order: order++,
          media: {
            ...(sd || hd ? { video: { ...(sd ? { sd } : {}), ...(hd ? { hd } : {}) } } : {}),
            ...(audio ? { audio } : {}),
          },
          goals: [],
          pages,
          vocab,
          unmapped,
        } satisfies Lesson,
      });
      const downloads = plan.downloads.flatMap((d) => {
        const path = media(d.url);
        return path ? [{ title: d.title, path }] : [];
      });
      const summary = lesson.page.summary;
      files.push({
        path: `locale/${EDITION}/${course.def.id}/lessons/${name}.json`,
        schema: LocaleLesson,
        value: {
          format: 1,
          edition: EDITION,
          lesson: lk,
          sourceId: lesson.source.id,
          title: lesson.page.title || lesson.source.title,
          ...(summary ? { synopsisHtml: `<p>${escapeHtml(summary)}</p>` } : {}),
          exercises,
          // en-en: the source gives no definitions on the page (they are in the lesson plan PDF).
          vocab: {},
          tabs: {
            grammar: plan.grammar,
            culture: plan.culture,
            ...(plan.script ? { script: plan.script } : {}),
          },
          downloads,
        } satisfies LocaleLesson,
      });
    }
    units.push({ key: unit, order: u + 1, lessons });
  }
  files.push({
    path: `canonical/${course.def.id}/course.json`,
    schema: CourseIndex,
    value: {
      format: 1,
      key,
      source: {
        publisher: "VOA Learning English (Voice of America)",
        url: "https://learningenglish.voanews.com/p/5644.html",
        licence: "public-domain",
      },
      units,
      exams: [],
      goals: [],
    } satisfies CourseIndex,
  });
  files.push({
    path: `locale/${EDITION}/${course.def.id}/course.json`,
    schema: LocaleCourse,
    value: {
      format: 1,
      edition: EDITION,
      course: key,
      sourceId: course.sourceId,
      title: course.def.title,
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    } satisfies LocaleCourse,
  });
  return { files, lessons: order, unknown, unmapped: unmappedAll };
}
