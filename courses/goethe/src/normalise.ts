// A level's model test normalised (03): each module page read into Teile (page.ts, teile.ts) and
// written as the exam's module of sections — a Teil each, with its instructions, its text, picture or
// recording, how often it plays, its examples — and its questions as single-choice items whose right
// option comes from the Teil's solution page. Pure: the pages, the pictures' texts and the media files
// are given.
import { escapeHtml, type LibraryFile, libraryFile } from "@sprachanker/course-kit";
import {
  type CourseIndex,
  type EditionId,
  type Exam,
  type ExamItem,
  type ExamItemKey,
  type ExamSectionKey,
  examItemKey,
  examSectionKey,
  type LocaleCourse,
  type LocaleExam,
  type Media,
  type MediaPath,
} from "@sprachanker/schema";
import {
  courseOf,
  EDITION,
  examOf,
  type Level,
  levelUrl,
  type ModuleId,
  sourceOf,
} from "./catalog.ts";
import { type Choice, type Picture, readPage } from "./page.ts";
import { readSolutions, type Solution } from "./solutions.ts";
import { type Module, type Question, readModule, type Teil } from "./teile.ts";

export interface LevelPages {
  /** Each module's page as fetched. */
  modules: Array<{ id: ModuleId; html: string }>;
  /** A Teil's solution page by its file name ("hoeren_l1.php"). */
  solution(file: string): string | undefined;
  /** A picture's text by its page's address. */
  longdesc(url: string): string | undefined;
  /** A medium's file in the library by its address. */
  media(url: string): MediaPath | undefined;
}

export const MODULE_TITLES: Record<ModuleId, string> = { hoeren: "Hören", lesen: "Lesen" };

export const pageUrl = (level: Level, module: ModuleId) => `${levelUrl(level)}${module}.php`;
/** An address on a page made absolute. */
export const absolute = (href: string, base: string) => new URL(href.trim(), base).href;

/** A module page read: its Teile. */
export const moduleOf = (html: string): Module => readModule(readPage(html));

/** What a module page refers to that the import fetches: its media and the pictures' text pages. */
export function referencesOf(module: Module, base: string) {
  const media = new Set<string>();
  const texts = new Set<string>();
  const picture = (p: Picture | undefined) => {
    if (!p) return;
    media.add(absolute(p.src, base));
    if (p.longdesc) texts.add(absolute(p.longdesc, base));
  };
  for (const t of module.teile) {
    if (t.audio) media.add(absolute(t.audio, base));
    t.pictures.forEach(picture);
    for (const l of t.letters) picture(l.picture);
    for (const q of t.questions) {
      if (q.audio) media.add(absolute(q.audio, base));
      q.pictures.forEach(picture);
      for (const c of q.choices) picture(c.picture);
      for (const link of q.links) texts.add(absolute(link, base));
    }
  }
  return { media: [...media], texts: [...texts] };
}

/** The minutes a line states ("Reguläre Prüfungszeit: circa 20 Minuten"). */
const minutesIn = (line: string) =>
  Number(/Prüfungszeit[^:]*:\s*(?:circa\s*)?(\d+)\s*Minuten/i.exec(line)?.[1] ?? Number.NaN);
/** "Prüfungszeit für nicht behinderte Kandidatinnen und Kandidaten: 10 Minuten" said plainly. */
const plainTime = (line: string) =>
  line.replace(/^(Reguläre\s+)?Prüfungszeit[^:]*:/i, "Prüfungszeit:");
/** How often the Teil's recordings play, as its instructions say ("Sie hören jeden Text zweimal"). */
const playsIn = (lines: string[]) => {
  const text = lines.join(" ");
  if (/\bzweimal\b/i.test(text)) return 2;
  if (/\beinmal\b/i.test(text)) return 1;
  return undefined;
};
/** The letter written when no ad fits ("Schreiben Sie hier den Buchstaben X", "… markieren Sie 0"). */
const noneIn = (lines: string[], solutions: Solution[], letters: string[]) => {
  const said = /(?:Buchstaben|markieren Sie|schreiben Sie|wählen Sie)\s+(X|0)\b/i.exec(
    lines.join(" "),
  )?.[1];
  if (said) return said;
  return solutions
    .flatMap((s) => s.answers)
    .map((a) => a.trim())
    .find((a) => a.length === 1 && !letters.includes(a.toLowerCase()));
};

/** An answer as compared: lower case, without a final full stop, "Bild c" as "c". */
const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/^bild\s+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The option an answer names: its letter, its text, or its letter and text ("c sollen …"). */
export function optionFor(
  answer: string,
  options: Array<{ id: string; text?: string }>,
): string | undefined {
  const want = comparable(answer);
  const byText = options.find((o) => o.text !== undefined && comparable(o.text) === want);
  if (byText) return byText.id;
  if (want.length === 1)
    return options.find((o) => o.id === want || comparable(o.text ?? "") === want)?.id;
  const letter = /^([a-j])\s/.exec(want)?.[1];
  if (letter) return options.find((o) => o.id === letter)?.id;
  return undefined;
}

export interface Normalised {
  files: LibraryFile[];
  questions: number;
  leftOut: number;
  problems: string[];
}

export function normaliseLevel(level: Level, pages: LevelPages): Normalised {
  const exam = examOf(level);
  const problems: string[] = [];
  const items: ExamItem[] = [];
  const sections: Exam["sections"] = [];
  const localeSections: LocaleExam["sections"] = {};
  const alt: Record<string, Record<string, string>> = {};
  const modules: NonNullable<Exam["modules"]> = [];
  let leftOut = 0;

  for (const { id: module, html } of pages.modules) {
    const base = pageUrl(level, module);
    const read = moduleOf(html);
    const media = (href: string | undefined): MediaPath | undefined =>
      href ? pages.media(absolute(href, base)) : undefined;
    const textOf = (href: string) => pages.longdesc(absolute(href, base));
    const minutes =
      read.intro.map(minutesIn).find((m) => !Number.isNaN(m)) ??
      read.teile
        .flatMap((t) =>
          t.instructions
            .map(minutesIn)
            .filter((m) => !Number.isNaN(m))
            .slice(0, 1),
        )
        .reduce((a, b) => a + b, 0);
    if (!minutes) problems.push(`${level.course} ${module}: no time stated`);
    modules.push({ id: module, timeLimitSec: minutes * 60, scaleTo: level.scaleTo });

    let number = 0;
    const seen = new Map<string, number>();
    for (const teil of read.teile) {
      // "Teil 2 Text 1" and "Teil 2 Text 2" are sections of their own (each its text).
      const count = (seen.get(String(teil.number)) ?? 0) + 1;
      seen.set(String(teil.number), count);
      const slug = `${module}-${teil.number}${/Text\s*\d/i.test(teil.title) ? `-${count}` : ""}`;
      const sectionKey = examSectionKey(exam, slug) as ExamSectionKey;
      const file = teil.form?.action.split("#")[0] ?? "";
      const solutions = readSolutions(pages.solution(file) ?? "");
      if (!solutions.length)
        problems.push(`${level.course} ${slug}: no solutions (${file || "no form"})`);
      const scored = teil.questions.filter((q) => !q.example);
      const firstNumber = number + 1;
      const numbered = scored.map((q) => {
        number++;
        if (q.number !== undefined && q.number !== number)
          problems.push(`${level.course} ${slug}: question ${q.number} at place ${number}`);
        return { q, number };
      });
      // By number; a page numbering its own Teil from 1 (A1 Lesen 3) by order.
      const byNumber = numbered.every(({ number: n }) => solutions.some((s) => s.number === n));
      const solutionOf = (n: number) =>
        byNumber ? solutions.find((s) => s.number === n) : solutions[n - firstNumber];
      const plays = module === "hoeren" ? playsIn(teil.instructions) : undefined;
      const letters = teil.letters.map((l) => l.letter);
      const none = letters.length ? noneIn(teil.instructions, solutions, letters) : undefined;

      const build = (
        q: Question,
        key: ExamItemKey,
        solution: Solution | undefined,
      ): ExamItem | undefined => {
        const options = optionsOf(q, teil, none, media);
        const right = q.example
          ? exampleOption(q, options)
          : solution?.answers.map((a) => optionFor(a, options)).find(Boolean);
        if (!right) {
          problems.push(
            `${level.course} ${slug}: ${key.split("/q-")[1]} — no option for ${JSON.stringify(solution?.answers ?? q.typed?.value)}`,
          );
          return undefined;
        }
        // A picture's text page, linked from the question and named by the picture: read once.
        const pagesOfText = new Set(
          [...q.links, ...q.pictures.flatMap((p) => (p.longdesc ? [p.longdesc] : []))].map((h) =>
            absolute(h, base),
          ),
        );
        const texts = [
          ...(q.legend && q.heading ? [q.heading] : []),
          ...q.texts,
          ...[...pagesOfText].flatMap((url) => pages.longdesc(url) ?? []),
        ];
        const pictures =
          q.choices.some((c) => c.picture) || q.pictures.length !== q.choices.length
            ? q.pictures
            : [];
        const image = media(pictures[0]?.src);
        const audio = media(q.audio);
        const own: Media | undefined =
          image || audio ? { ...(image && { image }), ...(audio && { audio }) } : undefined;
        if (pictures.length > 1)
          problems.push(`${level.course} ${slug}: ${pictures.length} pictures for one question`);
        const pictureAlts = Object.fromEntries(
          optionPictures(q).flatMap((p, i) => (p?.alt ? [[options[i]?.id ?? "", p.alt]] : [])),
        );
        if (Object.keys(pictureAlts).length) alt[key] = pictureAlts;
        return {
          key,
          type: "single_choice",
          tags: {},
          prompt: q.legend || q.heading || q.line || "",
          ...(texts.length && { text: texts.join("\n\n") }),
          ...(own && { media: own }),
          options,
          answer: { optionIds: [right] },
        } as ExamItem;
      };

      const pool: ExamItemKey[] = [];
      for (const { q, number: n } of numbered) {
        const key = examItemKey(exam, `${module}-${n}`);
        const item = build(q, key, solutionOf(n));
        if (item) {
          items.push(item);
          pool.push(key);
        } else leftOut++;
      }
      const examples: ExamItemKey[] = [];
      teil.questions
        .filter((q) => q.example)
        .forEach((q, i) => {
          const key = examItemKey(exam, `${slug}-bsp${i + 1}`);
          const item = build(q, key, undefined);
          if (item) {
            items.push(item);
            examples.push(key);
          }
        });
      if (!pool.length) {
        problems.push(`${level.course} ${slug}: no question left`);
        continue;
      }
      const text = [
        ...teil.texts,
        ...teil.letters
          .filter((l) => l.texts.length || l.picture?.longdesc)
          .map((l) => {
            const own = l.picture?.longdesc ? textOf(l.picture.longdesc) : undefined;
            return `${l.letter}\n${[...l.texts, ...(own ? [own] : [])].join("\n")}`;
          }),
      ].join("\n\n");
      const teilAudio = media(teil.audio);
      const teilImage = media(teil.pictures[0]?.src);
      if (teil.pictures.length > 1)
        problems.push(`${level.course} ${slug}: ${teil.pictures.length} pictures for one Teil`);
      sections.push({
        key: sectionKey,
        module,
        pool,
        draw: pool.length,
        filter: null,
        ...(text && { text }),
        ...((teilAudio || teilImage) && {
          media: { ...(teilAudio && { audio: teilAudio }), ...(teilImage && { image: teilImage }) },
        }),
        ...(plays !== undefined && { plays }),
        ...(examples.length && { examples }),
      });
      localeSections[sectionKey] = {
        title: teil.title,
        instructions: teil.instructions.map(plainTime).join("\n"),
      };
    }
  }

  const together = modules.reduce((n, m) => n + m.timeLimitSec, 0);
  const all = modules.map((m) => m.id as ModuleId);
  const thresholds: Exam["thresholds"] = level.apart
    ? modules.map((m) => ({ id: m.id, minPoints: 0.6 * level.scaleTo, modules: [m.id] }))
    : [{ id: "pass", minPoints: 0.6 * level.scaleTo * modules.length }];
  const examFile: Exam = {
    format: 1,
    key: exam,
    timeLimitSec: together,
    modules,
    sections,
    items,
    thresholds,
    ...(level.apart && { passWhen: "all" as const }),
  };
  const titles = Object.fromEntries(all.map((m) => [m, { title: MODULE_TITLES[m] }]));
  const localeExam: LocaleExam = {
    format: 1,
    edition: EDITION as EditionId,
    exam,
    title: `${level.title} — Modellsatz`,
    modules: titles,
    sections: localeSections,
    thresholds: Object.fromEntries(
      thresholds.map((t) => [
        t.id,
        {
          title: level.apart
            ? `${MODULE_TITLES[t.id as ModuleId]}: bestanden (60 von 100)`
            : `Bestanden: 60 Prozent der Punkte`,
        },
      ]),
    ),
    items: Object.fromEntries(
      items.map((i) => [i.key, alt[i.key] ? { alt: alt[i.key] } : {}]),
    ) as LocaleExam["items"],
  };
  const course = courseOf(level);
  const index: CourseIndex = {
    format: 1,
    key: course,
    source: sourceOf(level),
    units: [],
    exams: [exam],
    goals: [],
  };
  const localeCourse: LocaleCourse = {
    format: 1,
    edition: EDITION as EditionId,
    course,
    sourceId: level.dir,
    title: level.title,
    descriptionHtml: `<p>${escapeHtml(
      `Der Modellsatz in der barrierefreien Fassung des Goethe-Instituts: ${all
        .map((m) => MODULE_TITLES[m])
        .join(" und ")}, mit allen Aufnahmen, Bildern und Lösungen.`,
    )}</p>`,
    units: {},
    goals: {},
  };
  return {
    files: [
      libraryFile.course(index),
      libraryFile.localeCourse(localeCourse),
      libraryFile.exam(examFile),
      libraryFile.localeExam(localeExam),
    ],
    questions: items.length,
    leftOut,
    problems,
  };
}

type ChoiceOptions = Extract<ExamItem, { type: "single_choice" }>["options"];

/** The pictures standing for a question's options, by option. */
const optionPictures = (q: Question): Array<Picture | undefined> =>
  q.choices.some((c) => c.picture)
    ? q.choices.map((c) => c.picture)
    : q.pictures.length === q.choices.length && q.choices.length > 1
      ? q.pictures
      : [];

/** A question's options: its choices (with their pictures), or the Teil's letters for an answer by
 *  letter (with "none" where the Teil has one). */
function optionsOf(
  q: Question,
  teil: Teil,
  none: string | undefined,
  media: (href: string | undefined) => MediaPath | undefined,
): ChoiceOptions {
  const id = (i: number) => String.fromCharCode(97 + i);
  if (q.choices.length) {
    const pictures = optionPictures(q);
    return q.choices.map((c: Choice, i) => {
      const image = media(pictures[i]?.src);
      return { id: id(i), text: c.label, ...(image && { media: { image } }) };
    });
  }
  const letters = teil.letters.map((l, i) => {
    const image = media(l.picture?.src);
    return { id: id(i), text: l.letter, ...(image && { media: { image } }) };
  });
  return none ? [...letters, { id: id(letters.length), text: none }] : letters;
}

/** The example's option: the one marked, or the letter it holds. */
function exampleOption(q: Question, options: Array<{ id: string; text?: string }>) {
  const marked = q.choices.findIndex((c) => c.checked);
  if (marked >= 0) return options[marked]?.id;
  return q.typed?.value ? optionFor(q.typed.value, options) : undefined;
}
