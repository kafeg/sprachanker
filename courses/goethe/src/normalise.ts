// A level's model test normalised (03): each module page read into Teile (page.ts, teile.ts) and
// written as the exam's module of sections — a Teil each, with its instructions, its text, picture or
// recording, how often it plays, its examples — and its questions as single-choice items whose right
// option comes from the Teil's solution page. Pure: the pages, the pictures' texts and the media files
// are given.
import { createHash } from "node:crypto";
import { escapeHtml, type LibraryFile, libraryFile } from "@sprachanker/course-kit";
import {
  type CourseIndex,
  type EditionId,
  type Exam,
  type ExamItem,
  type ExamItemKey,
  type ExamSectionKey,
  type ExamSources,
  examItemKey,
  examSectionKey,
  type LocaleCourse,
  type LocaleExam,
  type LocaleItem,
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
import { optionFor } from "./options.ts";
import { audioList, type Choice, type Picture, readPage } from "./page.ts";
import { readSolutions, type Solution } from "./solutions.ts";
import { type Module, type Question, readModule, type Teil } from "./teile.ts";
import { readWriting } from "./writing.ts";
import { writingSection } from "./writing-exam.ts";

export interface LevelPages {
  /** Each module's page as fetched. */
  modules: Array<{ id: ModuleId; html: string }>;
  /** A Teil's solution page by its file name ("hoeren_l1.php"). */
  solution(file: string): string | undefined;
  /** A picture's text by its page's address. */
  longdesc(url: string): string | undefined;
  /** A medium's file in the library by its address. */
  media(url: string): MediaPath | undefined;
  /** When the pages were read (epoch ms: the newest copy kept). */
  readAt: number;
}

/** Where the import keeps a page it read: a module page, a Teil's solution page (its name without
 *  ".php"), a picture's text page. */
export const rawPath = (level: Level, kind: "module" | "solution" | "text", name: string) =>
  `raw/${EDITION}/${level.course}/${kind === "module" ? "" : kind === "solution" ? "solutions/" : "texts/"}${name}${kind === "text" ? "" : ".html"}`;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const MODULE_TITLES: Record<ModuleId, string> = {
  hoeren: "Hören",
  lesen: "Lesen",
  schreiben: "Schreiben",
};

export const pageUrl = (level: Level, module: ModuleId) => `${levelUrl(level)}${module}.php`;
/** An address on a page made absolute. */
export const absolute = (href: string, base: string) => new URL(href.trim(), base).href;

/** A module page read: its Teile. */
export const moduleOf = (html: string): Module => readModule(readPage(html));

/** A Teil's solution page by its form's action ("hoeren_l1.php#loesung22" → "hoeren_l1.php"); a form
 *  posting back to its own page (a text to write) has none. */
export const solutionFile = (action: string | undefined) => {
  const file = action?.split("#")[0] ?? "";
  return /_l\d+\.php$/.test(file) ? file : undefined;
};

/** What a module page refers to that the import fetches: its Teile's solution pages, its media and
 *  the pages holding a picture's or a task's text. */
export function referencesOf(module: ModuleId, html: string, base: string) {
  const media = new Set<string>();
  const texts = new Set<string>();
  const solutions = new Set<string>();
  const picture = (p: Picture | undefined) => {
    if (!p) return;
    media.add(absolute(p.src, base));
    if (p.longdesc) texts.add(absolute(p.longdesc, base));
  };
  if (module === "schreiben") {
    for (const t of readWriting(html).teile) {
      const file = solutionFile(t.form?.action);
      if (file) solutions.add(file);
      t.pictures.forEach(picture);
      for (const link of t.links) texts.add(absolute(link, base));
    }
    return { solutions: [...solutions], media: [...media], texts: [...texts] };
  }
  for (const t of moduleOf(html).teile) {
    const file = solutionFile(t.form?.action);
    if (file) solutions.add(file);
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
  return { solutions: [...solutions], media: [...media], texts: [...texts] };
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

const hundredths = (n: number) => Math.round(n * 100) / 100;

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
  // What the sources say of the exam (ExamSources): the documents read, each question's places, the
  // checks' counts.
  const documents: ExamSources["documents"] = [];
  const placed: ExamSources["items"] = {};
  const count = (): { passed: number; of: number } => ({ passed: 0, of: 0 });
  const checks = {
    questions: count(),
    answers: count(),
    numbers: count(),
    recordings: count(),
    criteria: count(),
  };
  const mediaReferenced = new Set<string>();
  const mediaKept = new Set<string>();

  /** Item texts of the locale beyond pictures' descriptions: an open answer's criteria named. */
  const itemLocales: Record<string, LocaleItem> = {};
  /** A Teil's solution page, kept among the sources' documents once; its answers. */
  const solutionsOf = (module: ModuleId, teil: string, action: string | undefined) => {
    const file = solutionFile(action) ?? "";
    const page = pages.solution(file);
    const id = file.replace(/\.php$/, "");
    if (page && !documents.some((d) => d.id === id))
      documents.push({
        id,
        title: `${level.title}: Lösungen ${MODULE_TITLES[module]}, ${teil}`,
        url: `${levelUrl(level)}${file}`,
        raw: rawPath(level, "solution", id),
        sha256: sha256(page),
      });
    return { file, id, solutions: readSolutions(page ?? "") };
  };
  /** A module timed as its page says, scaled as the exam scales it. */
  const timed = (module: ModuleId, minutes: number) => {
    if (!minutes) problems.push(`${level.course} ${module}: no time stated`);
    modules.push({
      id: module,
      timeLimitSec: minutes * 60,
      scaleTo: level.scaleTo,
      ...(level.rounding === "modules" && { round: true }),
    });
  };

  for (const { id: module, html } of pages.modules) {
    documents.push({
      id: module,
      title: `${level.title}: ${MODULE_TITLES[module]}`,
      url: pageUrl(level, module),
      raw: rawPath(level, "module", module),
      sha256: sha256(html),
    });
    const base = pageUrl(level, module);
    const media = (href: string | undefined): MediaPath | undefined => {
      if (!href) return undefined;
      const url = absolute(href, base);
      const path = pages.media(url);
      mediaReferenced.add(url);
      if (path) mediaKept.add(url);
      return path;
    };
    const textOf = (href: string) => pages.longdesc(absolute(href, base));

    if (module === "schreiben") {
      const writing = readWriting(html);
      timed(module, writing.intro.map(minutesIn).find((m) => !Number.isNaN(m)) ?? 0);
      for (const teil of writing.teile) {
        const slug = `${module}-${teil.number}`;
        const sectionKey = examSectionKey(exam, slug) as ExamSectionKey;
        const { file, id, solutions } = solutionsOf(module, teil.title, teil.form?.action);
        if (teil.fields.length && !solutions.length)
          problems.push(`${level.course} ${slug}: no solutions (${file || "no form"})`);
        const own = writingSection({
          level,
          exam,
          module,
          teil,
          solutions,
          solutionId: id,
          longdesc: textOf,
        });
        problems.push(...own.problems);
        items.push(...own.items);
        Object.assign(placed, own.placed);
        Object.assign(itemLocales, own.locale);
        for (const k of ["questions", "answers", "criteria"] as const) {
          checks[k].of += own[k].of;
          checks[k].passed += own[k].passed;
        }
        leftOut += own.questions.of - own.questions.passed;
        if (!own.pool.length) {
          problems.push(`${level.course} ${slug}: no question left`);
          continue;
        }
        const image = media(teil.pictures[0]?.src);
        sections.push({
          key: sectionKey,
          module,
          pool: own.pool,
          draw: own.pool.length,
          filter: null,
          ...(own.text && { text: own.text }),
          ...(image && { media: { image } }),
        });
        localeSections[sectionKey] = {
          title: teil.title,
          instructions: teil.instructions.map(plainTime).join("\n"),
        };
      }
      continue;
    }

    const read = moduleOf(html);
    for (const note of read.notes) problems.push(`${level.course} ${module}: ${note}`);
    // Every player takes the list's next recording: a count that differs shifts them.
    const players = readPage(html).filter((b) => b.kind === "audio").length;
    checks.recordings.of += audioList(html).length;
    checks.recordings.passed += Math.max(
      0,
      audioList(html).length - Math.abs(players - audioList(html).length) - read.notes.length,
    );
    if (players !== audioList(html).length)
      problems.push(
        `${level.course} ${module}: ${players} players for ${audioList(html).length} recordings`,
      );
    timed(
      module,
      read.intro.map(minutesIn).find((m) => !Number.isNaN(m)) ??
        read.teile
          .flatMap((t) =>
            t.instructions
              .map(minutesIn)
              .filter((m) => !Number.isNaN(m))
              .slice(0, 1),
          )
          .reduce((a, b) => a + b, 0),
    );

    let number = 0;
    const seen = new Map<string, number>();
    for (const teil of read.teile) {
      // "Teil 2 Text 1" and "Teil 2 Text 2" are sections of their own (each its text).
      const count = (seen.get(String(teil.number)) ?? 0) + 1;
      seen.set(String(teil.number), count);
      const slug = `${module}-${teil.number}${/Text\s*\d/i.test(teil.title) ? `-${count}` : ""}`;
      const sectionKey = examSectionKey(exam, slug) as ExamSectionKey;
      const {
        file,
        id: solutionId,
        solutions,
      } = solutionsOf(module, teil.title, teil.form?.action);
      if (!solutions.length)
        problems.push(`${level.course} ${slug}: no solutions (${file || "no form"})`);
      const scored = teil.questions.filter((q) => !q.example);
      const firstNumber = number + 1;
      const numbered = scored.map((q) => {
        number++;
        if (q.number !== undefined) {
          checks.numbers.of++;
          if (q.number === number) checks.numbers.passed++;
          else problems.push(`${level.course} ${slug}: question ${q.number} at place ${number}`);
        }
        return { q, number };
      });
      checks.questions.of += numbered.length;
      // By number; by order only on a page numbering its own Teil 1…k for its k questions (A1 Lesen 3).
      // A page missing a number is not shifted: that question is reported.
      const allByNumber = numbered.every(({ number: n }) => solutions.some((s) => s.number === n));
      const ownCount =
        !allByNumber &&
        solutions.length === numbered.length &&
        solutions.every((s, i) => s.number === i + 1);
      const solutionOf = (n: number) =>
        ownCount ? solutions[n - firstNumber] : solutions.find((s) => s.number === n);
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
        // Keyed by the number the page gives the question (stable if what counts as an example or how
        // a Teil splits ever changes), by its place where it gives none.
        const own = q.number !== undefined && q.number > 0 ? q.number : n;
        const key = examItemKey(exam, `${module}-${own}`);
        if (items.some((i) => i.key === key)) {
          problems.push(`${level.course} ${slug}: question ${own} twice`);
          leftOut++;
          continue;
        }
        const solution = solutionOf(n);
        checks.answers.of++;
        const item = build(q, key, solution);
        if (item) {
          items.push(item);
          pool.push(key);
          checks.questions.passed++;
          checks.answers.passed++;
          placed[key] = [
            { document: module, at: `${teil.title}, Aufgabe ${own}` },
            ...(solution ? [{ document: solutionId, at: `Lösung ${solution.number}` }] : []),
          ];
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
            placed[key] = [{ document: module, at: `${teil.title}, Beispiel` }];
          }
        });
      if (!pool.length) {
        problems.push(`${level.course} ${slug}: no question left`);
        continue;
      }
      const text = teil.texts.join("\n\n");
      // The letters answers are chosen from, each once with its text and picture (an ad's text
      // page read).
      const material = teil.letters.map((l) => {
        const own = l.picture?.longdesc ? textOf(l.picture.longdesc) : undefined;
        const lines = [...l.texts, ...(own ? [own] : [])].join("\n");
        const image = media(l.picture?.src);
        return {
          letter: l.letter,
          ...(lines && { text: lines }),
          ...(image && { media: { image } }),
        };
      });
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
        ...(material.length && { letters: material }),
        ...(plays !== undefined && { plays }),
        ...(examples.length && { examples }),
      });
      const letterAlt = Object.fromEntries(
        teil.letters.flatMap((l) => (l.picture?.alt ? [[l.letter, l.picture.alt]] : [])),
      );
      localeSections[sectionKey] = {
        title: teil.title,
        instructions: teil.instructions.map(plainTime).join("\n"),
        ...(Object.keys(letterAlt).length && { alt: letterAlt }),
      };
    }
  }

  const together = modules.reduce((n, m) => n + m.timeLimitSec, 0);
  const all = modules.map((m) => m.id as ModuleId);
  const thresholds: Exam["thresholds"] = level.apart
    ? modules.map((m) => ({
        id: m.id,
        minPoints: hundredths(0.6 * level.scaleTo),
        modules: [m.id],
      }))
    : [{ id: "pass", minPoints: hundredths(0.6 * level.scaleTo * modules.length) }];
  const examFile: Exam = {
    format: 1,
    key: exam,
    timeLimitSec: together,
    modules,
    sections,
    items,
    thresholds,
    ...(level.rounding === "total" && { roundTotal: true }),
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
      items.map((i) => [i.key, { ...itemLocales[i.key], ...(alt[i.key] && { alt: alt[i.key] }) }]),
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
      `Der Modellsatz in der barrierefreien Fassung des Goethe-Instituts: ${new Intl.ListFormat(
        "de",
      ).format(
        all.map((m) => MODULE_TITLES[m]),
      )}, mit allen Aufnahmen, Bildern und Lösungen und den Kriterien, nach denen geschrieben wird.`,
    )}</p>`,
    units: {},
    goals: {},
  };
  return {
    files: [
      libraryFile.examSources({
        format: 1,
        exam,
        read: pages.readAt,
        documents,
        checks: [
          { id: "questions-complete", ...checks.questions },
          { id: "answers-matched", ...checks.answers },
          { id: "numbers-agree", ...checks.numbers },
          { id: "recordings-placed", ...checks.recordings },
          ...(checks.criteria.of ? [{ id: "criteria-read" as const, ...checks.criteria }] : []),
          { id: "media-kept", passed: mediaKept.size, of: mediaReferenced.size },
        ],
        items: placed,
      }),
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
  // Answered by letter: the letters alone (each one's ad or picture is the Teil's material).
  const letters = teil.letters.map((l, i) => ({ id: id(i), text: l.letter }));
  return none ? [...letters, { id: id(letters.length), text: none }] : letters;
}

/** The example's option: the one marked, or the letter it holds. */
function exampleOption(q: Question, options: Array<{ id: string; text?: string }>) {
  const marked = q.choices.findIndex((c) => c.checked);
  if (marked >= 0) return options[marked]?.id;
  return q.typed?.value ? optionFor(q.typed.value, options) : undefined;
}
